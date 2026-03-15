export const sortBySetNumber = (sets) => {
  return [...sets].sort((a, b) => {
    const [mainA, subA = 0] = a.set_number.split('-').map(Number);
    const [mainB, subB = 0] = b.set_number.split('-').map(Number);
    if (mainA !== mainB) return mainA - mainB;
    return subA - subB;
  });
};

export const calculateStats = (sets) => {
  const totalSets = sets.length;
  const totalValue = sets.reduce((sum, set) => sum + (Number(set.original_price) || Number(set.purchase_price) || 0), 0);
  const totalPaid = sets.reduce((sum, set) => sum + (Number(set.purchase_price) || 0), 0);
  const totalSaved = totalValue - totalPaid;
  return { totalSets, totalValue, totalPaid, totalSaved };
};

export const STATUS_OPTIONS = [
  { key: 'All', label: 'הכל' },
  { key: 'New', label: 'חדש בקופסה' },
  { key: 'In Progress', label: 'בבנייה' },
  { key: 'Built', label: 'בנוי' },
];

export const BRAND_OPTIONS = ['LEGO', 'CaDA', 'Mould King', 'Cobi', 'Other'];
