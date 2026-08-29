import { compareMoney } from '../../utils/money';

export const buildAnnualInsights = (data) => {
  const mostExpensiveMonth = data.monthly.reduce(
    (best, month) => (!best || compareMoney(month.actual, best.actual) > 0 ? month : best),
    null,
  );
  const biggestOverrun = data.categories
    .filter((category) => compareMoney(category.diff) < 0)
    .sort((first, second) => compareMoney(first.diff, second.diff))[0] || null;
  return { mostExpensiveMonth, biggestOverrun };
};
