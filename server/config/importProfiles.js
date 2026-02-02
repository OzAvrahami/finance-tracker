module.exports = {
  'cal': {
    label: 'כרטיס אשראי - כאל (Cal)',
    startRow: 8, // Start to read from line 8 in the excel file
    
    // name of Colum in DB
    columnsMapping: {
      source: 'כרטיס',
      date: 'תאריך עסקה',
      description: 'בית עסק',
      amount: 'סכום החיוב',         // הסכום הקובע (בשקלים)
      originalAmount: 'סכום העסקה', // הסכום המקורי
      currency: 'מטבע העסקה',       // מטבע מקורי (USD וכו')
      exchangeRate: 'שער ההמרה',    // שער המרה
      installments: 'פירוט',         // מידע על תשלומים
      charge_date: 'תאריך החיוב'
    },

    isValidRow: (row) => {
      return row['תאריך עסקה'] && row['בית עסק'];
    }
  },

  // מקום להוסיף בעתיד:
  // 'max': { ... },
  // 'bank_hapoalim': { ... }
};