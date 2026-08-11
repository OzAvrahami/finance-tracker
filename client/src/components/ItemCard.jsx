import { useRef, useState } from 'react';
import { CircleCheck, LoaderCircle, Search, Trash2 } from 'lucide-react';
import {
  Alert,
  IconButton,
  MoneyAmount,
  NumberField,
  SecondaryButton,
  Select,
  TechnicalValue,
  TextField,
} from './ui';
import { ACQUISITION_OPTIONS, BRAND_OPTIONS } from '../utils/legoHelpers';

const GLOBAL_DISCOUNT_LABELS = {
  loyalty_points: 'נקודות',
  coupon: 'קופון',
  store_credit: 'זיכוי',
  other: 'הנחה נוספת',
};

const LegoItemFields = ({ item, index, legoThemes, onItemChange, onSetNumberBlur }) => {
  const [lookupState, setLookupState] = useState('idle');
  const [lookupResult, setLookupResult] = useState(null);
  const [showManualFields, setShowManualFields] = useState(false);
  const lookupRunningRef = useRef(false);
  const lastSuccessfulLookupRef = useRef('');
  const itemNumber = index + 1;
  const themeListId = `themes-${item._uiKey}`;
  const existingMetadata = item.set_number && (item.item_name || item.theme)
    ? { name: item.item_name, theme: item.theme, brand: item.brand }
    : null;
  const displayedMetadata = lookupResult || existingMetadata;

  const handleLookup = async (setNumber) => {
    if (!setNumber) {
      setLookupState('idle');
      setLookupResult(null);
      lastSuccessfulLookupRef.current = '';
      return;
    }

    if (lastSuccessfulLookupRef.current === setNumber) return;
    if (lookupRunningRef.current) return;
    lookupRunningRef.current = true;
    setLookupState('loading');
    try {
      const found = await onSetNumberBlur(item._uiKey, setNumber);
      setLookupResult(found || null);
      setLookupState(found ? 'success' : 'error');
      if (found) lastSuccessfulLookupRef.current = setNumber;
      if (!found) setShowManualFields(true);
    } finally {
      lookupRunningRef.current = false;
    }
  };

  return (
    <section className="transaction-item__lego" aria-label={`LEGO בפריט ${itemNumber}`}>
      <div className="transaction-item__lego-heading">
        <h4>LEGO</h4>
        <span>פרטי הסט ואופן הקבלה</span>
      </div>

      <div className="transaction-item__lego-controls">
        <div className="transaction-item__lookup">
          <div className="transaction-item__lookup-field">
            <TextField
              label="מספר סט"
              value={item.set_number}
              onValueChange={(value) => {
                setLookupState('idle');
                setLookupResult(null);
                lastSuccessfulLookupRef.current = '';
                onItemChange(index, 'set_number', value);
              }}
              onBlur={(event) => handleLookup(event.target.value)}
              placeholder="75379-1"
              technicalLtr
              size="compact"
              trailing={lookupState === 'loading' ? <LoaderCircle className="transaction-item__spinner" size={17} aria-hidden="true" /> : null}
            />
            <SecondaryButton
              type="button"
              size="sm"
              className="transaction-item__lookup-button"
              loading={lookupState === 'loading'}
              loadingText="מחפש…"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => handleLookup(item.set_number)}
            >
              <Search size={15} aria-hidden="true" />
              חיפוש סט
            </SecondaryButton>
          </div>

          <div className="transaction-item__lookup-status" aria-live="polite">
            {lookupState === 'idle' && !displayedMetadata && <span>אפשר לחפש לפי מספר הסט או להזין פרטים ידנית.</span>}
            {lookupState === 'loading' && <span>מחפש פרטי סט…</span>}
            {(lookupState === 'success' || (lookupState === 'idle' && displayedMetadata)) && displayedMetadata && (
              <div className="transaction-item__lookup-success">
                <CircleCheck size={16} aria-hidden="true" />
                <span>
                  <strong>{lookupState === 'success' ? 'הסט נמצא: ' : ''}{displayedMetadata.name || item.set_number}</strong>
                  <small>
                    <TechnicalValue>{displayedMetadata.brand || 'LEGO'}</TechnicalValue>
                    {displayedMetadata.theme ? <> · {displayedMetadata.theme}</> : null}
                  </small>
                </span>
              </div>
            )}
            {lookupState === 'error' && (
              <Alert variant="warning">החיפוש עבור <TechnicalValue>{item.set_number}</TechnicalValue> נכשל. אפשר להשלים את הפרטים ידנית.</Alert>
            )}
          </div>
        </div>

        <Select
          className="transaction-item__acquisition"
          label="אופן קבלה"
          value={item.acquisition_type || 'purchase'}
          onValueChange={(value) => onItemChange(index, 'acquisition_type', value)}
          size="compact"
        >
          {ACQUISITION_OPTIONS.map((option) => (
            <option key={option.key} value={option.key}>{option.label}</option>
          ))}
        </Select>
      </div>

      <button
        type="button"
        className="transaction-item__manual-toggle"
        aria-expanded={showManualFields}
        onClick={() => setShowManualFields((visible) => !visible)}
      >
        {showManualFields ? 'הסתרת פרטים ידניים' : 'עריכת נושא ומותג ידנית'}
      </button>

      {showManualFields && (
        <div className="transaction-item__lego-metadata">
          <TextField
            label="נושא"
            value={item.theme}
            onValueChange={(value) => onItemChange(index, 'theme', value)}
            list={themeListId}
            placeholder="Star Wars"
            size="compact"
          />
          <datalist id={themeListId}>
            {legoThemes.map((theme) => <option key={theme} value={theme} />)}
          </datalist>
          <Select
            label="מותג"
            value={item.brand || 'LEGO'}
            onValueChange={(value) => onItemChange(index, 'brand', value)}
            technicalLtr
            size="compact"
          >
            {BRAND_OPTIONS.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
          </Select>
        </div>
      )}
    </section>
  );
};

const ItemCard = ({
  item,
  index,
  pricing,
  globalDiscountSource,
  isLego,
  legoThemes,
  onItemChange,
  onRemove,
  onSetNumberBlur,
}) => {
  const itemNumber = index + 1;
  const hasItemDiscount = Number(item.discount_value) > 0;
  const hasAllocatedDiscount = Number(pricing?.allocatedGlobalDiscount) > 0;
  const showPricing = pricing && (hasItemDiscount || hasAllocatedDiscount);
  const allocatedDiscount = hasAllocatedDiscount ? `-${pricing.allocatedGlobalDiscount}` : '0.00';
  const globalDiscountLabel = GLOBAL_DISCOUNT_LABELS[globalDiscountSource] || 'הנחת הזמנה';

  return (
    <article className="transaction-item" aria-labelledby={`transaction-item-${item._uiKey}-title`}>
      <h3 className="transaction-item__title" id={`transaction-item-${item._uiKey}-title`}>פריט {itemNumber}</h3>
      <div className="transaction-item__grid">
        <TextField
          className="transaction-item__field transaction-item__name"
          label="שם הפריט"
          value={item.item_name}
          onValueChange={(value) => onItemChange(index, 'item_name', value)}
          placeholder="שם הפריט"
          required
          size="compact"
        />
        <NumberField
          className="transaction-item__field transaction-item__quantity"
          label="כמות"
          value={item.quantity}
          onValueChange={(value) => onItemChange(index, 'quantity', value)}
          min="1"
          size="compact"
        />
        <NumberField
          className="transaction-item__field transaction-item__price"
          label="מחיר ליחידה"
          value={item.price_per_unit}
          onValueChange={(value) => onItemChange(index, 'price_per_unit', value)}
          min="0"
          step="0.01"
          size="compact"
        />
        <div className="transaction-item__discount">
          <NumberField
            className="transaction-item__field"
            label="ערך ההנחה"
            value={item.discount_value}
            onValueChange={(value) => onItemChange(index, 'discount_value', value)}
            size="compact"
          />
          <div className="transaction-item__discount-kind" role="group" aria-label={`סוג הנחה לפריט ${itemNumber}`}>
            <button
              type="button"
              className={item.discount_type === 'amount' ? 'is-active' : ''}
              aria-pressed={item.discount_type === 'amount'}
              aria-label="סכום קבוע"
              onClick={() => onItemChange(index, 'discount_type', 'amount')}
            >
              ₪
            </button>
            <button
              type="button"
              className={item.discount_type === 'percent' ? 'is-active' : ''}
              aria-pressed={item.discount_type === 'percent'}
              aria-label="אחוזים"
              onClick={() => onItemChange(index, 'discount_type', 'percent')}
            >
              %
            </button>
          </div>
        </div>
        <div className="transaction-item__total">
          <span className="transaction-item__total-label">ערך סופי</span>
          <MoneyAmount value={pricing?.receiptPrice || 0} />
        </div>
        <IconButton
          type="button"
          size="touch"
          className="transaction-item__remove"
          aria-label={`הסרת פריט ${itemNumber}`}
          onClick={() => onRemove(index)}
        >
          <Trash2 size={18} aria-hidden="true" />
        </IconButton>
      </div>

      {isLego && (
        <LegoItemFields
          item={item}
          index={index}
          legoThemes={legoThemes}
          onItemChange={onItemChange}
          onSetNumberBlur={onSetNumberBlur}
        />
      )}

      {showPricing && (
        <div className="transaction-item__pricing" aria-label={`פירוט מחיר לפריט ${itemNumber}`}>
          {(hasItemDiscount || hasAllocatedDiscount) && (
            <span>מחיר לאחר הנחת פריט <MoneyAmount value={pricing.receiptPrice} /></span>
          )}
          {hasAllocatedDiscount && (
            <span>{globalDiscountLabel} <MoneyAmount value={allocatedDiscount} /></span>
          )}
          <strong>שולם בפועל <MoneyAmount value={pricing.actualPaid} /></strong>
        </div>
      )}
    </article>
  );
};

export default ItemCard;
