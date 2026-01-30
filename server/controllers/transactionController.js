const supabase = require('../config/supabase');

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
    
    console.log("Creating transaction. Items count:", items ? items.length : 0);

    // 1. Insert Main Transaction
    const { data: transData, error: transError } = await supabase
      .from('transactions')
      .insert([{
        description: transaction.description,
        type: transaction.movement_type, // 'income' or 'expense'
        category: transaction.category,
        total_amount: transaction.total_amount, // Final total after all discounts
        global_discount: Number(transaction.global_discount) || 0, // Global discount/points used
        payment_method: transaction.payment_source, // Mapping 'payment_source' from UI to DB column
        credit_card_name: transaction.credit_card_name || null,
        transaction_date: transaction.transaction_date,
        tags: transaction.tags // Comma separated tags string
      }])
      .select();

    if (transError) throw transError;
    const transactionId = transData[0].id;

    // 2. Lego Automation Logic
    if (transaction.category === 'Lego') {
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
            status: 'New'
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

    res.status(201).json({ message: 'Transaction saved successfully', data: transData });

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
        transaction_items (*)
      `)
      .order('transaction_date', { ascending: false });

    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Delete a transaction (Cascade delete will handle items)
exports.deleteTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('transactions')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.status(200).json({ message: 'Transaction deleted successfully' });
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