import { Eye, EyeOff, Pencil, Plus, RotateCcw } from 'lucide-react';
import {
  EmptyState,
  ErrorState,
  GhostButton,
  IconButton,
  PrimaryButton,
  SecondaryButton,
  Skeleton,
} from '../../components/ui';

export const SettingsSkeleton = ({ label = 'טוען הגדרות' }) => (
  <div className="settings-skeleton" role="status" aria-label={label}>
    <span className="settings-visually-hidden">{label}</span>
    <Skeleton height={44} borderRadius="var(--ft-radius-md)" />
    {Array.from({ length: 5 }, (_, index) => (
      <Skeleton key={index} height={62} borderRadius="var(--ft-radius-lg)" />
    ))}
  </div>
);

export const SettingsToolbar = ({
  title,
  description,
  activeCount,
  inactiveCount,
  activeLabel = 'פעילות',
  inactiveLabel = 'לא פעילות',
  showInactive,
  onToggleInactive,
  showInactiveLabel = 'הצגת לא פעילות',
  hideInactiveLabel = 'הסתרת לא פעילות',
  addLabel,
  onAdd,
}) => (
  <div className="settings-toolbar">
    <div className="settings-toolbar__copy">
      <h2>{title}</h2>
      {description && <p>{description}</p>}
    </div>
    <div className="settings-toolbar__actions">
      {inactiveCount > 0 && (
        <GhostButton
          type="button"
          size="sm"
          className={`settings-inactive-toggle${showInactive ? ' is-active' : ''}`}
          role="switch"
          aria-checked={showInactive}
          onClick={onToggleInactive}
        >
          <Eye size={15} aria-hidden="true" />
          {showInactive ? hideInactiveLabel : showInactiveLabel}
        </GhostButton>
      )}
      <span className="settings-toolbar__count" aria-label={`${activeCount} ${activeLabel}, ${inactiveCount} ${inactiveLabel}`}>
        {activeCount} {activeLabel}{inactiveCount > 0 ? ` · ${inactiveCount} ${inactiveLabel}` : ''}
      </span>
      <PrimaryButton type="button" size="md" onClick={onAdd}>
        <Plus size={16} aria-hidden="true" />
        {addLabel}
      </PrimaryButton>
    </div>
  </div>
);

export const SettingsStatusBadge = ({ active, feminine = false }) => (
  <span className={`settings-status${active ? ' is-active' : ' is-inactive'}`}>
    {active ? (feminine ? 'פעילה' : 'פעיל') : (feminine ? 'לא פעילה' : 'לא פעיל')}
  </span>
);

export const SettingsRecord = ({
  icon,
  title,
  metadata,
  badges,
  active,
  editLabel,
  onEdit,
  onDeactivate,
  onReactivate,
  reactivateLabel,
}) => (
  <article className={`settings-record${active ? '' : ' is-inactive'}`} aria-label={title}>
    <span className="settings-record__icon" aria-hidden="true">{icon}</span>
    <div className="settings-record__identity">
      <h3>{title}</h3>
      {metadata && <div className="settings-record__metadata">{metadata}</div>}
    </div>
    {badges && <div className="settings-record__badges">{badges}</div>}
    <div className="settings-record__actions">
      <IconButton type="button" size="touch" aria-label={editLabel} onClick={onEdit}>
        <Pencil size={15} aria-hidden="true" />
      </IconButton>
      {active ? (
        <IconButton
          type="button"
          size="touch"
          className="settings-record__deactivate"
          aria-label={`השבתת ${title}`}
          onClick={onDeactivate}
        >
          <EyeOff size={15} aria-hidden="true" />
        </IconButton>
      ) : (
        <SecondaryButton type="button" size="sm" onClick={onReactivate}>
          <RotateCcw size={14} aria-hidden="true" />
          {reactivateLabel || 'הפעלה מחדש'}
        </SecondaryButton>
      )}
    </div>
  </article>
);

export const SettingsLoadError = ({ title, onRetry }) => (
  <ErrorState
    title={title}
    description="אפשר לנסות לטעון את הנתונים שוב."
    retryLabel="נסו שוב"
    onRetry={onRetry}
  />
);

export const SettingsEmpty = ({ icon, title, description, actionLabel, onAction }) => (
  <EmptyState
    icon={icon}
    title={title}
    description={description}
    primaryAction={onAction ? (
      <PrimaryButton type="button" onClick={onAction}>{actionLabel}</PrimaryButton>
    ) : undefined}
  />
);

export const SettingsDialogFooter = ({ onCancel, onSave, loading, saveLabel = 'שמירה' }) => (
  <>
    <PrimaryButton type="button" loading={loading} loadingText="שומר..." onClick={onSave}>
      {saveLabel}
    </PrimaryButton>
    <SecondaryButton type="button" disabled={loading} onClick={onCancel}>ביטול</SecondaryButton>
  </>
);
