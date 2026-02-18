export const filterTransactionsByMonth = (transactions, date = new Date()) => {
  const targetMonth = date.getMonth();
  const targetYear = date.getFullYear();

  return transactions.filter(t => {
    const tDate = new Date(t.transaction_date);
    return tDate.getMonth() === targetMonth && tDate.getFullYear() === targetYear;
  });
};

export const preparePieChartData = (transactions) => {
  const categoryMap = transactions
    .filter(t => t.movement_type === 'expense')
    .reduce((acc, curr) => {
      const catName = curr.categories?.name || 'ללא קטגוריה';
      const amount = Number(curr.total_amount) || 0;

      if (!acc[catName]) {
        acc[catName] = 0;
      }
      acc[catName] += amount;
      return acc;
    }, {});

  return Object.keys(categoryMap).map(key => ({
    name: key,
    value: categoryMap[key]
  })).sort((a, b) => b.value - a.value); 
};

export const calculateSummaryStats = (transactions) => {
  let income = 0;
  let expenses = 0;

  transactions.forEach(t => {
    const amount = Number(t.total_amount) || 0;
    if (t.movement_type === 'income') {
      income += amount;
    } else if (t.movement_type === 'expense') {
      expenses += amount;
    }
  });

  return {
    income,
    expenses,
    balance: income - expenses
  };
};

const HEBREW_MONTHS = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];

export const prepareMonthlyChartData = (transactions, monthsBack = 6) => {
  const now = new Date();
  const result = [];

  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const month = d.getMonth();
    const year = d.getFullYear();

    const monthTransactions = transactions.filter(t => {
      const td = new Date(t.transaction_date);
      return td.getMonth() === month && td.getFullYear() === year;
    });

    let income = 0;
    let expenses = 0;
    monthTransactions.forEach(t => {
      const amount = Number(t.total_amount) || 0;
      if (t.movement_type === 'income') income += amount;
      else if (t.movement_type === 'expense') expenses += amount;
    });

    result.push({
      name: HEBREW_MONTHS[month],
      income,
      expenses,
    });
  }

  return result;
};