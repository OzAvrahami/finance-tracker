import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronRight,
  Info,
  Lock,
  Package,
  Plus,
  Receipt,
  ShoppingBag,
  Trash2,
  X,
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
  SegmentedControl,
  Select,
  Skeleton,
  TechnicalValue,
  TextField,
  useToast,
} from '../../components/ui';
import {
  addShoppingListItem,
  checkoutShoppingList,
  createShoppingCatalogCategory,
  getCategories,
  getPaymentSources,
  getShoppingCatalogCategories,
  getShoppingCatalogItems,
  getShoppingListById,
  removeShoppingListItem,
  toggleShoppingItemPurchased,
  updateShoppingList,
} from '../../services/api';
import { SHOPPING_STATUS } from './shoppingConstants';

const ITEM_MODES = [
  { value: 'catalog', label: 'פריט מהקטלוג', icon: Package },
  { value: 'custom', label: 'פריט חופשי', icon: Plus },
];

const initialItemForm = {
  categoryId: '',
  catalogItemId: '',
  customName: '',
  quantity: 1,
  unit: '',
  price: '',
  notes: '',
};

const calculateStats = (items = []) => {
  const purchasedItems = items.filter((item) => item.is_purchased);
  const itemTotal = (item) => ((Number(item.quantity) || 1) * (Number(item.price) || 0));
  return {
    total: items.length,
    purchased: purchasedItems.length,
    estimatedCost: items.reduce((sum, item) => sum + itemTotal(item), 0),
    purchasedCost: purchasedItems.reduce((sum, item) => sum + itemTotal(item), 0),
  };
};

const getItemName = (item) => item.shopping_catalog_items?.name || item.custom_name || 'פריט';

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

const ShoppingItem = ({ item, editable, pending, onToggle, onRemove }) => {
  const name = getItemName(item);
  const quantity = item.quantity || 1;
  const unit = item.unit || 'יח׳';
  const hasPrice = item.price !== null && item.price !== undefined && item.price !== '';
  const total = (Number(item.quantity) || 1) * (Number(item.price) || 0);

  return (
    <article className={`shopping-item${item.is_purchased ? ' is-purchased' : ''}`} aria-label={name}>
      <div className="shopping-item__main">
        {editable ? (
          <button
            type="button"
            className="shopping-purchase-toggle"
            aria-label={item.is_purchased ? `סימון ${name} כטרם נקנה` : `סימון ${name} כנקנה`}
            aria-pressed={Boolean(item.is_purchased)}
            disabled={pending}
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
            <span className="shopping-item__no-price">ללא מחיר</span>
          )}
        </span>
        {editable && (
          <IconButton
            type="button"
            size="touch"
            className="shopping-item-delete"
            aria-label={`הסרת ${name} מהרשימה`}
            disabled={pending}
            onClick={(event) => onRemove(item, event)}
          >
            <Trash2 size={16} aria-hidden="true" />
          </IconButton>
        )}
      </div>
    </article>
  );
};

const ShoppingItemGroup = ({ group, editable, pendingItemId, onToggle, onRemove }) => {
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
    />
  ));

  return (
    <GlassCard className="shopping-item-group" padding="var(--ft-space-7)">
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

const AddShoppingItem = ({
  open,
  mode,
  form,
  catalogCategories,
  catalogItems,
  catalogLoading,
  pending,
  error,
  touched,
  onOpen,
  onClose,
  onModeChange,
  onFormChange,
  onCreateCategory,
  onSubmit,
}) => {
  if (!open) {
    return (
      <GlassCard className="shopping-add-collapsed" padding="0">
        <button type="button" onClick={onOpen}>
          <Plus size={18} aria-hidden="true" />
          הוספת פריט לרשימה
        </button>
      </GlassCard>
    );
  }

  const itemMissing = touched && mode === 'catalog' && !form.catalogItemId;
  const nameMissing = touched && mode === 'custom' && !form.customName.trim();
  const categoryMissing = touched && !form.categoryId;

  return (
    <GlassCard className="shopping-add-item" padding="20px">
      <section aria-labelledby="shopping-add-item-title">
        <div className="shopping-section-heading">
          <h3 id="shopping-add-item-title">הוספת פריט</h3>
          <IconButton type="button" size="touch" aria-label="סגירת טופס הוספת פריט" disabled={pending} onClick={onClose}>
            <X size={17} aria-hidden="true" />
          </IconButton>
        </div>

        <SegmentedControl
          className="shopping-item-mode"
          value={mode}
          onValueChange={onModeChange}
          options={ITEM_MODES}
          label="מקור הפריט"
          disabled={pending}
        />

        {error && <Alert variant="error" urgent>{error}</Alert>}

        <form className="shopping-add-form" onSubmit={onSubmit} noValidate>
          <div className="shopping-add-form__primary">
            {mode === 'catalog' ? (
              <Select
                id="shopping-catalog-item"
                label="פריט מהקטלוג"
                required
                helperText="בחירת פריט מביאה את יחידת המידה והמחיר המוגדרים בקטלוג; ניתן לשנות אותם לרשימה הזו."
                value={form.catalogItemId}
                onValueChange={(value) => onFormChange('catalogItemId', value)}
                error={itemMissing ? 'יש לבחור פריט מהקטלוג' : undefined}
                loading={catalogLoading}
                disabled={!form.categoryId || pending}
              >
                <option value="">בחירת פריט מהקטלוג</option>
                {catalogItems.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </Select>
            ) : (
              <TextField
                id="shopping-custom-item"
                label="שם הפריט"
                required
                placeholder="למשל: רוטב פסטו"
                value={form.customName}
                onValueChange={(value) => onFormChange('customName', value)}
                error={nameMissing ? 'יש להזין שם לפריט' : undefined}
                disabled={pending}
              />
            )}
          </div>

          <div className="shopping-add-form__details">
            <div className="shopping-category-field">
              <Select
                id="shopping-catalog-category"
                label="קטגוריית קטלוג"
                required
                value={form.categoryId}
                onValueChange={(value) => onFormChange('categoryId', value)}
                error={categoryMissing ? 'יש לבחור קטגוריית קטלוג' : undefined}
                disabled={pending}
              >
                <option value="">בחירת קטגוריית קטלוג</option>
                {catalogCategories.map((category) => (
                  <option key={category.id} value={category.id}>{category.icon} {category.name}</option>
                ))}
              </Select>
              <IconButton
                type="button"
                size="touch"
                aria-label="יצירת קטגוריית קטלוג חדשה"
                disabled={pending}
                onClick={onCreateCategory}
              >
                <Plus size={17} aria-hidden="true" />
              </IconButton>
            </div>
            <NumberField
              id="shopping-item-quantity"
              label="כמות"
              min="1"
              required
              value={form.quantity}
              onValueChange={(value) => onFormChange('quantity', value)}
              disabled={pending}
            />
            <TextField
              id="shopping-item-unit"
              label="יחידה"
              placeholder="ק״ג / יח׳ / ליטר"
              value={form.unit}
              onValueChange={(value) => onFormChange('unit', value)}
              disabled={pending}
            />
            <NumberField
              id="shopping-item-price"
              label="מחיר ליחידה"
              prefix="₪"
              step="0.01"
              value={form.price}
              onValueChange={(value) => onFormChange('price', value)}
              disabled={pending}
            />
          </div>

          <TextField
            id="shopping-item-notes"
            label="הערות"
            placeholder="למשל: אם אין — תחליף"
            value={form.notes}
            onValueChange={(value) => onFormChange('notes', value)}
            disabled={pending}
          />

          {mode === 'custom' && (
            <div className="shopping-catalog-behavior">
              <Package size={16} aria-hidden="true" />
              פריט חופשי שנוסף בהצלחה נשמר בקטלוג לשימוש חוזר.
            </div>
          )}

          <div className="shopping-form-actions">
            <PrimaryButton type="submit" loading={pending} loadingText="מוסיף פריט…">
              <Plus size={16} aria-hidden="true" />
              הוספה לרשימה
            </PrimaryButton>
            <SecondaryButton type="button" disabled={pending} onClick={onClose}>ביטול</SecondaryButton>
          </div>
        </form>
      </section>
    </GlassCard>
  );
};

const CheckoutDialog = ({
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
        <PrimaryButton type="button" loading={pending} loadingText="סוגר קנייה…" onClick={onConfirm}>
          <Receipt size={16} aria-hidden="true" />
          סגירת הקנייה ויצירת תנועה
        </PrimaryButton>
      </>
    )}
  >
    <div className="shopping-checkout-content">
      {error && (
        <Alert variant="error" urgent title="סגירת הקנייה לא הושלמה">
          הרשימה לא הוצגה כקנייה סגורה. סימוני הפריטים נשמרו ואפשר לנסות שוב.
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
  const categoryReturnFocusRef = useRef(null);
  const itemDeleteReturnFocusRef = useRef(null);
  const activateReturnFocusRef = useRef(null);
  const newCategoryInputRef = useRef(null);
  const [list, setList] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [catalogCategories, setCatalogCategories] = useState([]);
  const [catalogItems, setCatalogItems] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [itemMode, setItemMode] = useState('catalog');
  const [itemForm, setItemForm] = useState(initialItemForm);
  const [itemTouched, setItemTouched] = useState(false);
  const [itemPending, setItemPending] = useState(false);
  const [itemError, setItemError] = useState('');
  const [pendingItemId, setPendingItemId] = useState(null);
  const [itemDeleteTarget, setItemDeleteTarget] = useState(null);
  const [showNewCategoryDialog, setShowNewCategoryDialog] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryPending, setCategoryPending] = useState(false);
  const [categoryError, setCategoryError] = useState('');
  const [showActivateConfirm, setShowActivateConfirm] = useState(false);
  const [activating, setActivating] = useState(false);
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

  useEffect(() => {
    if (!list?.list_type_id) {
      setCatalogCategories([]);
      return;
    }
    let active = true;
    getShoppingCatalogCategories(list.list_type_id)
      .then((response) => {
        if (active) setCatalogCategories(Array.isArray(response.data) ? response.data : []);
      })
      .catch(() => {
        if (active) setItemError('טעינת קטגוריות הקטלוג נכשלה.');
      });
    return () => { active = false; };
  }, [list?.list_type_id]);

  useEffect(() => {
    if (!itemForm.categoryId) {
      setCatalogItems([]);
      return;
    }
    let active = true;
    setCatalogLoading(true);
    getShoppingCatalogItems({ category_id: itemForm.categoryId })
      .then((response) => {
        if (active) setCatalogItems(Array.isArray(response.data) ? response.data : []);
      })
      .catch(() => {
        if (active) setItemError('טעינת פריטי הקטלוג נכשלה.');
      })
      .finally(() => {
        if (active) setCatalogLoading(false);
      });
    return () => { active = false; };
  }, [itemForm.categoryId]);

  useEffect(() => {
    if (!itemForm.catalogItemId) return;
    const item = catalogItems.find((entry) => String(entry.id) === String(itemForm.catalogItemId));
    if (!item) return;
    setItemForm((current) => ({
      ...current,
      unit: item.default_unit || current.unit,
      price: item.default_price || item.default_price === 0 ? item.default_price : current.price,
    }));
  }, [catalogItems, itemForm.catalogItemId]);

  const isEditable = list?.status === 'draft' || list?.status === 'active';

  const openAddForm = useCallback(() => {
    if (!isEditable) return;
    setItemError('');
    setShowAddForm(true);
  }, [isEditable]);

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

  const updateItemForm = (name, value) => {
    setItemForm((current) => ({
      ...current,
      [name]: value,
      ...(name === 'categoryId' ? { catalogItemId: '', unit: '', price: '' } : {}),
    }));
  };

  const handleItemModeChange = (mode) => {
    setItemMode(mode);
    setItemTouched(false);
    setItemError('');
    setItemForm((current) => ({ ...current, catalogItemId: '', customName: '' }));
  };

  const handleAddItem = async (event) => {
    event.preventDefault();
    if (itemPending) return;
    setItemTouched(true);
    setItemError('');
    if (!itemForm.categoryId) return;
    if (itemMode === 'catalog' && !itemForm.catalogItemId) return;
    if (itemMode === 'custom' && !itemForm.customName.trim()) return;

    setItemPending(true);
    try {
      await addShoppingListItem(listId, {
        catalog_item_id: itemMode === 'custom' ? null : itemForm.catalogItemId,
        custom_name: itemMode === 'custom' ? itemForm.customName : null,
        category_id: itemForm.categoryId,
        quantity: itemForm.quantity || 1,
        unit: itemForm.unit || null,
        price: itemForm.price || null,
        notes: itemForm.notes || null,
      });
      setItemForm(initialItemForm);
      setItemTouched(false);
      setCatalogItems([]);
      await fetchList({ showLoading: false });
    } catch {
      setItemError('הוספת הפריט נכשלה. הפרטים נשמרו וניתן לנסות שוב.');
    } finally {
      setItemPending(false);
    }
  };

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
      const [sourcesResponse, categoriesResponse] = await Promise.all([
        getPaymentSources(),
        getCategories(),
      ]);
      const sources = Array.isArray(sourcesResponse.data) ? sourcesResponse.data : [];
      setPaymentSources(sources);
      setExpenseCategories(Array.isArray(categoriesResponse.data) ? categoriesResponse.data : []);
      setCheckoutPaymentSourceId(sources[0]?.id ? String(sources[0].id) : '');
      setShowCheckout(true);
    } catch {
      setMutationError('טעינת נתוני הסגירה נכשלה. הרשימה נשארה פעילה.');
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleCheckout = async () => {
    if (checkoutPending) return;
    setCheckoutPending(true);
    setCheckoutError(false);
    try {
      await checkoutShoppingList(listId, {
        payment_source_id: checkoutPaymentSourceId || null,
        category_id: checkoutCategoryId || null,
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
    } catch {
      setCheckoutError(true);
    } finally {
      setCheckoutPending(false);
    }
  };

  const openNewCategory = (event) => {
    categoryReturnFocusRef.current = event.currentTarget;
    setNewCategoryName('');
    setCategoryError('');
    setShowNewCategoryDialog(true);
  };

  const handleCreateCategory = async (event) => {
    event.preventDefault();
    if (categoryPending || !newCategoryName.trim()) return;
    setCategoryPending(true);
    setCategoryError('');
    try {
      const response = await createShoppingCatalogCategory({
        name: newCategoryName.trim(),
        list_type_id: list?.list_type_id || null,
      });
      setCatalogCategories((current) => [...current, response.data]);
      updateItemForm('categoryId', String(response.data.id));
      setShowNewCategoryDialog(false);
    } catch {
      setCategoryError('יצירת קטגוריית הקטלוג נכשלה. השם נשמר וניתן לנסות שוב.');
    } finally {
      setCategoryPending(false);
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
          {isEditable && (
            <div className="shopping-detail-primary-action">
              <div className="shopping-mobile-action-total">
                <span>{list.status === 'active' ? 'סך שנקנה' : 'עלות משוערת'}</span>
                <MoneyAmount
                  value={list.status === 'active' ? stats.purchasedCost : stats.estimatedCost}
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

        <div className="shopping-detail-kpis" aria-label="סיכום הרשימה">
          <div className="shopping-detail-kpi"><span>פריטים</span><strong><TechnicalValue>{stats.total}</TechnicalValue></strong></div>
          <div className="shopping-detail-kpi"><span>נקנו</span><strong><TechnicalValue>{stats.purchased}</TechnicalValue></strong></div>
          <div className="shopping-detail-kpi"><span>עלות משוערת</span><MoneyAmount value={stats.estimatedCost} minimumFractionDigits={2} maximumFractionDigits={2} /></div>
          <div className="shopping-detail-kpi is-positive"><span>עלות מה שנקנה</span><MoneyAmount value={stats.purchasedCost} minimumFractionDigits={2} maximumFractionDigits={2} /></div>
        </div>

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

      {mutationError && (
        <Alert variant="error" urgent onDismiss={() => setMutationError('')}>
          {mutationError}
        </Alert>
      )}

      {isEditable && (
        <AddShoppingItem
          open={showAddForm}
          mode={itemMode}
          form={itemForm}
          catalogCategories={catalogCategories}
          catalogItems={catalogItems}
          catalogLoading={catalogLoading}
          pending={itemPending}
          error={itemError}
          touched={itemTouched}
          onOpen={openAddForm}
          onClose={() => setShowAddForm(false)}
          onModeChange={handleItemModeChange}
          onFormChange={updateItemForm}
          onCreateCategory={openNewCategory}
          onSubmit={handleAddItem}
        />
      )}

      {items.length === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          title="הרשימה עדיין ריקה"
          description={isEditable
            ? 'אפשר להוסיף פריטים מהקטלוג או להזין פריט חופשי.'
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
            />
          ))}
        </div>
      )}

      <Dialog
        open={showNewCategoryDialog}
        onClose={() => !categoryPending && setShowNewCategoryDialog(false)}
        title="קטגוריית קטלוג חדשה"
        description="הקטגוריה תתווסף למיפוי של סוג הרשימה הנוכחי."
        size="sm"
        className="shopping-dialog"
        initialFocusRef={newCategoryInputRef}
        returnFocusRef={categoryReturnFocusRef}
        closeDisabled={categoryPending}
        footer={(
          <>
            <SecondaryButton type="button" disabled={categoryPending} onClick={() => setShowNewCategoryDialog(false)}>ביטול</SecondaryButton>
            <PrimaryButton type="submit" form="shopping-category-form" loading={categoryPending} loadingText="שומר…">שמירה</PrimaryButton>
          </>
        )}
      >
        <form id="shopping-category-form" className="shopping-dialog-form" onSubmit={handleCreateCategory}>
          {categoryError && <Alert variant="error" urgent>{categoryError}</Alert>}
          <TextField
            ref={newCategoryInputRef}
            id="shopping-new-category"
            label="שם קטגוריית הקטלוג"
            required
            placeholder="למשל: מוצרי ניקוי"
            value={newCategoryName}
            onValueChange={setNewCategoryName}
            disabled={categoryPending}
          />
        </form>
      </Dialog>

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
        open={showCheckout}
        list={list}
        stats={stats}
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
