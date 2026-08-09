import { useId } from 'react';
import {
  AlertTriangle,
  BriefcaseBusiness,
  CalendarClock,
  Check,
  Circle,
  CircleCheck,
  Clock3,
  Flag,
  Landmark,
  Link as LinkIcon,
  ListTodo,
  Pencil,
  RotateCcw,
  Tag,
  Trash2,
  UserRound,
  Wrench,
  XCircle,
} from 'lucide-react';
import { IconButton, MoneyAmount, TechnicalValue } from '../../components/ui';
import {
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  formatTaskDate,
  isDueToday,
  isOverdue,
} from '../../utils/taskHelpers';
import styles from './Tasks.module.css';

const STATUS_ICONS = {
  open: Circle,
  in_progress: Clock3,
  waiting: Clock3,
  done: CircleCheck,
  cancelled: XCircle,
};

const PRIORITY_ICONS = {
  low: Flag,
  medium: Flag,
  high: AlertTriangle,
  urgent: AlertTriangle,
};

const CATEGORY_ICONS = {
  finance: Landmark,
  personal: UserRound,
  work: BriefcaseBusiness,
  system: Wrench,
  other: Tag,
};

const TaskCard = ({
  task,
  pendingStatus,
  onEdit,
  onDelete,
  onStatusToggle,
}) => {
  const generatedId = useId().replaceAll(':', '');
  const titleId = `task-title-${generatedId}`;
  const overdue = isOverdue(task);
  const dueToday = isDueToday(task);
  const completed = task.status === 'done';
  const closed = completed || task.status === 'cancelled';
  const StatusIcon = STATUS_ICONS[task.status] || ListTodo;
  const PriorityIcon = PRIORITY_ICONS[task.priority] || Flag;
  const CategoryIcon = CATEGORY_ICONS[task.category] || Tag;
  const statusActionLabel = completed ? 'פתיחה מחדש' : 'סימון כהושלמה';

  return (
    <article
      className={`${styles.taskCard}${overdue ? ` ${styles.taskCardOverdue}` : ''}${closed ? ` ${styles.taskCardClosed}` : ''}`}
      aria-labelledby={titleId}
    >
      <span className={`${styles.priorityRail} ${styles[`priorityRail_${task.priority}`]}`} aria-hidden="true" />

      <div className={styles.taskCardHeader}>
        <div className={styles.taskCopy}>
          <h3 id={titleId} className={styles.taskTitle} dir="auto">{task.title}</h3>
          {task.notes && <p className={styles.taskNotes} dir="auto">{task.notes}</p>}
        </div>
        <div className={styles.cardActions}>
          <IconButton
            type="button"
            size={36}
            className={styles.cardAction}
            aria-label={`עריכת המטלה ${task.title}`}
            onClick={onEdit}
          >
            <Pencil size={15} aria-hidden="true" />
          </IconButton>
          <IconButton
            type="button"
            size={36}
            className={`${styles.cardAction} ${styles.deleteAction}`}
            aria-label={`מחיקת המטלה ${task.title}`}
            onClick={onDelete}
          >
            <Trash2 size={15} aria-hidden="true" />
          </IconButton>
        </div>
      </div>

      <div className={styles.taskBadges} aria-label="מאפייני המטלה">
        <span className={`${styles.taskBadge} ${styles[`status_${task.status}`]}`}>
          <StatusIcon size={13} aria-hidden="true" />
          {STATUS_LABELS[task.status] || task.status}
        </span>
        <span className={`${styles.taskBadge} ${styles[`priority_${task.priority}`]}`}>
          <PriorityIcon size={13} aria-hidden="true" />
          עדיפות {PRIORITY_LABELS[task.priority] || task.priority}
        </span>
        <span className={`${styles.taskBadge} ${styles.categoryBadge}`}>
          <CategoryIcon size={13} aria-hidden="true" />
          {CATEGORY_LABELS[task.category] || task.category}
        </span>
        {overdue && (
          <span className={`${styles.taskBadge} ${styles.overdueBadge}`}>
            <AlertTriangle size={13} aria-hidden="true" />
            באיחור
          </span>
        )}
      </div>

      {(task.transactions || task.loans) && (
        <div className={styles.linkedEntities}>
          {task.transactions && (
            <div className={styles.linkedEntity}>
              <LinkIcon size={14} aria-hidden="true" />
              <span className={styles.linkedEntityText} dir="auto">
                תנועה: {task.transactions.description}
              </span>
              {task.transactions.total_amount !== undefined && task.transactions.total_amount !== null && (
                <MoneyAmount
                  value={task.transactions.total_amount}
                  maximumFractionDigits={2}
                  className={styles.linkedAmount}
                />
              )}
            </div>
          )}
          {task.loans && (
            <div className={styles.linkedEntity}>
              <Landmark size={14} aria-hidden="true" />
              <span className={styles.linkedEntityText} dir="auto">הלוואה: {task.loans.name}</span>
            </div>
          )}
        </div>
      )}

      <div className={styles.taskCardFooter}>
        <span className={`${styles.dueDate}${overdue ? ` ${styles.dueDateOverdue}` : ''}${dueToday ? ` ${styles.dueDateToday}` : ''}`}>
          <CalendarClock size={14} aria-hidden="true" />
          {task.due_date ? (
            <>
              <span>יעד:</span>
              <TechnicalValue>{formatTaskDate(task.due_date)}</TechnicalValue>
              {overdue && <span>· באיחור</span>}
              {dueToday && <span>· היום</span>}
            </>
          ) : <span>ללא תאריך יעד</span>}
        </span>
        <button
          type="button"
          className={`${styles.statusAction}${completed ? ` ${styles.reopenAction}` : ''}`}
          disabled={pendingStatus}
          aria-busy={pendingStatus || undefined}
          onClick={onStatusToggle}
        >
          {pendingStatus
            ? <span className={styles.buttonSpinner} aria-hidden="true" />
            : completed
              ? <RotateCcw size={15} aria-hidden="true" />
              : <Check size={15} aria-hidden="true" />}
          {statusActionLabel}
        </button>
      </div>
    </article>
  );
};

export default TaskCard;
