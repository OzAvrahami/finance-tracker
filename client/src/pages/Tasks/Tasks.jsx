import React, { useState, useEffect, useMemo } from 'react';
import { CheckSquare, Plus, Pencil, Trash2, AlertCircle } from 'lucide-react';
import { getTasks, deleteTask, updateTask } from '../../services/api';
import TaskModal from '../../components/TaskModal';
import { PRIORITY_LABELS, isOverdue } from '../../utils/taskHelpers';
import style from './Tasks.module.css'

// --- Label & color maps (English slug → Hebrew display) ---

export const STATUS_LABELS = {
  open: 'פתוח',
  in_progress: 'בתהליך',
  waiting: 'המתנה',
  done: 'הושלם',
  cancelled: 'בוטל',
};

export const STATUS_COLORS = {
  open:        { bg: 'var(--surface-3)',   color: 'var(--ink-3)',   border: 'var(--border-strong)' },
  in_progress: { bg: 'var(--info-soft)',   color: 'var(--info)',    border: 'rgba(90,200,255,0.25)' },
  waiting:     { bg: 'var(--warn-soft)',   color: 'var(--warn)',    border: 'rgba(255,192,97,0.25)' },
  done:        { bg: 'var(--pos-soft)',    color: 'var(--pos)',     border: 'rgba(74,222,154,0.25)' },
  cancelled:   { bg: 'var(--surface-3)',   color: 'var(--ink-5)',   border: 'var(--border)' },
};

// Dark-friendly priority badge colors (overrides taskHelpers light values)
const DARK_PRIORITY_COLORS = {
  urgent: { bg: 'var(--neg-soft)',     color: 'var(--neg)' },
  high:   { bg: 'var(--warn-soft)',    color: 'var(--warn)' },
  medium: { bg: 'var(--primary-soft)', color: 'var(--primary-hi)' },
  low:    { bg: 'var(--surface-3)',    color: 'var(--ink-3)' },
};

export const CATEGORY_LABELS = {
  finance:  'פיננסי',
  personal: 'אישי',
  work:     'עבודה',
  system:   'מערכת',
  other:    'אחר',
};

const PRIORITY_WEIGHT = { urgent: 0, high: 1, medium: 2, low: 3 };

const STATUS_TABS = [
  { value: 'all', label: 'הכל' },
  { value: 'open', label: STATUS_LABELS.open },
  { value: 'in_progress', label: STATUS_LABELS.in_progress },
  { value: 'waiting', label: STATUS_LABELS.waiting },
  { value: 'done', label: STATUS_LABELS.done },
  { value: 'cancelled', label: STATUS_LABELS.cancelled },
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
  { value: 'finance', label: CATEGORY_LABELS.finance },
  { value: 'personal', label: CATEGORY_LABELS.personal },
  { value: 'work', label: CATEGORY_LABELS.work },
  { value: 'system', label: CATEGORY_LABELS.system },
  { value: 'other', label: CATEGORY_LABELS.other },
];

// --- Date helpers ---

const todayStr = () => new Date().toISOString().split('T')[0];

const isDueToday = (task) => {
  if (!task.due_date || task.status === 'done' || task.status === 'cancelled') return false;
  return task.due_date === todayStr();
};

const formatDate = (dateStr) =>
  new Date(dateStr + 'T00:00:00').toLocaleDateString('he-IL', {
    day: 'numeric', month: 'short', year: 'numeric',
  });

// --- Main Page ---

const Tasks = () => {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [filters, setFilters] = useState({
    status: 'all',
    priority: 'all',
    category: 'all',
    search: '',
    overdue: false,
  });

  const fetchTasks = async () => {
    try {
      const res = await getTasks();
      setTasks(res.data);
    } catch (error) {
      console.error('fetchTasks Error:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTasks(); }, []);

  const statusCounts = useMemo(() => {
    const counts = { all: tasks.length, open: 0, in_progress: 0, waiting: 0, done: 0, cancelled: 0 };
    tasks.forEach(t => { if (t.status in counts) counts[t.status]++; });
    return counts;
  }, [tasks]);

  const overdueCount = useMemo(() => tasks.filter(isOverdue).length, [tasks]);

  const filteredTasks = useMemo(() => {
    let result = tasks;
    if (filters.status !== 'all') result = result.filter(t => t.status === filters.status);
    if (filters.priority !== 'all') result = result.filter(t => t.priority === filters.priority);
    if (filters.category !== 'all') result = result.filter(t => t.category === filters.category);
    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(t => t.title.toLowerCase().includes(q));
    }
    if (filters.overdue) result = result.filter(isOverdue);

    return [...result].sort((a, b) => {
      const aOver = isOverdue(a) ? 0 : 1;
      const bOver = isOverdue(b) ? 0 : 1;
      if (aOver !== bOver) return aOver - bOver;
      const pa = PRIORITY_WEIGHT[a.priority] ?? 2;
      const pb = PRIORITY_WEIGHT[b.priority] ?? 2;
      if (pa !== pb) return pa - pb;
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      return new Date(b.created_at) - new Date(a.created_at);
    });
  }, [tasks, filters]);

  const handleEdit = (task) => { setEditingTask(task); setShowModal(true); };
  const handleNew = () => { setEditingTask(null); setShowModal(true); };
  const handleModalClose = () => { setShowModal(false); setEditingTask(null); };
  const handleModalSave = () => { setShowModal(false); setEditingTask(null); fetchTasks(); };

  const handleDelete = async (id) => {
    if (!window.confirm('למחוק משימה זו?')) return;
    try {
      await deleteTask(id);
      fetchTasks();
    } catch (error) {
      console.error('deleteTask Error:', error);
      alert('שגיאה במחיקת המשימה');
    }
  };

  const handleStatusToggle = async (task) => {
    const next = task.status === 'done' ? 'open' : 'done';
    try {
      await updateTask(task.id, { status: next });
      fetchTasks();
    } catch (error) {
      console.error('handleStatusToggle Error:', error);
    }
  };

  const hasActiveFilter = filters.status !== 'all' || filters.priority !== 'all' ||
    filters.category !== 'all' || filters.search || filters.overdue;

  if (loading) {
    return (
      <div style={{ textAlign: 'center', marginTop: 80, color: 'var(--ink-4)', fontSize: 16 }}>
        טוען משימות...
      </div>
    );
  }

  return (
    <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <div className={style.header}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--ink-1)', margin: 0 }}>יומן משימות</h1>
          <p style={{ margin: '4px 0 0 0', color: 'var(--ink-4)', fontSize: 14 }}>
            {tasks.length} משימות סה״כ
            {overdueCount > 0 && (
              <span style={{ color: 'var(--neg)', marginInlineEnd: 8, fontWeight: 600 }}>
                · {overdueCount} באיחור
              </span>
            )}
          </p>
        </div>
        <button onClick={handleNew} style={newBtnStyle}>
          <Plus size={16} style={{ marginLeft: 6 }} />
          משימה חדשה
        </button>
      </div>

      {/* Status Tabs */}
      <div style={{ display: 'flex', gap: 0, flexWrap: 'wrap', borderBottom: '2px solid var(--border-strong)' }}>
        {STATUS_TABS.map(tab => {
          const active = filters.status === tab.value && !filters.overdue;
          return (
            <button
              key={tab.value}
              onClick={() => setFilters(f => ({ ...f, status: tab.value, overdue: false }))}
              style={{
                padding: '10px 16px',
                border: 'none',
                borderBottom: active ? '2px solid var(--primary-hi)' : '2px solid transparent',
                marginBottom: -2,
                background: 'none',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: active ? 600 : 400,
                color: active ? 'var(--primary-hi)' : 'var(--ink-4)',
                transition: 'all 0.15s',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {tab.label}
              <span style={{
                fontSize: 11,
                backgroundColor: active ? 'var(--primary-soft)' : 'var(--surface-3)',
                color: active ? 'var(--primary-hi)' : 'var(--ink-4)',
                padding: '1px 6px',
                borderRadius: 9999,
                fontWeight: 500,
              }}>
                {statusCounts[tab.value] ?? 0}
              </span>
            </button>
          );
        })}
        {overdueCount > 0 && (
          <button
            onClick={() => setFilters(f => ({ ...f, status: 'all', overdue: !f.overdue }))}
            style={{
              padding: '10px 16px',
              border: 'none',
              borderBottom: filters.overdue ? '2px solid var(--neg)' : '2px solid transparent',
              marginBottom: -2,
              background: 'none',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: filters.overdue ? 600 : 400,
              color: filters.overdue ? 'var(--neg)' : 'var(--ink-4)',
              transition: 'all 0.15s',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <AlertCircle size={13} />
            באיחור
            <span style={{
              fontSize: 11,
              backgroundColor: 'var(--neg-soft)',
              color: 'var(--neg)',
              padding: '1px 6px',
              borderRadius: 9999,
              fontWeight: 600,
            }}>
              {overdueCount}
            </span>
          </button>
        )}
      </div>

      {/* Secondary Filters */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={filters.priority}
          onChange={e => setFilters(f => ({ ...f, priority: e.target.value }))}
          style={filterSelectStyle}
        >
          {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select
          value={filters.category}
          onChange={e => setFilters(f => ({ ...f, category: e.target.value }))}
          style={filterSelectStyle}
        >
          {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <input
          type="text"
          placeholder="חיפוש לפי כותרת..."
          value={filters.search}
          onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
          style={{ ...filterSelectStyle, minWidth: 200, flex: 1 }}
        />
        {hasActiveFilter && (
          <button
            onClick={() => setFilters({ status: 'all', priority: 'all', category: 'all', search: '', overdue: false })}
            style={{
              padding: '8px 14px',
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--surface-3)',
              cursor: 'pointer',
              fontSize: 13,
              color: 'var(--ink-3)',
            }}
          >
            נקה סינון
          </button>
        )}
      </div>

      {/* Task List */}
      {filteredTasks.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '60px 32px',
          backgroundColor: 'var(--surface-2)',
          borderRadius: 16,
          border: '1px solid var(--border)',
          color: 'var(--ink-4)',
        }}>
          <CheckSquare size={40} color="#353B52" style={{ marginBottom: 16 }} />
          <p style={{ fontSize: 16, fontWeight: 500, margin: 0 }}>אין משימות להצגה</p>
          <p style={{ fontSize: 14, margin: '8px 0 0 0' }}>
            {tasks.length === 0
              ? 'לחץ על "משימה חדשה" כדי להתחיל'
              : 'נסה לשנות את הסינון'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filteredTasks.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              onEdit={() => handleEdit(task)}
              onDelete={() => handleDelete(task.id)}
              onStatusToggle={() => handleStatusToggle(task)}
            />
          ))}
        </div>
      )}

      <TaskModal
        show={showModal}
        task={editingTask}
        onClose={handleModalClose}
        onSave={handleModalSave}
      />
    </div>
  );
};

// --- TaskCard ---

const TaskCard = ({ task, onEdit, onDelete, onStatusToggle }) => {
  const overdue = isOverdue(task);
  const dueToday = isDueToday(task);
  const done = task.status === 'done';
  const cancelled = task.status === 'cancelled';
  const dimmed = done || cancelled;

  const statusCfg = STATUS_COLORS[task.status] || STATUS_COLORS.open;
  const priorityCfg = DARK_PRIORITY_COLORS[task.priority] || DARK_PRIORITY_COLORS.medium;

  let dueDateColor = 'var(--ink-4)';
  if (overdue) dueDateColor = 'var(--neg)';
  else if (dueToday) dueDateColor = 'var(--warn)';

  return (
    <div style={{
      backgroundColor: 'var(--surface-2)',
      border: overdue ? '1px solid rgba(255,122,138,0.3)' : '1px solid var(--border)',
      borderRadius: 12,
      padding: '16px 20px',
      display: 'flex',
      gap: 14,
      alignItems: 'flex-start',
      opacity: dimmed ? 0.6 : 1,
      transition: 'opacity 0.15s',
      boxShadow: 'var(--shadow-sm)',
    }}>
      {/* Done toggle */}
      <button
        onClick={onStatusToggle}
        title={done ? 'סמן כפתוח' : 'סמן כהושלם'}
        style={{
          width: 20, height: 20,
          borderRadius: '50%',
          border: done ? 'none' : '2px solid var(--ink-5)',
          backgroundColor: done ? 'var(--pos)' : 'transparent',
          cursor: 'pointer',
          flexShrink: 0,
          marginTop: 3,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white',
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        {done ? '✓' : ''}
      </button>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Badges row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
          <span style={{
            fontSize: 11, fontWeight: 700,
            padding: '2px 8px', borderRadius: 9999,
            backgroundColor: priorityCfg.bg, color: priorityCfg.color,
          }}>
            {PRIORITY_LABELS[task.priority]}
          </span>
          <span style={{
            fontSize: 11, fontWeight: 500,
            padding: '2px 8px', borderRadius: 9999,
            backgroundColor: statusCfg.bg, color: statusCfg.color,
            border: `1px solid ${statusCfg.border}`,
          }}>
            {STATUS_LABELS[task.status]}
          </span>
          <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
            {CATEGORY_LABELS[task.category]}
          </span>
          {overdue && (
            <span style={{
              fontSize: 11, color: 'var(--neg)', fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 3,
            }}>
              <AlertCircle size={11} />
              באיחור
            </span>
          )}
        </div>

        {/* Title */}
        <p style={{
          margin: 0, fontSize: 15, fontWeight: 600,
          color: dimmed ? 'var(--ink-4)' : 'var(--ink-1)',
          textDecoration: done ? 'line-through' : 'none',
        }}>
          {task.title}
        </p>

        {/* Notes snippet */}
        {task.notes && (
          <p style={{
            margin: '4px 0 0 0', fontSize: 13, color: 'var(--ink-4)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {task.notes}
          </p>
        )}

        {/* Footer meta */}
        <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {task.due_date && (
            <span style={{ fontSize: 12, color: dueDateColor, fontWeight: overdue || dueToday ? 600 : 400 }}>
              יעד: {formatDate(task.due_date)}
              {overdue && ' · באיחור'}
              {dueToday && ' · היום'}
            </span>
          )}
          {task.transactions && (
            <span style={{
              fontSize: 12, color: 'var(--ink-3)',
              backgroundColor: 'var(--surface-3)',
              padding: '2px 8px', borderRadius: 6,
            }}>
              תנועה: {task.transactions.description}
            </span>
          )}
          {task.loans && (
            <span style={{
              fontSize: 12, color: 'var(--ink-3)',
              backgroundColor: 'var(--surface-3)',
              padding: '2px 8px', borderRadius: 6,
            }}>
              הלוואה: {task.loans.name}
            </span>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        <button onClick={onEdit} title="עריכה" style={iconBtnStyle('var(--primary-soft)', 'var(--primary-hi)')}>
          <Pencil size={14} />
        </button>
        <button onClick={onDelete} title="מחיקה" style={iconBtnStyle('var(--neg-soft)', 'var(--neg)')}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
};

// --- Styles ---

const newBtnStyle = {
  display: 'flex', alignItems: 'center',
  background: 'var(--primary-grad)', color: 'var(--primary-ink)',
  border: 'none', borderRadius: 10,
  padding: '10px 20px', fontSize: 14, fontWeight: 600,
  cursor: 'pointer',
};
const filterSelectStyle = {
  padding: '8px 12px',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 13,
  color: 'var(--ink-2)',
  backgroundColor: 'var(--surface-2)',
  outline: 'none',
};
const iconBtnStyle = (bg, color) => ({
  backgroundColor: bg, color,
  border: 'none', borderRadius: 8,
  padding: '6px 8px', cursor: 'pointer',
  display: 'flex', alignItems: 'center',
});

export default Tasks;
