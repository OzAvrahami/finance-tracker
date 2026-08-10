const supabase = require('../config/supabase');
const axios = require('axios');
const {
  parseTransactionListQuery,
  encodeCursor,
} = require('../utils/transactionQuery');
const {
  buildTransactionPricing,
  fromMinorUnits,
  normalizeGlobalDiscountSource,
  roundDivide,
} = require('../utils/transactionPricing');

// Advances a YYYY-MM-DD date string by N months, clamping to the last valid day of the target month.
// e.g. Jan 31 + 1 month → Feb 28 (not Feb 31)
const advanceMonthClamped = (dateStr, months) => {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDate();
  const rawMonth = d.getMonth() + months;
  const targetYear = d.getFullYear() + Math.floor(rawMonth / 12);
  const targetMonth = ((rawMonth % 12) + 12) % 12;
  const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
  const clampedDay = Math.min(day, lastDay);
  const mm = String(targetMonth + 1).padStart(2, '0');
  const dd = String(clampedDay).padStart(2, '0');
  return `${targetYear}-${mm}-${dd}`;
};

exports.createTransaction = async (req, res) => {
  try {
    const { transaction, items } = req.body;
    const transactionItems = Array.isArray(items) ? items : [];
    const pricing = buildTransactionPricing(
      transactionItems,
      transaction.global_discount,
      transactionItems.length > 0 ? transaction.total_amount : null,
    );
    const globalDiscountSource = normalizeGlobalDiscountSource(
      transaction.global_discount_source,
      pricing.globalDiscountCents,
    );

    const installmentCount = Math.max(1, parseInt(transaction.installment_count) || 1);
    const fullAmount = Number(transaction.total_amount);
    const perAmount = installmentCount > 1
      ? Math.round((fullAmount / installmentCount) * 100) / 100
      : fullAmount;

    // 1. Insert Main Transaction
    const { data: transData, error: transError } = await supabase
      .from('transactions')
      .insert([{
        description: transaction.description,
        movement_type: transaction.movement_type,
        category_id: transaction.category_id,
        total_amount: perAmount,
        global_discount: fromMinorUnits(pricing.globalDiscountCents),
        global_discount_source: globalDiscountSource,
        payment_source_id: transaction.payment_source_id || null,
        transaction_date: transaction.transaction_date,
        charge_date: transaction.charge_date || transaction.transaction_date,
        tags: transaction.tags,
        loan_id: transaction.loan_id || null,
        original_amount: transaction.original_amount ? Number(transaction.original_amount) : null,
        currency: transaction.currency || 'ILS',
        exchange_rate: transaction.exchange_rate ? Number(transaction.exchange_rate) : null,
        installments_info: installmentCount > 1 ? `1/${installmentCount}` : (transaction.installments_info || null),
        installment_number: installmentCount > 1 ? 1 : null,
        installment_count: installmentCount > 1 ? installmentCount : null,
        parent_transaction_id: null,
        notes: transaction.notes || null
      }])
      .select();

    if (transError) throw transError;
    const transactionId = transData[0].id;

    // 2. Lego Automation Logic - check by category_id
    // First, look up the category name
    let categoryName = null;
    if (transaction.category_id) {
      const { data: catData } = await supabase
        .from('categories')
        .select('name')
        .eq('id', transaction.category_id)
        .single();
      categoryName = catData?.name;
    }

    if (categoryName === 'Lego' || categoryName === 'לגו') {
      // Filter only items that have a set number
      const legoItems = pricing.items.filter(({ item }) => item.set_number && item.set_number.trim() !== '');
      
      if (legoItems.length > 0) {
        console.log("Processing Lego Sets:", legoItems.map(({ item }) => item.set_number));
        
        // Use Promise.all to handle multiple sets concurrently
        await Promise.all(legoItems.map(async (pricedItem) => {
          const { item } = pricedItem;
          // LEGO auto-creation still creates one collection record per line. For
          // legacy quantity > 1 lines, retain the existing per-set/unit meaning.
          const purchasePriceCents = pricedItem.quantity === 1n
            ? pricedItem.actualLineCents
            : roundDivide(pricedItem.actualLineCents, pricedItem.quantity);
          const { error } = await supabase.from('lego_sets').insert([{
            set_number: item.set_number,
            name: item.item_name,
            theme: item.theme || 'General',
            original_price: fromMinorUnits(pricedItem.originalUnitCents),
            receipt_price: fromMinorUnits(pricedItem.receiptUnitCents),
            purchase_price: fromMinorUnits(purchasePriceCents),
            acquisition_type: pricedItem.acquisitionType,
            purchase_date: transaction.transaction_date,
            status: 'New',
            transaction_id: transactionId,
            brand: item.brand || 'LEGO'
          }]);
          
          if (error) console.error(`Error inserting lego set ${item.set_number}:`, error.message);
        }));
      }
    }

    // 3. Insert Transaction Items
    if (pricing.items.length > 0) {
      const itemsToInsert = pricing.items.map(pricedItem => {
        const { item } = pricedItem;
        return {
            transaction_id: transactionId,
            item_name: item.item_name,
            quantity: Number(pricedItem.quantity),
            price_per_unit: fromMinorUnits(pricedItem.originalUnitCents),
            
            // Lego specific fields
            set_number: item.set_number || null,
            theme: item.theme || null, // Ensure you added this column to transaction_items if you want it there too
            
            // Discount fields
            discount_type: item.discount_type || 'amount',
            discount_value: Number(item.discount_value) || 0,
            final_price: fromMinorUnits(pricedItem.receiptUnitCents),
            allocated_global_discount: fromMinorUnits(pricedItem.allocatedGlobalDiscountCents),
            acquisition_type: pricedItem.acquisitionType,

            tags: item.tags || '' // Item specific tags
        };
      });

      const { error: itemsError } = await supabase
        .from('transaction_items')
        .insert(itemsToInsert);

      if (itemsError) throw itemsError;
    }

    const description = transaction.description ? transaction.description.trim() : '';
    const wordCount = description.split(/\s+/).length;

    if (wordCount <= 2 && transaction.category_id) {
      const { data: categoryData } = await supabase
        .from('categories')
        .select('*')
        .eq('id', transaction.category_id)
        .single();

        if (categoryData) {
          const currentKeywords = categoryData.keywords || [];
          const  isKeywordExists = currentKeywords.some(k => k.toLowerCase() === description.toLowerCase());

          if (!isKeywordExists) {
            const updatedKeywords = [...currentKeywords, description];
            await supabase  
              .from('categories')
              .update({ keywords: updatedKeywords })
              .eq('id', categoryData.id);
          }
        }
    }

    // 5. Auto-create remaining installments
    if (installmentCount > 1) {
      const siblings = [];
      for (let i = 1; i < installmentCount; i++) {
        const isLast = i === installmentCount - 1;
        const siblingAmount = isLast
          ? Math.round((fullAmount - perAmount * (installmentCount - 1)) * 100) / 100
          : perAmount;

        siblings.push({
          description: transaction.description,
          movement_type: transaction.movement_type,
          category_id: transaction.category_id,
          total_amount: siblingAmount,
          global_discount: 0,
          payment_source_id: transaction.payment_source_id || null,
          transaction_date: advanceMonthClamped(transaction.transaction_date, i),
          charge_date: advanceMonthClamped(transaction.charge_date || transaction.transaction_date, i),
          tags: transaction.tags,
          loan_id: transaction.loan_id || null,
          currency: transaction.currency || 'ILS',
          installments_info: `${i + 1}/${installmentCount}`,
          installment_number: i + 1,
          installment_count: installmentCount,
          parent_transaction_id: transactionId,
          notes: transaction.notes || null,
        });
      }

      const { error: siblingsError } = await supabase
        .from('transactions')
        .insert(siblings);

      if (siblingsError) throw siblingsError;
    }

    res.status(201).json({ message: 'Transaction saved successfully', id: transactionId });

  } catch (error) {
    console.error("Create Transaction Error:", error);
    res.status(400).json({ error: error.message });
  }
};

// GET /api/transactions — filtered, keyset-paginated transaction list.
//
// Replaces the previous unbounded `select * order by transaction_date desc`.
// That query had no limit, so PostgREST silently truncated it at db-max-rows
// (1000) with error === null, hiding every transaction older than 2026-04-09
// while ~2069 older rows existed. Filtering now happens in SQL (see
// migrations/003) instead of in the browser over a partial array.
//
// Sorting is server-side across the whole filtered set. The table's clickable
// columns used to sort in the browser over whatever rows happened to be loaded,
// which answered the wrong question once the list stopped being complete.
//
// Response contract:
//   {
//     data: [ <transaction>, ... ],
//     pagination: { limit, hasMore, sortBy, sortDirection, nextCursor: string | null },
//     totals?: { count, income, expense }   // only when includeTotals=true
//   }
//
// nextCursor is opaque. Clients must pass it back verbatim and must not parse
// or construct it — its contents are owned by utils/transactionQuery.js.
exports.getTransactions = async (req, res) => {
  const parsed = parseTransactionListQuery(req.query);
  if (!parsed.ok) {
    return res.status(400).json({ error: parsed.error });
  }
  const query = parsed.value;
  const cursor = query.cursor;

  try {
    const { data, error } = await supabase.rpc('transactions_page', {
      p_from: query.from,
      p_to: query.to,
      p_category_id: query.categoryId,
      p_payment_source_id: query.paymentSourceId,
      p_uncategorized_only: query.uncategorizedOnly,
      p_search: query.search,
      // The true page size. The +1 probe row that decides hasMore lives inside
      // the SQL function, so it cannot leak into this response.
      p_limit: query.limit,
      p_sort_by: query.sortBy,
      p_sort_direction: query.sortDirection,
      p_cursor_id: cursor ? cursor.id : null,
      p_cursor_date: cursor ? cursor.date : null,
      // Sent as a decimal string; PostgreSQL casts it to numeric. Never a JS
      // number — total_amount is NUMERIC and a double could move the boundary.
      p_cursor_amount: cursor ? cursor.amount : null,
      p_cursor_description: cursor ? cursor.description : null,
      p_cursor_description_is_null: cursor ? cursor.descriptionIsNull : null,
      p_include_totals: query.includeTotals,
    });

    if (error) throw error;

    const rows = Array.isArray(data?.data) ? data.data : [];
    const hasMore = data?.has_more === true;

    const response = {
      data: rows,
      pagination: {
        limit: query.limit,
        hasMore,
        sortBy: query.sortBy,
        sortDirection: query.sortDirection,
        // next_key is built in SQL from the last row actually returned, with
        // total_amount rendered as text, so the cursor boundary is exact.
        nextCursor: hasMore
          ? encodeCursor(data?.next_key, query.sortBy, query.sortDirection)
          : null,
      },
    };

    // Totals are computed over the whole filtered set, not over the returned
    // page. Summing a single page would understate the user's real totals.
    if (query.includeTotals) {
      const totals = data?.totals || {};
      response.totals = {
        count: Number(totals.count) || 0,
        income: Number(totals.income) || 0,
        expense: Number(totals.expense) || 0,
      };
    }

    res.status(200).json(response);
  } catch (error) {
    console.error('getTransactions Error:', error);
    res.status(400).json({ error: error.message });
  }
};

// Delete a transaction + its items + related lego sets
exports.deleteTransaction = async (req, res) => {
  try {
    const { id } = req.params;

    const { error: legoError } = await supabase
      .from('lego_sets')
      .delete()
      .eq('transaction_id', id);

    if (legoError) {
        console.error("Error deleting related lego sets:", legoError);
    }

    const { error: itemsError } = await supabase
      .from('transaction_items')
      .delete()
      .eq('transaction_id', id);

    if (itemsError) throw itemsError;

    const { error: transactionError } = await supabase
      .from('transactions')
      .delete()
      .eq('id', id);

    if (transactionError) throw transactionError;

    res.status(200).json({ message: 'Transaction and all related data deleted successfully' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Get unique tags for Autocomplete
exports.getTags = async (req, res) => {
  try {
    const { data, error } = await supabase.rpc('get_unique_tags');
    if (error) throw error;
    
    // Map to simple array of strings
    const tags = data.map(t => t.tag).filter(Boolean);
    res.status(200).json(tags);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// 1. Get single transaction with items
exports.getTransactionById = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('transactions')
      .select(`*, transaction_items(*)`) // Fetch transaction + its items
      .eq('id', id)
      .single();

    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// 2. Update transaction
exports.updateTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    const { transaction, items } = req.body;
    const transactionItems = Array.isArray(items) ? items : [];
    const pricing = buildTransactionPricing(
      transactionItems,
      transaction.global_discount,
      transactionItems.length > 0 ? transaction.total_amount : null,
    );
    const globalDiscountSource = normalizeGlobalDiscountSource(
      transaction.global_discount_source,
      pricing.globalDiscountCents,
    );

    // A. Update the main transaction details
    const { error: transError } = await supabase
      .from('transactions')
      .update({
        description: transaction.description,
        movement_type: transaction.movement_type,
        category_id: transaction.category_id,
        total_amount: transaction.total_amount,
        global_discount: fromMinorUnits(pricing.globalDiscountCents),
        global_discount_source: globalDiscountSource,
        payment_source_id: transaction.payment_source_id || null,
        transaction_date: transaction.transaction_date,
        charge_date: transaction.charge_date || transaction.transaction_date,
        tags: transaction.tags,
        loan_id: transaction.loan_id || null,
        original_amount: transaction.original_amount ? Number(transaction.original_amount) : null,
        currency: transaction.currency || 'ILS',
        exchange_rate: transaction.exchange_rate ? Number(transaction.exchange_rate) : null,
        installments_info: transaction.installments_info || null,
        notes: transaction.notes || null
      })
      .eq('id', id);

    if (transError) throw transError;

    // B. Sync Items: The safest strategy is Delete All -> Insert New
    // This handles added items, removed items, and modified items in one go.
    
    // 1. Delete existing items for this transaction
    await supabase.from('transaction_items').delete().eq('transaction_id', id);

    // 2. Insert the updated list
    if (pricing.items.length > 0) {
      const itemsToInsert = pricing.items.map(pricedItem => {
        const { item } = pricedItem;
        return {
          transaction_id: id, // Link to the existing transaction ID
          item_name: item.item_name,
          quantity: Number(pricedItem.quantity),
          price_per_unit: fromMinorUnits(pricedItem.originalUnitCents),
          set_number: item.set_number || null,
          theme: item.theme || null,
          discount_type: item.discount_type || 'amount',
          discount_value: Number(item.discount_value) || 0,
          final_price: fromMinorUnits(pricedItem.receiptUnitCents),
          allocated_global_discount: fromMinorUnits(pricedItem.allocatedGlobalDiscountCents),
          acquisition_type: pricedItem.acquisitionType,
          tags: item.tags || ''
        };
      });

      const { error: itemsError } = await supabase
        .from('transaction_items')
        .insert(itemsToInsert);
        
      if (itemsError) throw itemsError;
    }

    res.status(200).json({ message: 'Transaction updated successfully' });

  } catch (error) {
    console.error("Update Error:", error);
    res.status(400).json({ error: error.message });
  }
};

exports.getLegoSetDetails = async (req, res) => {
  const { setNum } = req.params;

  const formattedSetNum = setNum.includes('-') ? setNum : `${setNum}-1`;

  try{
    const apiKey = process.env.REBRICKABLE_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: "Missing API Key" });
    }

    const setResponse = await axios.get(`https://rebrickable.com/api/v3/lego/sets/${formattedSetNum}/`, {
      headers: { 'Authorization': `key ${apiKey}`}
    });

    const themeId = setResponse.data.theme_id;
    const themeResponse = await axios.get(`https://rebrickable.com/api/v3/lego/themes/${themeId}/`, {
      headers: { 'Authorization': `key ${apiKey}` }
    });

    res.status(200).json({
      name: setResponse.data.name,
      theme: themeResponse.data.name,
      img: setResponse.data.set_img_url,
      year: setResponse.data.year,
      parts: setResponse.data.num_parts
    });

  } catch (error) {
    console.error("Lego Fetch Error:", error.message);
    res.status(404).json({ error: 'Set not found' });
  }
};

exports.getCategories = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .eq('is_active', true)
      .order('name', { ascending: true });

      if (error) throw error;

      res.status(200).json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Get active payment sources
exports.getPaymentSources = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('payment_sources')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
