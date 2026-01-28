const supabase = require('../config/supabase');

exports.createTransaction = async (req, res) => {
  try {
    const { transaction, items } = req.body;
    console.log("Creating transaction with items:", items.length); // לוג לבדיקה

    // 1. שמירת התנועה הראשית
    const { data: transData, error: transError } = await supabase
      .from('transactions')
      .insert([{
        description: transaction.description,
        type: transaction.movement_type,
        category: transaction.category,
        total_amount: transaction.total_amount,
        payment_method: transaction.payment_source, // וודא שזה תואם לטופס
        credit_card_name: transaction.credit_card_name,
        transaction_date: transaction.transaction_date,
        tags: transaction.tags
      }])
      .select();

    if (transError) throw transError;
    const transactionId = transData[0].id;

    // 2. לוגיקת אוטומציה ללגו (משופרת!)
    if (transaction.category === 'Lego') {
      // מסננים רק פריטים שיש להם מספר סט
      const legoItems = items.filter(item => item.set_number && item.set_number.trim() !== '');
      
      if (legoItems.length > 0) {
        console.log("Processing Lego Sets:", legoItems.map(i => i.set_number)); // לוג לראות מה נכנס
        
        // שימוש ב-Promise.all מבטיח שכל ההוספות יקרו
        await Promise.all(legoItems.map(async (item) => {
          const { error } = await supabase.from('lego_sets').insert([{
            set_number: item.set_number,
            name: item.item_name,
            purchase_price: item.price_per_unit,
            purchase_date: transaction.transaction_date,
            status: 'New'
          }]);
          
          if (error) console.error("Error inserting lego set:", item.set_number, error.message);
        }));
      }
    }

    // 3. שמירת הפריטים בטבלת הפירוט (transaction_items)
    if (items && items.length > 0) {
      const itemsToInsert = items.map(item => ({
        transaction_id: transactionId,
        item_name: item.item_name,
        quantity: Number(item.quantity) || 1,
        price_per_unit: Number(item.price_per_unit) || 0,
        set_number: item.set_number || null,
        tags: item.tags || ''
      }));

      const { error: itemsError } = await supabase
        .from('transaction_items')
        .insert(itemsToInsert);

      if (itemsError) throw itemsError;
    }

    res.status(201).json({ message: 'נשמר בהצלחה!', data: transData });
  } catch (error) {
    console.error("Server Error:", error);
    res.status(400).json({ error: error.message });
  }
};

exports.getAllTransactions = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('transactions')
      .select('*'); // מושך את כל השורות מהטבלה

    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.deleteTransaction = async (req, res) => {
  try {
    const { id } = req.params;

    // מחיקה מ-Supabase (בגלל שהגדרנו Cascade ב-DB, זה ימחק גם את הפריטים הקשורים)
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

exports.getTags = async (req, res) => {
  const { data, error } = await supabase.rpc('get_unique_tags');
  if (error) return res.status(400).json({ error: error.message });
  res.json(data.map(t => t.tag));
};