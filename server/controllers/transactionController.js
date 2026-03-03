const supabase = require('../config/supabase');
const axios = require('axios');

// Helper function to calculate price after discount
const calculateFinalPrice = (price, type, value) => {
  const basePrice = Number(price) || 0;
  const discountValue = Number(value) || 0;
  
  if (!discountValue || discountValue === 0) return basePrice;

  let discountAmount = 0;
  if (type === 'percent') {
    discountAmount = basePrice * (discountValue / 100);
  } else {
    discountAmount = discountValue; // Fixed amount
  }

  // Ensure price doesn't go below zero
  return Math.max(0, basePrice - discountAmount);
};

exports.createTransaction = async (req, res) => {
  try {
    const { transaction, items } = req.body;
    
    // 1. Insert Main Transaction
    const { data: transData, error: transError } = await supabase
      .from('transactions')
      .insert([{
        description: transaction.description,
        movement_type: transaction.movement_type,
        category_id: transaction.category_id,
        total_amount: transaction.total_amount,
        global_discount: Number(transaction.global_discount) || 0,
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
      const legoItems = items.filter(item => item.set_number && item.set_number.trim() !== '');
      
      if (legoItems.length > 0) {
        console.log("Processing Lego Sets:", legoItems.map(i => i.set_number));
        
        // Use Promise.all to handle multiple sets concurrently
        await Promise.all(legoItems.map(async (item) => {
          
          const originalPrice = Number(item.price_per_unit);
          // Calculate actual paid price for this specific set
          const finalPaidPrice = calculateFinalPrice(
            originalPrice, 
            item.discount_type, 
            Number(item.discount_value)
          );

          const { error } = await supabase.from('lego_sets').insert([{
            set_number: item.set_number,
            name: item.item_name,
            theme: item.theme || 'General',
            purchase_price: finalPaidPrice, // Actual price paid
            original_price: originalPrice,  // MSRP / Base price
            purchase_date: transaction.transaction_date,
            status: 'New',
            transaction_id: transaction.id
          }]);
          
          if (error) console.error(`Error inserting lego set ${item.set_number}:`, error.message);
        }));
      }
    }

    // 3. Insert Transaction Items
    if (items && items.length > 0) {
      const itemsToInsert = items.map(item => {
        // Calculate final price per line item for the DB record
        const lineFinalPrice = calculateFinalPrice(
            item.price_per_unit, 
            item.discount_type, 
            item.discount_value
        );

        return {
            transaction_id: transactionId,
            item_name: item.item_name,
            quantity: Number(item.quantity) || 1,
            price_per_unit: Number(item.price_per_unit) || 0,
            
            // Lego specific fields
            set_number: item.set_number || null,
            theme: item.theme || null, // Ensure you added this column to transaction_items if you want it there too
            
            // Discount fields
            discount_type: item.discount_type || 'amount',
            discount_value: Number(item.discount_value) || 0,
            final_price: lineFinalPrice,

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

    res.status(201).json({ message: 'Transaction saved successfully', id: transData.id });

  } catch (error) {
    console.error("Create Transaction Error:", error);
    res.status(400).json({ error: error.message });
  }
};

// Get all transactions (for History/Dashboard)
exports.getTransactions = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('transactions')
      .select(`
        *,
        categories (
          name,
          icon
        ),
        payment_sources (
          id,
          name,
          method,
          slug,
          issuer,
          last4
        )
      `)
      .order('transaction_date', { ascending: false });

    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
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

    // A. Update the main transaction details
    const { error: transError } = await supabase
      .from('transactions')
      .update({
        description: transaction.description,
        movement_type: transaction.movement_type,
        category_id: transaction.category_id,
        total_amount: transaction.total_amount,
        global_discount: Number(transaction.global_discount) || 0,
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
    if (items && items.length > 0) {
      const itemsToInsert = items.map(item => ({
        transaction_id: id, // Link to the existing transaction ID
        item_name: item.item_name,
        quantity: Number(item.quantity) || 1,
        price_per_unit: Number(item.price_per_unit) || 0,
        set_number: item.set_number || null,
        theme: item.theme || null,
        discount_type: item.discount_type || 'amount',
        discount_value: Number(item.discount_value) || 0,
        // Recalculate final price
        final_price: calculateFinalPrice(item.price_per_unit, item.discount_type, item.discount_value),
        tags: item.tags || ''
      }));

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