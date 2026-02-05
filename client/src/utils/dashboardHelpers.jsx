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