export const PRIORITY_LABELS = {
  low:    'נמוך',
  medium: 'בינוני',
  high:   'גבוה',
  urgent: 'דחוף',
};

export const PRIORITY_COLORS = {
  low:    { bg: '#F9FAFB', color: '#6B7280' },
  medium: { bg: '#EFF6FF', color: '#3B82F6' },
  high:   { bg: '#FFF7ED', color: '#EA580C' },
  urgent: { bg: '#FEF2F2', color: '#DC2626' },
};

const todayStr = () => new Date().toISOString().split('T')[0];

export const isOverdue = (task) => {
  if (!task.due_date) return false;
  if (task.status === 'done' || task.status === 'cancelled') return false;
  return task.due_date < todayStr();
};
