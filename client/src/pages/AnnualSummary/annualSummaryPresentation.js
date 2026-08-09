export const buildAnnualInsights = (data) => {
  const mostExpensiveMonth = data.monthly.reduce(
    (best, month) => (month.actual > (best?.actual || 0) ? month : best),
    null,
  );
  const biggestOverrun = data.categories
    .filter((category) => category.diff < 0)
    .sort((first, second) => first.diff - second.diff)[0] || null;
  return { mostExpensiveMonth, biggestOverrun };
};
