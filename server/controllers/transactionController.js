const supabase = require('../config/supabase');

exports.createTransaction = async (req, res) => {
  try {
    // פירוק הנתונים שמגיעים מה-Frontend
    const { transaction, items } = req.body;

    // 1. שמירת התנועה הראשית בטבלת transactions
    const { data: transData, error: transError } = await supabase
      .from('transactions')
      .insert([{
        description: transaction.description,
        type: transaction.movement_type, // הוצאה/הכנסה
        category: transaction.category,
        total_amount: transaction.total_amount,
        payment_source: transaction.payment_source, // מזומן/אשראי
        credit_card_name: transaction.credit_card_name, // שם הכרטיס
        transaction_date: transaction.transaction_date,
        tags: transaction.tags // תגיות
      }])
      .select();

    if (transError) throw transError;

    // 2. אם המשתמש הוסיף פריטים, נשמור אותם בטבלה הנפרדת
    if (items && items.length > 0) {
      const transactionId = transData[0].id;
      const itemsToInsert = items.map(item => ({
        item_name: item.item_name,
        quantity: item.quantity,
        price_per_unit: item.price_per_unit,
        total_item_price: item.quantity * item.price_per_unit,
        transaction_id: transactionId
      }));

      const { error: itemsError } = await supabase
        .from('transaction_items')
        .insert(itemsToInsert);

      if (itemsError) throw itemsError;
    }

    res.status(201).json({ message: 'נשמר בהצלחה!', data: transData });
  } catch (error) {
    console.error("DB Error:", error.message);
    res.status(400).json({ error: error.message });
  }
};

exports.getAllTransactions = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('transactions')
      .select('*'); // מושך את כל השורות מהטבלה

    if (error) throw error;
    res.status(200).json(data); // מחזיר את הנתונים כ-JSON
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};