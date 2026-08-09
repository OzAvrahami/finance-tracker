import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FilterX, ListChecks, Plus, SearchX, X } from 'lucide-react';
import { PageHeaderContext } from '../../context/PageHeaderContext';
import { deleteTask, getTasks, updateTask } from '../../services/api';
import TaskModal from '../../components/TaskModal';
import {
  Alert,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  PrimaryButton,
  SearchField,
  SecondaryButton,
  Select,
  Skeleton,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from '../../components/ui';
import {
  CATEGORY_LABELS,
  DEFAULT_TASK_FILTERS,
  PRIORITY_LABELS,
  STATUS_PLURAL_LABELS,
  filterAndSortTasks,
  getTaskStatusCounts,
  hasNonDefaultTaskFilters,
  isOverdue,
} from '../../utils/taskHelpers';
import TaskCard from './TaskCard';
import styles from './Tasks.module.css';

const STATUS_TABS = [
  { value: 'all', label: 'הכול' },
  { value: 'active', label: 'פעילות' },
  { value: 'open', label: 'פתוחות' },
  { value: 'in_progress', label: 'בתהליך' },
  { value: 'waiting', label: 'ממתינות' },
  { value: 'done', label: 'הושלמו' },
  { value: 'cancelled', label: 'בוטלו' },
];

const PRIORITY_OPTIONS = [
  { value: 'all', label: 'כל העדיפויות' },
  { value: 'urgent', label: PRIORITY_LABELS.urgent },
  { value: 'high', label: PRIORITY_LABELS.high },
  { value: 'medium', label: PRIORITY_LABELS.medium },
  { value: 'low', label: PRIORITY_LABELS.low },
];

const CATEGORY_OPTIONS = [
  { value: 'all', label: 'כל הקטגוריות' },
  ...Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label })),
];

const createDefaultFilters = () => ({ ...DEFAULT_TASK_FILTERS });

const TasksSkeleton = () => (
  <div className={styles.tasksSkeleton} role="status" aria-label="טעינת מטלות">
    <span className={styles.visuallyHidden}>טוען את רשימת המטלות</span>
    <Skeleton height={128} borderRadius="var(--ft-radius-card)" aria-hidden="true" />
    <div className={styles.taskGrid} aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} height={184} borderRadius="var(--ft-radius-xl)" />
      ))}
    </div>
  </div>
);

const Tasks = () => {
  const { setPageHeader } = useContext(PageHeaderContext);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [filters, setFilters] = useState(createDefaultFilters);
  const [mutationError, setMutationError] = useState('');
  const [pendingStatusId, setPendingStatusId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const dialogReturnFocusRef = useRef(null);
  const deleteReturnFocusRef = useRef(null);

  const openNew = useCallback((event) => {
    dialogReturnFocusRef.current = event?.currentTarget || null;
    setEditingTask(null);
    setMutationError('');
    setShowModal(true);
  }, []);

  useEffect(() => {
    setPageHeader({
      title: 'מטלות',
      subtitle: 'מעקב מטלות פיננסיות לפי סטטוס ועדיפות',
      primaryAction: {
        label: 'מטלה חדשה',
        icon: Plus,
        onClick: openNew,
      },
    });
  }, [openNew, setPageHeader]);

  const fetchTasks = useCallback(async ({ showLoading = true } = {}) => {
    if (showLoading) setLoading(true);
    setLoadError(false);

    try {
      const response = await getTasks();
      setTasks(Array.isArray(response.data) ? response.data : []);
      return true;
    } catch {
      if (showLoading) setLoadError(true);
      return false;
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const statusCounts = useMemo(() => getTaskStatusCounts(tasks), [tasks]);
  const overdueCount = useMemo(() => tasks.filter(isOverdue).length, [tasks]);
  const filteredTasks = useMemo(() => filterAndSortTasks(tasks, filters), [filters, tasks]);
  const hasActiveFilters = hasNonDefaultTaskFilters(filters);

  const updateFilter = (name, value) => {
    setFilters((current) => ({ ...current, [name]: value }));
  };

  const resetFilters = () => setFilters(createDefaultFilters());

  const openEdit = (task, event) => {
    dialogReturnFocusRef.current = event.currentTarget;
    setEditingTask(task);
    setMutationError('');
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingTask(null);
  };

  const handleModalSave = async () => {
    closeModal();
    await fetchTasks({ showLoading: false });
  };

  const requestDelete = (task, event) => {
    deleteReturnFocusRef.current = event.currentTarget;
    setDeleteTarget(task);
  };

  const confirmDelete = async () => {
    await deleteTask(deleteTarget.id);
    await fetchTasks({ showLoading: false });
  };

  const toggleStatus = async (task) => {
    if (pendingStatusId !== null) return;
    const nextStatus = task.status === 'done' ? 'open' : 'done';

    setPendingStatusId(task.id);
    setMutationError('');
    try {
      await updateTask(task.id, { status: nextStatus });
      await fetchTasks({ showLoading: false });
    } catch {
      setMutationError('עדכון סטטוס המטלה נכשל. המטלה נשארה ללא שינוי.');
    } finally {
      setPendingStatusId(null);
    }
  };

  const activeFilterChips = [
    filters.status !== DEFAULT_TASK_FILTERS.status && {
      key: 'status',
      label: `סטטוס: ${filters.status === 'all' ? 'הכול' : STATUS_PLURAL_LABELS[filters.status]}`,
      clear: () => updateFilter('status', DEFAULT_TASK_FILTERS.status),
    },
    filters.overdue && {
      key: 'overdue',
      label: 'באיחור בלבד',
      clear: () => updateFilter('overdue', false),
    },
    filters.priority !== 'all' && {
      key: 'priority',
      label: `עדיפות: ${PRIORITY_LABELS[filters.priority]}`,
      clear: () => updateFilter('priority', 'all'),
    },
    filters.category !== 'all' && {
      key: 'category',
      label: `קטגוריה: ${CATEGORY_LABELS[filters.category]}`,
      clear: () => updateFilter('category', 'all'),
    },
    filters.search && {
      key: 'search',
      label: `חיפוש: ${filters.search}`,
      clear: () => updateFilter('search', ''),
    },
  ].filter(Boolean);

  const renderResults = () => {
    if (tasks.length === 0) {
      return (
        <EmptyState
          icon={ListChecks}
          title="אין מטלות"
          description="מטלות עוזרות לעקוב אחרי תשלומים, בירורים ומשימות תחזוקה פיננסיות."
          primaryAction={(
            <PrimaryButton type="button" onClick={openNew}>
              <Plus size={16} aria-hidden="true" />
              מטלה חדשה
            </PrimaryButton>
          )}
        />
      );
    }

    if (filteredTasks.length === 0) {
      const defaultActiveEmpty = !hasActiveFilters && filters.status === 'active';
      return (
        <EmptyState
          variant={defaultActiveEmpty ? 'dataset' : 'filtered'}
          icon={defaultActiveEmpty ? ListChecks : SearchX}
          title={defaultActiveEmpty ? 'הכול סגור' : 'אין מטלות שמתאימות למסננים'}
          description={defaultActiveEmpty
            ? 'אין כרגע מטלות פעילות. כל המטלות סומנו כהושלמו או בוטלו.'
            : 'אפשר לנקות את המסננים ולראות שוב את המטלות הפעילות.'}
          primaryAction={defaultActiveEmpty ? (
            <SecondaryButton type="button" onClick={openNew}>
              <Plus size={16} aria-hidden="true" />
              מטלה חדשה
            </SecondaryButton>
          ) : (
            <SecondaryButton type="button" onClick={resetFilters}>ניקוי מסננים</SecondaryButton>
          )}
        />
      );
    }

    return (
      <div className={styles.taskGrid} aria-label="רשימת מטלות">
        {filteredTasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            pendingStatus={pendingStatusId === task.id}
            onEdit={(event) => openEdit(task, event)}
            onDelete={(event) => requestDelete(task, event)}
            onStatusToggle={() => toggleStatus(task)}
          />
        ))}
      </div>
    );
  };

  return (
    <div className={styles.tasksPage} dir="rtl">
      {loading && <TasksSkeleton />}

      {!loading && loadError && (
        <ErrorState
          level="page"
          title="טעינת המטלות נכשלה"
          description="לא ניתן להציג את רשימת המטלות כרגע."
          retryLabel="נסה שוב"
          onRetry={fetchTasks}
        />
      )}

      {!loading && !loadError && (
        <Tabs
          value={filters.status}
          onValueChange={(status) => setFilters((current) => ({ ...current, status, overdue: false }))}
          className={styles.tasksTabs}
        >
          <section className={styles.filterPanel} aria-label="סינון מטלות">
            <TabList className={styles.statusTabs} aria-label="סינון לפי סטטוס">
              {STATUS_TABS.map((tab) => (
                <Tab key={tab.value} value={tab.value} badge={statusCounts[tab.value]}>
                  {tab.label}
                </Tab>
              ))}
              {overdueCount > 0 && (
                <button
                  type="button"
                  className={`${styles.overdueFilter}${filters.overdue ? ` ${styles.overdueFilterActive}` : ''}`}
                  aria-pressed={filters.overdue}
                  onClick={() => setFilters((current) => ({
                    ...current,
                    status: 'all',
                    overdue: !current.overdue,
                  }))}
                >
                  <AlertTriangle size={15} aria-hidden="true" />
                  באיחור
                  <span>{overdueCount}</span>
                </button>
              )}
            </TabList>

            <div className={styles.secondaryFilters}>
              <SearchField
                className={styles.searchField}
                size="compact"
                aria-label="חיפוש לפי כותרת"
                placeholder="חיפוש בכותרת המטלה"
                value={filters.search}
                onValueChange={(value) => updateFilter('search', value)}
              />
              <Select
                className={styles.filterSelect}
                size="compact"
                aria-label="עדיפות"
                value={filters.priority}
                onValueChange={(value) => updateFilter('priority', value)}
              >
                {PRIORITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
              <Select
                className={styles.filterSelect}
                size="compact"
                aria-label="קטגוריית מטלה"
                value={filters.category}
                onValueChange={(value) => updateFilter('category', value)}
              >
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
              {hasActiveFilters && (
                <SecondaryButton type="button" size="sm" className={styles.resetButton} onClick={resetFilters}>
                  <FilterX size={15} aria-hidden="true" />
                  ניקוי מסננים
                </SecondaryButton>
              )}
            </div>

            {activeFilterChips.length > 0 && (
              <div className={styles.activeFilters} aria-label="מסננים פעילים">
                {activeFilterChips.map((chip) => (
                  <span key={chip.key} className={styles.filterChip}>
                    <span dir="auto">{chip.label}</span>
                    <IconButton
                      type="button"
                      size={30}
                      className={styles.removeFilter}
                      aria-label={`הסרת המסנן ${chip.label}`}
                      onClick={chip.clear}
                    >
                      <X size={14} aria-hidden="true" />
                    </IconButton>
                  </span>
                ))}
              </div>
            )}
          </section>

          {mutationError && (
            <Alert variant="error" urgent onDismiss={() => setMutationError('')}>
              {mutationError}
            </Alert>
          )}

          {STATUS_TABS.map((tab) => (
            <TabPanel key={tab.value} value={tab.value} className={styles.resultsPanel}>
              {filters.status === tab.value ? renderResults() : null}
            </TabPanel>
          ))}
        </Tabs>
      )}

      <TaskModal
        show={showModal}
        task={editingTask}
        onClose={closeModal}
        onSave={handleModalSave}
        returnFocusRef={dialogReturnFocusRef}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="מחיקת מטלה"
        message={deleteTarget ? `למחוק את המטלה „${deleteTarget.title}”? לא ניתן לבטל פעולה זו.` : ''}
        confirmLabel="מחיקת המטלה"
        cancelLabel="ביטול"
        variant="destructive"
        errorMessage="מחיקת המטלה נכשלה. המטלה נשארה ברשימה."
        returnFocusRef={deleteReturnFocusRef}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
};

export default Tasks;
