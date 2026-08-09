export const STATUS_LABELS = {
  open: 'פתוח',
  in_progress: 'בתהליך',
  waiting: 'המתנה',
  done: 'הושלם',
  cancelled: 'בוטל',
};

export const STATUS_PLURAL_LABELS = {
  open: 'פתוחות',
  in_progress: 'בתהליך',
  waiting: 'ממתינות',
  done: 'הושלמו',
  cancelled: 'בוטלו',
};

export const PRIORITY_LABELS = {
  low: 'נמוך',
  medium: 'בינוני',
  high: 'גבוה',
  urgent: 'דחוף',
};

export const CATEGORY_LABELS = {
  finance: 'פיננסי',
  personal: 'אישי',
  work: 'עבודה',
  system: 'מערכת',
  other: 'אחר',
};

export const COMPLETED_STATUSES = new Set(['done', 'cancelled']);

export const DEFAULT_TASK_FILTERS = Object.freeze({
  status: 'active',
  priority: 'all',
  category: 'all',
  search: '',
  overdue: false,
});

const PRIORITY_WEIGHT = { urgent: 0, high: 1, medium: 2, low: 3 };

const todayKey = () => new Date().toISOString().split('T')[0];

export const isOverdue = (task) => {
  if (!task.due_date || COMPLETED_STATUSES.has(task.status)) return false;
  return task.due_date < todayKey();
};

export const isDueToday = (task) => (
  Boolean(task.due_date)
  && !COMPLETED_STATUSES.has(task.status)
  && task.due_date === todayKey()
);

export const formatTaskDate = (date) => (
  new Date(`${date}T00:00:00`).toLocaleDateString('he-IL', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
);

export const getTaskStatusCounts = (tasks) => {
  const counts = {
    all: tasks.length,
    active: 0,
    open: 0,
    in_progress: 0,
    waiting: 0,
    done: 0,
    cancelled: 0,
  };

  tasks.forEach((task) => {
    if (task.status in counts) counts[task.status] += 1;
    if (!COMPLETED_STATUSES.has(task.status)) counts.active += 1;
  });

  return counts;
};

export const filterAndSortTasks = (tasks, filters) => {
  let result = tasks;

  if (filters.status === 'active') {
    result = result.filter((task) => !COMPLETED_STATUSES.has(task.status));
  } else if (filters.status !== 'all') {
    result = result.filter((task) => task.status === filters.status);
  }

  if (filters.priority !== 'all') {
    result = result.filter((task) => task.priority === filters.priority);
  }
  if (filters.category !== 'all') {
    result = result.filter((task) => task.category === filters.category);
  }
  if (filters.search) {
    const query = filters.search.toLowerCase();
    result = result.filter((task) => task.title.toLowerCase().includes(query));
  }
  if (filters.overdue) result = result.filter(isOverdue);

  return [...result].sort((first, second) => {
    const firstCompleted = COMPLETED_STATUSES.has(first.status) ? 1 : 0;
    const secondCompleted = COMPLETED_STATUSES.has(second.status) ? 1 : 0;
    if (firstCompleted !== secondCompleted) return firstCompleted - secondCompleted;

    const firstOverdue = isOverdue(first) ? 0 : 1;
    const secondOverdue = isOverdue(second) ? 0 : 1;
    if (firstOverdue !== secondOverdue) return firstOverdue - secondOverdue;

    const firstPriority = PRIORITY_WEIGHT[first.priority] ?? 2;
    const secondPriority = PRIORITY_WEIGHT[second.priority] ?? 2;
    if (firstPriority !== secondPriority) return firstPriority - secondPriority;

    if (first.due_date && second.due_date) {
      return first.due_date.localeCompare(second.due_date);
    }
    if (first.due_date) return -1;
    if (second.due_date) return 1;

    return new Date(second.created_at) - new Date(first.created_at);
  });
};

export const hasNonDefaultTaskFilters = (filters) => (
  filters.status !== DEFAULT_TASK_FILTERS.status
  || filters.priority !== DEFAULT_TASK_FILTERS.priority
  || filters.category !== DEFAULT_TASK_FILTERS.category
  || Boolean(filters.search)
  || filters.overdue
);
