// server/controllers/transactionController.js
const supabase = require('../config/supabase');

exports.createTransaction = async (req, res) => {
  try {
    const { transaction, items } = req.body;

    // 1. הכנסת ההוצאה הראשית
    const { data: newTransaction, error: tError } = await supabase
      .from('transactions')
      .insert([transaction])
      .select()
      .single();

    if (tError) throw tError;

    // 2. אם יש פריטים, נכניס אותם עם ה-ID של ההוצאה שנוצרה
    if (items && items.length > 0) {
      const itemsWithId = items.map(item => ({
        ...item,
        transaction_id: newTransaction.id
      }));

      const { error: iError } = await supabase
        .from('transaction_items')
        .insert(itemsWithId);

      if (iError) throw iError;
    }

    res.status(201).json({ message: 'Success', data: newTransaction });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getAllTransactions = async (req, res) => {
    // לוגיקה לקבלת נתונים תבוא כאן
};