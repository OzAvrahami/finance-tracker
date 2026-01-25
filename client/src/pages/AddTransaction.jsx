import React, { useState } from 'react';
import { createTransaction } from '../services/api';

const AddTransaction = () => {
  const [transaction, setTransaction] = useState({
    type: 'expense',
    category: '',
    description: '',
    total_amount: 0,
    transaction_date: new Date().toISOString().split('T')[0],
    payment_method: 'Credit Card'
  });

  const [items, setItems] = useState([{ item_name: '', quantity: 1, price_per_unit: 0, total_item_price: 0 }]);

  // פונקציה להוספת שורת פריט חדשה
  const addItemRow = () => {
    setItems([...items, { item_name: '', quantity: 1, price_per_unit: 0, total_item_price: 0 }]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await createTransaction({ transaction, items });
      alert('ההוצאה נשמרה בהצלחה!');
    } catch (error) {
      console.error("Error saving:", error);
    }
  };

  return (
    <div dir="rtl" style={{ padding: '20px' }}>
      <h2>הוספת הוצאה חדשה</h2>
      <form onSubmit={handleSubmit}>
        {/* כאן יבואו שדות ההוצאה הראשית */}
        <input type="text" placeholder="תיאור (למשל: קנייה בשופרסל)" 
               onChange={(e) => setTransaction({...transaction, description: e.target.value})} />
        
        <hr />
        <h3>פירוט פריטים</h3>
        {items.map((item, index) => (
          <div key={index} style={{ marginBottom: '10px' }}>
            <input type="text" placeholder="שם הפריט" />
            <input type="number" placeholder="כמות" style={{ width: '50px' }} />
            <input type="number" placeholder="מחיר ליחידה" />
          </div>
        ))}
        <button type="button" onClick={addItemRow}>+ הוסף פריט</button>
        <br /><br />
        <button type="submit" style={{ backgroundColor: 'green', color: 'white' }}>שמור הכל</button>
      </form>
    </div>
  );
};

export default AddTransaction;