module.exports = {
  'cal_bank': {
    label: 'כרטיס אשראי - כאל בנקאי (Cal)',
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

  'cal': {
    label: 'כרטיס אשראי - כאל (Cal)',
    startRow: 3,

    columnsMapping: {
      date: 'תאריך עסקה',
      description: 'שם בית העסק',
      amount: 'סכום חיוב',
      originalAmount: 'סכום עסקה',
      installments: 'הערות'
    },

    isValidRow: (row) => {
      return row['תאריך עסקה'] && row['שם בית העסק'];
    }
  },

  'max': {
    label: 'כרטיס אשראי - מקס (Max)',
    startRow: 3,

    columnsMapping: {
      date: 'תאריך עסקה',
      description: 'שם בית העסק',
      amount: 'סכום חיוב',
      originalAmount: 'סכום עסקה',
      currency: 'מטבע חיוב',
      installments: 'הערות',
      charge_date: 'תאריך חיוב'
    },

    isValidRow: (row) => {
      return row['תאריך עסקה'] &&row['שם בית העסק'];
    }
  }

};