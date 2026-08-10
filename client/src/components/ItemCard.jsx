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

const getLineTotal = (item) => {
  if (!item.price_per_unit) return 0;
  const price = Number(item.price_per_unit) || 0;
  const discount = Number(item.discount_value) || 0;
  const finalUnitPrice = item.discount_type === 'percent'
    ? price - (price * (discount / 100))
    : price - discount;
  return finalUnitPrice * (Number(item.quantity) || 0);
};

const ItemCard = ({ item, index, pricing, onItemChange, onRemove }) => {
  const itemNumber = index + 1;
  const allocatedDiscount = pricing?.allocatedGlobalDiscount === '0.00'
    ? '0.00'
    : `-${pricing?.allocatedGlobalDiscount}`;

  return (
    <article className="transaction-item" aria-labelledby={`transaction-item-${itemNumber}-title`}>
      <h3 className="transaction-item__title" id={`transaction-item-${itemNumber}-title`}>פריט {itemNumber}</h3>
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
          <MoneyAmount value={getLineTotal(item)} />
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
      {pricing && (
        <div className="transaction-item__pricing" aria-label={`פירוט מחיר לפריט ${itemNumber}`}>
          <span>אחרי הנחת פריט <MoneyAmount value={pricing.receiptPrice} /></span>
          <span>הנחה כללית שהוקצתה <MoneyAmount value={allocatedDiscount} /></span>
          <strong>שולם בפועל <MoneyAmount value={pricing.actualPaid} /></strong>
        </div>
      )}
    </article>
  );
};

export const LegoItemFields = ({ item, index, legoThemes, onItemChange, onSetNumberBlur }) => {
  const [lookupState, setLookupState] = useState('idle');
  const lookupRunningRef = useRef(false);
  const itemNumber = index + 1;

  const handleLookup = async (setNumber) => {
    if (!setNumber) {
      setLookupState('idle');
      return;
    }

    if (lookupRunningRef.current) return;
    lookupRunningRef.current = true;
    setLookupState('loading');
    try {
      const found = await onSetNumberBlur(index, setNumber);
      setLookupState(found ? 'success' : 'error');
    } finally {
      lookupRunningRef.current = false;
    }
  };

  return (
    <article className="transaction-context-item" aria-labelledby={`transaction-lego-item-${itemNumber}-title`}>
      <h3 id={`transaction-lego-item-${itemNumber}-title`}>פרטי LEGO לפריט {itemNumber}</h3>
      <div className="transaction-item__lookup-field">
        <TextField
          label="מספר סט"
          value={item.set_number}
          onValueChange={(value) => {
            setLookupState('idle');
            onItemChange(index, 'set_number', value);
          }}
          onBlur={(event) => handleLookup(event.target.value)}
          placeholder="75379-1"
          technicalLtr
          trailing={lookupState === 'loading' ? <LoaderCircle className="transaction-item__spinner" size={17} aria-hidden="true" /> : null}
        />
        <SecondaryButton
          type="button"
          className="transaction-item__lookup-button"
          loading={lookupState === 'loading'}
          loadingText="מאמת…"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => handleLookup(item.set_number)}
        >
          <Search size={15} aria-hidden="true" />
          אימות מול המקור
        </SecondaryButton>
      </div>
      <div className="transaction-item__lookup-status" aria-live="polite">
        {lookupState === 'idle' && <span>הזינו מספר סט כדי לאמת את הפרטים מול המקור.</span>}
        {lookupState === 'loading' && <span>מאמת מספר סט…</span>}
        {lookupState === 'success' && (
          <span className="transaction-item__lookup-success">
            <CircleCheck size={16} aria-hidden="true" /> הסט נמצא
          </span>
        )}
        {lookupState === 'error' && (
          <Alert variant="warning">האימות עבור <TechnicalValue>{item.set_number}</TechnicalValue> נכשל. אפשר להזין את הפרטים ידנית.</Alert>
        )}
      </div>
      <div className="transaction-item__lego-metadata">
        <TextField
          label="נושא"
          value={item.theme}
          onValueChange={(value) => onItemChange(index, 'theme', value)}
          list={`themes-${index}`}
          placeholder="Star Wars"
        />
        <datalist id={`themes-${index}`}>
          {legoThemes.map((theme) => <option key={theme} value={theme} />)}
        </datalist>
        <Select
          label="מותג"
          value={item.brand || 'LEGO'}
          onValueChange={(value) => onItemChange(index, 'brand', value)}
          technicalLtr
        >
          {BRAND_OPTIONS.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
        </Select>
        <Select
          label="אופן קבלה"
          value={item.acquisition_type || 'purchased'}
          onValueChange={(value) => onItemChange(index, 'acquisition_type', value)}
        >
          {ACQUISITION_OPTIONS.map((option) => (
            <option key={option.key} value={option.key}>{option.label}</option>
          ))}
        </Select>
      </div>
    </article>
  );
};

export default ItemCard;
