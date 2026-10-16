import ShoppingQuickEntry from './ShoppingQuickEntry';
import ShoppingUnitSelect from './ShoppingUnitSelect';
import { planningUnit, planningUnitLabel } from '../../../../shared/shoppingEntryOptions.mjs';
import ReceiptDuplicateWarning from "./ReceiptDuplicateWarning";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronRight,
  Info,
  Lock,
  Plus,
  Receipt,
  ShoppingBag,
  Trash2,
} from 'lucide-react';
import { PageHeaderContext } from '../../context/PageHeaderContext';
import {
  Alert,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  GlassCard,
  IconButton,
  MoneyAmount,
  NumberField,
  PrimaryButton,
  ProgressBar,
  SecondaryButton,
  Select,
  Skeleton,
  TechnicalValue,
  TextField,
  useToast,
} from '../../components/ui';
import {
  checkoutShoppingList,
  getShoppingReceiptDuplicates,
  getCategories,
  getPaymentSources,
  getShoppingListById,
  removeShoppingListItem,
  toggleShoppingItemPurchased,
  updateShoppingList,
  updateShoppingListItem,
} from '../../services/api';
import { SHOPPING_STATUS } from './shoppingConstants';
import ShoppingListDialog from './ShoppingListDialog';
import ShoppingIntelligence from './ShoppingIntelligence';
import ShoppingReceiptDialog from './ShoppingReceiptDialog';
import { safeShoppingLink } from './shoppingListFields';
import { formatCalendarDate } from '../../utils/calendarDate';

const calculateStats = (items = []) => {
  const purchasedItems = items.filter((item) => item.is_purchased);
  const itemTotal = (item) => item.price_basis === 'line_discount' && item.final_total != null ? Number(item.final_total) : ((Number(item.quantity) || 1) * (Number(item.price) || 0));
  return {
    total: items.length,
    purchased: purchasedItems.length,
    estimatedCost: items.reduce((sum, item) => sum + itemTotal(item), 0),
    purchasedCost: purchasedItems.reduce((sum, item) => sum + itemTotal(item), 0),
  };
};

const getItemName = (item) => item.planned_name || item.shopping_catalog_items?.name || item.custom_name || 'פריט';

const ShoppingDetailSkeleton = ({ onBack }) => (
  <div className="shopping-detail shopping-detail--loading" role="status" aria-label="טעינת רשימת קניות">
    <span className="shopping-visually-hidden">טוען את פרטי רשימת הקניות</span>
    <GlassCard className="shopping-detail-header" padding="var(--ft-space-8)" aria-hidden="true">
      <div className="shopping-detail-heading">
        <IconButton type="button" size="touch" aria-label="חזרה לרשימות" onClick={onBack}>
          <ChevronRight size={18} aria-hidden="true" />
        </IconButton>
        <Skeleton height={54} width="48%" borderRadius="var(--ft-radius-md)" />
      </div>
      <div className="shopping-detail-kpis">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} height={72} borderRadius="var(--ft-radius-lg)" />
        ))}
      </div>
    </GlassCard>
    {Array.from({ length: 3 }, (_, index) => (
      <Skeleton key={index} height={142} borderRadius="var(--ft-radius-xl)" aria-hidden="true" />
    ))}
  </div>
);

const ShoppingItem = ({ item, editable, pending, onToggle, onRemove, onEdit }) => {
  const [editing,setEditing] = useState(false);
  const [editQuantity,setEditQuantity] = useState(String(item.quantity || 1));
  const [editUnit,setEditUnit] = useState(planningUnit(item.unit));
  const [editPrice,setEditPrice] = useState(item.price ?? '');
  const [saving,setSaving] = useState(false);
  const [editError,setEditError] = useState('');
  const [editName,setEditName] = useState(getItemName(item));
  const [editNotes,setEditNotes] = useState(item.notes || '');
  const name = getItemName(item);
  const quantity = item.quantity || 1;
  const unit = planningUnitLabel(item.unit);
  const hasPrice = item.price !== null && item.price !== undefined && item.price !== '';
  const total = (Number(item.quantity) || 1) * (Number(item.price) || 0);

  return (
    <article className={`shopping-item${item.is_purchased ? ' is-purchased' : ''}${editing ? ' is-editing' : ''}`} aria-label={name}>
      <div className="shopping-item__main">
        {editable ? (
          <button
            type="button"
            className="shopping-purchase-toggle"
            aria-label={item.is_purchased ? `סימון ${name} כטרם נקנה` : `סימון ${name} כנקנה`}
            aria-pressed={Boolean(item.is_purchased)}
            disabled={pending || saving}
            onClick={() => onToggle(item)}
          >
            {item.is_purchased && <Check size={17} aria-hidden="true" />}
          </button>
        ) : (
          <span className="shopping-purchase-state" aria-label={item.is_purchased ? 'נקנה' : 'לא נקנה'}>
            {item.is_purchased ? <Check size={16} aria-hidden="true" /> : <span aria-hidden="true">—</span>}
          </span>
        )}
        <div className="shopping-item__copy">
          <strong dir="auto">{name}</strong>
          {item.notes && <p dir="auto">{item.notes}</p>}
        </div>
      </div>

      {editable && <SecondaryButton aria-label={`עריכת ${name}`} disabled={pending || saving} onClick={()=>{
        setEditName(getItemName(item)); setEditNotes(item.notes || ''); setEditQuantity(String(item.quantity || 1));
        setEditUnit(planningUnit(item.unit)); setEditPrice(item.price ?? ''); setEditing(!editing);
      }}>עריכה</SecondaryButton>}
      {editing && <form className="shopping-smart-grid" onSubmit={async e=>{e.preventDefault();if(saving)return;setSaving(true);setEditError('');try{await onEdit(item,{planned_name:editName.trim(),notes:editNotes.trim() || null,quantity:editQuantity,unit:editUnit,unit_mode:'controlled',price:editPrice===''?null:editPrice});setEditing(false);}catch{setEditError('השינוי לא נשמר. נסו שוב.');}finally{setSaving(false);}}}>
       <TextField label="שם ברשימה" value={editName} onValueChange={setEditName} required maxLength={300} dir="auto" disabled={saving}
         helperText={item.catalog_item_id ? 'השם משתנה ברשימה זו בלבד; הפריט השמור והמיפויים נשארים.' : undefined}/>
       <TextField label="הערות ודרישות" value={editNotes} onValueChange={setEditNotes} maxLength={2000} dir="auto" disabled={saving}/>
       <NumberField label={`כמות: ${name}`} required min="0.001" max="10000" step="0.001" value={editQuantity} onValueChange={setEditQuantity} disabled={saving}/>
       <ShoppingUnitSelect label={`יחידה: ${name}`} value={editUnit} onValueChange={setEditUnit} disabled={saving}/>
       <NumberField label={`מחיר: ${name}`} min="0" max="100000000" step="0.01" value={editPrice} onValueChange={setEditPrice} disabled={saving}/>
       {editError && <Alert variant="error">{editError}</Alert>}
       <PrimaryButton type="submit" disabled={saving}>שמירת פריט</PrimaryButton>
       <SecondaryButton disabled={saving} onClick={()=>setEditing(false)}>ביטול עריכת פריט</SecondaryButton>
      </form>}
      <div className="shopping-item__figures">
        <span className="shopping-item__quantity">
          <TechnicalValue>{quantity}</TechnicalValue>
          <span dir="auto"> {unit}</span>
        </span>
        <span className="shopping-item__price">
          {hasPrice ? (
            <>
              <span className="shopping-item__unit-price">
                <MoneyAmount value={item.price} minimumFractionDigits={2} maximumFractionDigits={2} /> ליחידה
              </span>
              <MoneyAmount
                className="shopping-item__total"
                value={total}
                minimumFractionDigits={2}
                maximumFractionDigits={2}
              />
            </>
          ) : (
            null
          )}
        </span>
        {editable && (
          <IconButton
            type="button"
            size="touch"
            className="shopping-item-delete"
            aria-label={`הסרת ${name} מהרשימה`}
            disabled={pending || saving}
            onClick={(event) => onRemove(item, event)}
          >
            <Trash2 size={16} aria-hidden="true" />
          </IconButton>
        )}
      </div>
    </article>
  );
};

const ShoppingItemGroup = ({ group, editable, pendingItemId, onToggle, onRemove, onEdit }) => {
  const pendingItems = group.items.filter((item) => !item.is_purchased);
  const purchasedItems = group.items.filter((item) => item.is_purchased);

  const renderItems = (items) => items.map((item) => (
    <ShoppingItem
      key={item.id}
      item={item}
      editable={editable}
      pending={pendingItemId === item.id}
      onToggle={onToggle}
      onRemove={onRemove}
      onEdit={onEdit}
    />
  ));

  return (
    <GlassCard className="shopping-item-group" padding="var(--ft-space-5)" style={{boxShadow:'none'}}>
      <section aria-labelledby={`shopping-group-${group.key}`}>
        <div className="shopping-item-group__header">
          <span className="shopping-category-icon" aria-hidden="true">{group.icon || '🛒'}</span>
          <h3 id={`shopping-group-${group.key}`}>{group.name}</h3>
          <span>{pendingItems.length} לקנייה · {purchasedItems.length} נקנו</span>
        </div>
        {pendingItems.length > 0 && (
          <div className="shopping-item-subgroup">
            <h4>לקנייה</h4>
            <div className="shopping-item-list">{renderItems(pendingItems)}</div>
          </div>
        )}
        {purchasedItems.length > 0 && (
          <div className="shopping-item-subgroup shopping-item-subgroup--purchased">
            <h4>נקנו</h4>
            <div className="shopping-item-list">{renderItems(purchasedItems)}</div>
          </div>
        )}
      </section>
    </GlassCard>
  );
};

const CheckoutDialog = ({
  duplicates, duplicateReviewed, onDuplicateReview,
  open,
  list,
  stats,
  paymentSources,
  expenseCategories,
  paymentSourceId,
  categoryId,
  pending,
  error,
  onPaymentSourceChange,
  onCategoryChange,
  onClose,
  onConfirm,
  returnFocusRef,
}) => (
  <Dialog
    open={open}
    onClose={onClose}
    title="סגירת קנייה"
    description="תיווצר תנועת הוצאה בסכום הפריטים שנקנו."
    size="md"
    className="shopping-dialog shopping-checkout-dialog"
    returnFocusRef={returnFocusRef}
    closeDisabled={pending}
    footer={(
      <>
        <SecondaryButton type="button" disabled={pending} onClick={() => onClose('cancelled')}>ביטול</SecondaryButton>
        <PrimaryButton type="button" disabled={duplicates.length > 0 && !duplicateReviewed} loading={pending} loadingText="סוגר קנייה…" onClick={onConfirm}>
          <Receipt size={16} aria-hidden="true" />
          סגירת הקנייה ויצירת תנועה
        </PrimaryButton>
      </>
    )}
  >
    <div className="shopping-checkout-content">
      <ReceiptDuplicateWarning candidates={duplicates} checked={duplicateReviewed} onChange={onDuplicateReview} />
      {error && (
        <Alert variant="error" urgent title="סגירת הקנייה לא הושלמה">
          הרשימה לא הוצגה כקנייה סגורה. סימוני הפריטים נשמרו. אם קבלה עדיין נסרקת, המתינו לסיום; בדקו גם את אזהרת הכפילויות לפני ניסיון נוסף.
        </Alert>
      )}

      <div className="shopping-checkout-total">
        <div>
          <strong>סך הפריטים שנקנו</strong>
          <span>{stats.purchased} פריטים מתוך {stats.total}</span>
        </div>
        <MoneyAmount value={stats.purchasedCost} minimumFractionDigits={2} maximumFractionDigits={2} />
      </div>

      <Select
        id="shopping-checkout-category"
        label="קטגוריה פיננסית לתנועה"
        helperText="זו קטגוריה של תנועות כספיות — שונה מקטגוריות הקטלוג שמארגנות את פריטי הרשימה."
        value={categoryId}
        onValueChange={onCategoryChange}
        disabled={pending}
      >
        <option value="">ללא שיוך לקטגוריה פיננסית</option>
        {expenseCategories.map((category) => (
          <option key={category.id} value={category.id}>{category.icon} {category.name}</option>
        ))}
      </Select>

      <Select
        id="shopping-checkout-source"
        label="אמצעי תשלום"
        value={paymentSourceId}
        onValueChange={onPaymentSourceChange}
        disabled={pending}
      >
        <option value="">ללא שיוך לאמצעי תשלום</option>
        {paymentSources.map((source) => (
          <option key={source.id} value={source.id}>
            {source.name}{source.last4 ? ` (${source.last4})` : ''}
          </option>
        ))}
      </Select>

      <div className="shopping-readonly-note">
        <Lock size={16} aria-hidden="true" />
        אחרי הסגירה הרשימה עוברת למצב קריאה בלבד ולא ניתן לערוך את הפריטים שבה.
      </div>
      <span className="shopping-visually-hidden">הרשימה הנסגרת: {list?.title}</span>
    </div>
  </Dialog>
);

const ShoppingListDetail = ({ listId, listTypeName = '', onBack }) => {
  const { setPageHeader } = useContext(PageHeaderContext);
  const toast = useToast();
  const checkoutReturnFocusRef = useRef(null);
  const itemDeleteReturnFocusRef = useRef(null);
  const activateReturnFocusRef = useRef(null);
  const [list, setList] = useState(null);
  const [showEditList, setShowEditList] = useState(false);
  const editListReturnFocusRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const itemNameRef = useRef(null);
  const [pendingItemId, setPendingItemId] = useState(null);
  const [itemDeleteTarget, setItemDeleteTarget] = useState(null);
  const [showActivateConfirm, setShowActivateConfirm] = useState(false);
  const [activating, setActivating] = useState(false);
  const [checkoutDuplicates, setCheckoutDuplicates] = useState([]), [checkoutDuplicateReviewed, setCheckoutDuplicateReviewed] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [checkoutError, setCheckoutError] = useState(false);
  const [paymentSources, setPaymentSources] = useState([]);
  const [expenseCategories, setExpenseCategories] = useState([]);
  const [checkoutPaymentSourceId, setCheckoutPaymentSourceId] = useState('');
  const [checkoutCategoryId, setCheckoutCategoryId] = useState('');
  const [mutationError, setMutationError] = useState('');

  const fetchList = useCallback(async ({ showLoading = true } = {}) => {
    if (showLoading) setLoading(true);
    setLoadError(false);
    try {
      const response = await getShoppingListById(listId);
      const nextList = response.data || null;
      setList(nextList);
      return nextList;
    } catch {
      if (showLoading) setLoadError(true);
      return false;
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [listId]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const isEditable = list?.status === 'draft' || list?.status === 'active';

  const saveListDetails = async (payload) => {
    const response = await updateShoppingList(listId, payload);
    setList((current) => ({ ...current, ...response.data, shopping_list_items: current.shopping_list_items }));
    setShowEditList(false);
  };

  const openAddForm = useCallback(() => { itemNameRef.current?.focus(); }, []);

  useEffect(() => {
    setPageHeader({
      title: 'רשימות קניות',
      subtitle: list ? `פירוט הרשימה: ${list.title}` : 'פירוט רשימת קניות',
      primaryAction: list && isEditable ? {
        label: 'הוספת פריט',
        icon: Plus,
        onClick: openAddForm,
      } : undefined,
    });
  }, [isEditable, list, openAddForm, setPageHeader]);

  const items = useMemo(() => list?.shopping_list_items || [], [list]);
  const stats = useMemo(() => calculateStats(items), [items]);
  const confirmedPurchase = Array.isArray(list?.shopping_confirmed_purchases) ? list.shopping_confirmed_purchases[0] : list?.shopping_confirmed_purchases;
  const checkoutStats = confirmedPurchase ? calculateStats(confirmedPurchase.items.map(i=>({...i,is_purchased:true}))) : stats;
  const completionPercentage = stats.total > 0 ? Math.round((stats.purchased / stats.total) * 100) : 0;

  const groupedItems = useMemo(() => {
    const groups = new Map();
    items.forEach((item) => {
      const name = item.shopping_catalog_categories?.name || 'כללי';
      if (!groups.has(name)) {
        groups.set(name, {
          key: String(item.category_id || name).replace(/\s+/g, '-'),
          name,
          icon: item.shopping_catalog_categories?.icon || '',
          items: [],
        });
      }
      groups.get(name).items.push(item);
    });
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'he'));
  }, [items]);

  const handleToggle = async (item) => {
    if (pendingItemId !== null) return;
    setPendingItemId(item.id);
    setMutationError('');
    try {
      await toggleShoppingItemPurchased(listId, item.id);
      await fetchList({ showLoading: false });
    } catch {
      setMutationError(`עדכון מצב הפריט „${getItemName(item)}” נכשל. הפריט נשאר ללא שינוי.`);
    } finally {
      setPendingItemId(null);
    }
  };

  const requestRemoveItem = (item, event) => {
    itemDeleteReturnFocusRef.current = event.currentTarget;
    setItemDeleteTarget(item);
  };

  const confirmRemoveItem = async () => {
    await removeShoppingListItem(listId, itemDeleteTarget.id);
    await fetchList({ showLoading: false });
  };

  const requestActivation = (event) => {
    activateReturnFocusRef.current = event.currentTarget;
    setShowActivateConfirm(true);
  };

  const confirmActivation = async () => {
    if (activating) return false;
    setActivating(true);
    setMutationError('');
    try {
      await updateShoppingList(listId, { status: 'active' });
      await fetchList({ showLoading: false });
      return true;
    } catch {
      throw new Error('activation failed');
    } finally {
      setActivating(false);
    }
  };

  const openCheckout = async (event) => {
    if (checkoutLoading) return;
    checkoutReturnFocusRef.current = event.currentTarget;
    setCheckoutLoading(true);
    setMutationError('');
    setCheckoutError(false);
    try {
      const [sourcesResponse, categoriesResponse, duplicatesResponse] = await Promise.all([
        getPaymentSources(),
        getCategories(),
        getShoppingReceiptDuplicates(listId),
      ]);
      const sources = Array.isArray(sourcesResponse.data) ? sourcesResponse.data : [];
      setPaymentSources(sources);
      setExpenseCategories(Array.isArray(categoriesResponse.data) ? categoriesResponse.data : []);
      setCheckoutPaymentSourceId(sources[0]?.id ? String(sources[0].id) : '');
      setCheckoutDuplicates(duplicatesResponse.data);
      setCheckoutDuplicateReviewed(false);
      setShowCheckout(true);
    } catch {
      setMutationError('טעינת נתוני הסגירה נכשלה. הרשימה נשארה פעילה.');
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleCheckout = async () => {
    if (checkoutPending || (checkoutDuplicates.length && !checkoutDuplicateReviewed)) return;
    setCheckoutPending(true);
    setCheckoutError(false);
    try {
      await checkoutShoppingList(listId, {
        payment_source_id: checkoutPaymentSourceId || null,
        category_id: checkoutCategoryId || null,
        ...(checkoutDuplicates.length ? {duplicate_reviewed_ids: checkoutDuplicates.map(c=>c.receipt_id)} : {}),
      });
      const refreshedList = await fetchList({ showLoading: false });
      if (refreshedList?.status !== 'checked_out') {
        setCheckoutError(true);
        return;
      }
      setShowCheckout(false);
      toast.success({
        title: 'הקנייה נסגרה',
        message: 'הרשימה נסגרה ותנועת ההוצאה נוצרה בהצלחה.',
      });
    } catch (error) {
      if (error.response?.data?.error === 'receipt_duplicate_review_required') {
        setCheckoutDuplicateReviewed(false);
        try {setCheckoutDuplicates((await getShoppingReceiptDuplicates(listId)).data);} catch {setShowCheckout(false);setMutationError('בדיקת הכפילויות נכשלה. פתחו שוב את סגירת הקנייה כדי לבדוק.');}
      }
      setCheckoutError(true);
    } finally {
      setCheckoutPending(false);
    }
  };

  if (loading) return <ShoppingDetailSkeleton onBack={onBack} />;

  if (loadError) {
    return (
      <div className="shopping-detail shopping-page" dir="rtl">
        <SecondaryButton type="button" className="shopping-back-button" onClick={onBack}>
          <ChevronRight size={17} aria-hidden="true" />
          חזרה לרשימות
        </SecondaryButton>
        <ErrorState
          level="page"
          title="טעינת פריטי הרשימה נכשלה"
          description="לא ניתן להציג את הרשימה כרגע."
          retryLabel="נסה שוב"
          onRetry={fetchList}
        />
      </div>
    );
  }

  if (!list) {
    return (
      <div className="shopping-detail shopping-page" dir="rtl">
        <ErrorState
          level="page"
          title="הרשימה לא נמצאה"
          description="ייתכן שהיא נמחקה או שאינה זמינה עוד."
          secondaryAction={<SecondaryButton type="button" onClick={onBack}>חזרה לרשימות</SecondaryButton>}
        />
      </div>
    );
  }

  const status = SHOPPING_STATUS[list.status] || SHOPPING_STATUS.draft;
  const readOnly = list.status === 'checked_out' || list.status === 'archived';
  const savedLink = safeShoppingLink(list.link);

  return (
    <div className="shopping-page shopping-detail" dir="rtl">
      <GlassCard className="shopping-detail-header" padding="var(--ft-space-8)">
        <div className="shopping-detail-heading">
          <IconButton type="button" size="touch" aria-label="חזרה לרשימות הקניות" onClick={onBack}>
            <ChevronRight size={18} aria-hidden="true" />
          </IconButton>
          <div className="shopping-detail-heading__copy">
            <h2>{list.title}</h2>
            <div className="shopping-list-card__badges">
              {(list.shopping_list_types?.name || listTypeName) && (
                <span className="shopping-badge shopping-badge--type">{list.shopping_list_types?.name || listTypeName}</span>
              )}
              <span className={`shopping-badge shopping-status ${status.className}`}>{status.label}</span>
            </div>
          </div>
          <ShoppingReceiptDialog key={list.id} list={list} compact onChanged={() => fetchList({ showLoading: false })} />
          {isEditable && (
            <div className="shopping-detail-primary-action">
              <div className="shopping-mobile-action-total">
                <span>{list.status === 'active' ? 'סך שנקנה' : 'עלות משוערת'}</span>
                <MoneyAmount
                  value={confirmedPurchase ? checkoutStats.purchasedCost : list.status === 'active' ? stats.purchasedCost : stats.estimatedCost}
                  minimumFractionDigits={2}
                  maximumFractionDigits={2}
                />
              </div>
              {list.status === 'draft' && (
                <PrimaryButton type="button" loading={activating} onClick={requestActivation}>
                  <ShoppingBag size={16} aria-hidden="true" />
                  הפעלת הרשימה
                </PrimaryButton>
              )}
              {list.status === 'active' && (
                <PrimaryButton type="button" loading={checkoutLoading} loadingText="טוען נתוני סגירה…" onClick={openCheckout}>
                  <Receipt size={16} aria-hidden="true" />
                  סגירת קנייה
                </PrimaryButton>
              )}
            </div>
          )}
        </div>

        {(list.store || savedLink || list.target_date) && (
          <dl className="shopping-list-metadata" aria-label="פרטים נוספים לרשימה">
            {list.store && <div><dt>חנות</dt><dd>{list.store}</dd></div>}
            {savedLink && <div><dt>קישור</dt><dd><a href={savedLink} target="_blank" rel="noopener noreferrer" dir="ltr">{savedLink}</a></dd></div>}
            {list.target_date && <div><dt>תאריך יעד</dt><dd><TechnicalValue><time dateTime={list.target_date}>{formatCalendarDate(list.target_date)}</time></TechnicalValue></dd></div>}
          </dl>
        )}
        {isEditable && <SecondaryButton type="button" ref={editListReturnFocusRef} className="shopping-edit-details" onClick={() => setShowEditList(true)}>
          עריכת פרטי הרשימה
        </SecondaryButton>}

        <details className="shopping-cost-summary"><summary>סיכום הרשימה ועלויות משוערות</summary>
        <div className="shopping-detail-kpis" aria-label="סיכום הרשימה">
          <div className="shopping-detail-kpi"><span>פריטים</span><strong><TechnicalValue>{stats.total}</TechnicalValue></strong></div>
          <div className="shopping-detail-kpi"><span>נקנו</span><strong><TechnicalValue>{stats.purchased}</TechnicalValue></strong></div>
          <div className="shopping-detail-kpi"><span>עלות משוערת</span><MoneyAmount value={stats.estimatedCost} minimumFractionDigits={2} maximumFractionDigits={2} /></div>
          <div className="shopping-detail-kpi is-positive"><span>עלות מה שנקנה</span><MoneyAmount value={stats.purchasedCost} minimumFractionDigits={2} maximumFractionDigits={2} /></div>
        </div>

        </details>
        <div className="shopping-detail-progress">
          <div className="shopping-progress-label">
            <span>התקדמות הקנייה</span>
            <TechnicalValue>{completionPercentage}%</TechnicalValue>
          </div>
          <ProgressBar
            value={completionPercentage}
            tone={completionPercentage === 100 ? 'pos' : 'primary'}
            height={8}
            aria-label="התקדמות הקנייה"
          />
        </div>

        {readOnly && (
          <div className="shopping-readonly-note" role="status">
            <Lock size={16} aria-hidden="true" />
            הרשימה נסגרה בקופה ונשמרת לקריאה בלבד. שינוי פריטים או פתיחה מחדש אינם אפשריים.
          </div>
        )}
      </GlassCard>

      {confirmedPurchase && <Alert>הסכום לסגירת הקנייה מבוסס על פריטי הקבלה שאושרו, בנפרד מסימוני הרשימה. לאחר סגירה, אישור קבלה אינו משנה הוצאה קיימת.</Alert>}


      {mutationError && (
        <Alert variant="error" urgent onDismiss={() => setMutationError('')}>
          {mutationError}
        </Alert>
      )}

      {isEditable && <ShoppingQuickEntry key={list.id} list={list} inputRef={itemNameRef} onAdded={() => fetchList({ showLoading: false })} />}

      {items.length === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          title="הרשימה עדיין ריקה"
          description={isEditable
            ? 'כתבו מה צריך לקנות — אין צורך במחיר, חנות או קבלה.'
            : 'אין פריטים ברשימה הזו.'}
          primaryAction={isEditable ? (
            <PrimaryButton type="button" onClick={openAddForm}>
              <Plus size={16} aria-hidden="true" />
              הוספת פריט
            </PrimaryButton>
          ) : undefined}
        />
      ) : (
        <div className="shopping-groups" aria-label="פריטי רשימת הקניות">
          {groupedItems.map((group) => (
            <ShoppingItemGroup
              key={group.key}
              group={group}
              editable={isEditable}
              pendingItemId={pendingItemId}
              onToggle={handleToggle}
              onRemove={requestRemoveItem}
              onEdit={async (item,values)=>{await updateShoppingListItem(listId,item.id,values);await fetchList({showLoading:false});}}
            />
          ))}
        </div>
      )}

      <ShoppingIntelligence key={`habits-${list.id}`} list={list} onChanged={() => fetchList({ showLoading: false })} />

      {showEditList && <ShoppingListDialog open initialList={list} onClose={() => setShowEditList(false)}
        onSave={saveListDetails} returnFocusRef={editListReturnFocusRef} />}

      <ConfirmDialog
        open={Boolean(itemDeleteTarget)}
        title="הסרת פריט מהרשימה"
        message={itemDeleteTarget
          ? `הפריט „${getItemName(itemDeleteTarget)}” יוסר מהרשימה הזו. פריט קטלוג יישאר זמין לרשימות אחרות.`
          : ''}
        confirmLabel="הסרת הפריט"
        cancelLabel="ביטול"
        variant="destructive"
        errorMessage="הסרת הפריט נכשלה. הפריט נשאר ברשימה."
        returnFocusRef={itemDeleteReturnFocusRef}
        onClose={() => setItemDeleteTarget(null)}
        onConfirm={confirmRemoveItem}
      />

      <ConfirmDialog
        open={showActivateConfirm}
        title="הפעלת הרשימה"
        message="אחרי ההפעלה אפשר לסמן פריטים כנקנו ולסגור את הקנייה. הוספת פריטים תישאר זמינה."
        confirmLabel="הפעלת הרשימה"
        cancelLabel="ביטול"
        loading={activating}
        errorMessage="הפעלת הרשימה נכשלה. הרשימה נשארה טיוטה."
        returnFocusRef={activateReturnFocusRef}
        onClose={() => setShowActivateConfirm(false)}
        onConfirm={confirmActivation}
      />

      <CheckoutDialog
        duplicates={checkoutDuplicates}
        duplicateReviewed={checkoutDuplicateReviewed}
        onDuplicateReview={setCheckoutDuplicateReviewed}
        open={showCheckout}
        list={list}
        stats={checkoutStats}
        paymentSources={paymentSources}
        expenseCategories={expenseCategories}
        paymentSourceId={checkoutPaymentSourceId}
        categoryId={checkoutCategoryId}
        pending={checkoutPending}
        error={checkoutError}
        onPaymentSourceChange={setCheckoutPaymentSourceId}
        onCategoryChange={setCheckoutCategoryId}
        onClose={() => !checkoutPending && setShowCheckout(false)}
        onConfirm={handleCheckout}
        returnFocusRef={checkoutReturnFocusRef}
      />

      <div className="shopping-product-note">
        <Info size={16} aria-hidden="true" />
        פירוט הרשימה נשאר בתוך עמוד הקניות, ללא נתיב נפרד.
      </div>
    </div>
  );
};

export default ShoppingListDetail;
