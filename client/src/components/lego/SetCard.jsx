import { useMemo, useState } from 'react';
import { ImageOff, Pencil, Trash2 } from 'lucide-react';
import { IconButton, MoneyAmount, TechnicalValue } from '../ui';
import { BRAND_OPTIONS, STATUS_OPTIONS } from '../../utils/legoHelpers';

const ACQUISITION_LABELS = {
  purchased: 'נרכש',
  gift: 'מתנה',
  trade: 'החלפה',
  other: 'אחר',
};

const STATUS_META = {
  New: { label: 'חדש בקופסה', className: 'is-new' },
  'In Progress': { label: 'בבנייה', className: 'is-progress' },
  Built: { label: 'בנוי', className: 'is-built' },
};

const MoneyOrDash = ({ value, className = '' }) => (
  value !== null && value !== undefined && value !== '' ? (
    <MoneyAmount
      className={className}
      value={value}
      minimumFractionDigits={2}
      maximumFractionDigits={2}
    />
  ) : <span className={`lego-money-empty ${className}`.trim()}>—</span>
);

const SetCard = ({ set, pending = false, onStatusChange, onBrandChange, onEdit, onDelete }) => {
  const rawSetNumber = String(set.set_number || '').trim();
  const imageUrl = useMemo(() => {
    if (set.image_url) return set.image_url;
    const normalized = /-\d+$/.test(rawSetNumber) ? rawSetNumber : `${rawSetNumber}-1`;
    return `https://images.brickset.com/sets/images/${normalized}.jpg`;
  }, [rawSetNumber, set.image_url]);
  const [failedImageUrl, setFailedImageUrl] = useState('');
  const imageFailed = failedImageUrl === imageUrl;

  const status = STATUS_META[set.status] || { label: set.status || 'ללא סטטוס', className: 'is-neutral' };
  const acquisition = ACQUISITION_LABELS[set.acquisition_type] || ACQUISITION_LABELS.other;
  const titleId = `lego-set-${set.id}`;

  return (
    <article className="lego-set-card ui-glass" aria-labelledby={titleId}>
      <div className="lego-set-card__media">
        {!imageFailed ? (
          <img
            src={imageUrl}
            alt={`תמונת ${set.name || `סט ${rawSetNumber}`}`}
            loading="lazy"
            onError={() => setFailedImageUrl(imageUrl)}
          />
        ) : (
          <div className="lego-set-card__fallback" role="img" aria-label={`אין תמונה זמינה עבור ${set.name || rawSetNumber}`}>
            <ImageOff size={27} aria-hidden="true" />
            <span>התמונה אינה זמינה</span>
          </div>
        )}
        <span className={`lego-status-badge ${status.className}`}>{status.label}</span>
      </div>

      <div className="lego-set-card__body">
        <header>
          <h2 id={titleId} dir="auto" title={set.name}>{set.name}</h2>
          <div className="lego-set-card__identity">
            <TechnicalValue>#{rawSetNumber}</TechnicalValue>
            {set.theme && <><span aria-hidden="true">·</span><span dir="auto">{set.theme}</span></>}
          </div>
        </header>

        <div className="lego-set-card__chips" aria-label="פרטי סט">
          <TechnicalValue className="lego-meta-chip">{set.brand || 'LEGO'}</TechnicalValue>
          {set.pieces !== null && set.pieces !== undefined && set.pieces !== '' && (
            <span className="lego-meta-chip"><TechnicalValue>{set.pieces}</TechnicalValue> חלקים</span>
          )}
          <span className="lego-meta-chip">{acquisition}</span>
        </div>

        <dl className="lego-set-card__finance">
          <div>
            <dt>שולם</dt>
            <dd><MoneyOrDash value={set.purchase_price} className="is-paid" /></dd>
          </div>
          <div>
            <dt>מחיר בקבלה</dt>
            <dd><MoneyOrDash value={set.receipt_price} /></dd>
          </div>
          <div>
            <dt>לפני הנחת פריט</dt>
            <dd><MoneyOrDash value={set.original_price} /></dd>
          </div>
          <div>
            <dt>שווי מוצג</dt>
            <dd><MoneyOrDash value={set.market_value} className="is-value" /></dd>
          </div>
        </dl>

        <footer className="lego-set-card__footer">
          <span className="lego-acquisition-date">
            {set.purchase_date ? <TechnicalValue>{set.purchase_date}</TechnicalValue> : 'תאריך לא צוין'}
          </span>
          <div className="lego-set-card__quick-actions">
            <label className="lego-visually-hidden" htmlFor={`lego-status-${set.id}`}>עדכון סטטוס עבור {set.name}</label>
            <select
              id={`lego-status-${set.id}`}
              className="lego-quick-select"
              aria-label={`עדכון סטטוס עבור ${set.name}`}
              value={set.status}
              disabled={pending}
              onChange={(event) => onStatusChange(set.id, event.target.value)}
            >
              {STATUS_OPTIONS.filter((option) => option.key !== 'All').map((option) => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))}
            </select>

            <label className="lego-visually-hidden" htmlFor={`lego-brand-${set.id}`}>עדכון מותג עבור {set.name}</label>
            <select
              id={`lego-brand-${set.id}`}
              className="lego-quick-select lego-quick-select--brand"
              aria-label={`עדכון מותג עבור ${set.name}`}
              value={set.brand || 'LEGO'}
              disabled={pending}
              onChange={(event) => onBrandChange(set.id, event.target.value)}
            >
              {BRAND_OPTIONS.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
            </select>

            <IconButton type="button" size="touch" aria-label={`עריכת ${set.name}`} disabled={pending} onClick={(event) => onEdit(set, event)}>
              <Pencil size={15} aria-hidden="true" />
            </IconButton>
            <IconButton type="button" size="touch" className="lego-delete-action" aria-label={`מחיקת ${set.name}`} disabled={pending} onClick={(event) => onDelete(set, event)}>
              <Trash2 size={15} aria-hidden="true" />
            </IconButton>
          </div>
        </footer>
      </div>
    </article>
  );
};

export default SetCard;
