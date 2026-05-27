export const PRIORITY_LABELS = {
  low:    'נמוך',
  medium: 'בינוני',
  high:   'גבוה',
  urgent: 'דחוף',
};

export const PRIORITY_COLORS = {
  low:    { bg: 'var(--surface-3)',    color: 'var(--ink-3)'      },
  medium: { bg: 'var(--primary-soft)', color: 'var(--primary-hi)' },
  high:   { bg: 'var(--warn-soft)',    color: 'var(--warn)'       },
  urgent: { bg: 'var(--neg-soft)',     color: 'var(--neg)'        },
};

const todayStr = () => new Date().toISOString().split('T')[0];

export const isOverdue = (task) => {
  if (!task.due_date) return false;
  if (task.status === 'done' || task.status === 'cancelled') return false;
  return task.due_date < todayStr();
};
