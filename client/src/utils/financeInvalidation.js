export const FINANCE_CHANGED = 'finance:cash-changed';
export const invalidateFinance = (result = {}) => {
  window.dispatchEvent(new CustomEvent(FINANCE_CHANGED, { detail: result }));
  window.dispatchEvent(new CustomEvent('finance:savings-changed', { detail: result }));
};
