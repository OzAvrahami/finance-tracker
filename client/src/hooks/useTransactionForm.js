import { useState, useEffect } from 'react';
import { createTransaction, updateTransaction, getTransactionById, getTags, getLegoThemes, getLegoSetDetails, getCategories, getPaymentSources, createCategory, getAllLoans } from '../services/api';
import { useNavigate, useParams } from 'react-router-dom';
import { getTransactionTotalValue } from '../utils/transactionPricing';
import { invalidateLegoCollection } from '../utils/legoCollectionInvalidation';
import { addCalendarMonthIso, validateManualLoanPayment } from '../utils/manualLoanPayment';

let nextItemKey = 0;

const createItemKey = () => `transaction-item-${nextItemKey += 1}`;

const withItemKey = (item) => ({
  ...item,
  acquisition_type: item.acquisition_type === 'purchased'
    ? 'purchase'
    : (item.acquisition_type || 'purchase'),
  _uiKey: item._uiKey || (item.id ? `transaction-item-saved-${item.id}` : createItemKey()),
});

const withoutItemKey = (item) => {
  const payloadItem = { ...item };
  delete payloadItem._uiKey;
  return payloadItem;
};

const getNextMonth2nd = (dateStr) => {
  const d = dateStr ? new Date(dateStr) : new Date();
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 2);
  return next.toISOString().split('T')[0];
};

const useTransactionForm = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditMode = Boolean(id);

  const [loading, setLoading] = useState(Boolean(id));
  const [items, setItems] = useState([]);
  const [availableTags, setAvailableTags] = useState([]);
  const [legoThemes, setLegoThemes] = useState([]);
  const [categories, setCategories] = useState([]);
  const [paymentSources, setPaymentSources] = useState([]);
  const [loans, setLoans] = useState([]);
  const [showNewCategoryModal, setShowNewCategoryModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [loanHandling, setLoanHandling] = useState({
    mode: 'link_only',
    principal_amount: '',
    interest_amount: '',
    other_amount: '0',
    next_scheduled_due_date: '',
  });
  const [loanPaymentError, setLoanPaymentError] = useState('');

  const [transaction, setTransaction] = useState({
    transaction_date: new Date().toISOString().split('T')[0],
    charge_date: getNextMonth2nd(),
    description: '',
    movement_type: 'expense',
    category_id: '',
    payment_source_id: '',
    total_amount: 0,
    global_discount: 0,
    global_discount_source: '',
    tags: '',
    loan_id: '',
    original_amount: '',
    currency: 'ILS',
    exchange_rate: '',
    installments_info: '',
    installment_count: 1,
    notes: ''
  });

  // Load Initial Data
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [tagsRes, themesRes, catsRes, psRes] = await Promise.all([
          getTags(),
          getLegoThemes(),
          getCategories(),
          getPaymentSources()
        ]);
        setAvailableTags(tagsRes.data);
        setLegoThemes(themesRes.data);
        setCategories(catsRes.data);
        setPaymentSources(psRes.data);
        // Set default payment_source_id to first active source
        if (psRes.data.length > 0 && !id) {
          setTransaction(prev => ({ ...prev, payment_source_id: psRes.data[0].id }));
        }

        try {
          const loansRes = await getAllLoans();
          setLoans(loansRes.data);
        } catch (e) {
          console.error("Error loading loans", e);
        }
      } catch (error) {
        console.error("Error loading initial data", error);
      }
    };
    fetchData();
  // This request intentionally runs once; `id` is handled by the edit-loading effect below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load Transaction for Edit
  useEffect(() => {
    if (isEditMode) {
      // Preserve the existing edit-route loading boundary while the request is in flight.
      setLoading(true);
      getTransactionById(id)
        .then(res => {
          const data = res.data;
          if (!data) return;

          setTransaction({
            transaction_date: data.transaction_date || new Date().toISOString().split('T')[0],
            charge_date: data.charge_date || data.transaction_date || new Date().toISOString().split('T')[0],
            description: data.description || '',
            movement_type: data.movement_type || 'expense',
            category_id: data.category_id || '',
            payment_source_id: data.payment_source_id || '',
            total_amount: data.total_amount || 0,
            global_discount: data.global_discount || 0,
            global_discount_source: data.global_discount_source || '',
            tags: data.tags || '',
            loan_id: data.loan_id || '',
            original_amount: data.original_amount || '',
            currency: data.currency || 'ILS',
            exchange_rate: data.exchange_rate || '',
            installments_info: data.installments_info || '',
            installment_count: 1,
            notes: data.notes || ''
          });
          setLoanHandling(data.loan_payment ? {
            mode: 'repayment',
            principal_amount: String(data.loan_payment.principal_amount ?? ''),
            interest_amount: String(data.loan_payment.interest_amount ?? ''),
            other_amount: String(data.loan_payment.other_amount ?? 0),
            next_scheduled_due_date: data.loan_payment.next_scheduled_due_date || '',
          } : {
            mode: 'link_only',
            principal_amount: '',
            interest_amount: '',
            other_amount: '0',
            next_scheduled_due_date: '',
          });

          if (data.transaction_items?.length > 0) {
            setItems(data.transaction_items.map(withItemKey));
          } else {
            setItems([]);
          }
          setLoading(false);
        })
        .catch(err => {
          console.error(err);
          alert("שגיאה בטעינת העסקה");
          navigate('/');
        });
    }
  }, [id, isEditMode, navigate]);

  useEffect(() => {
    if (items.length > 0) {
      // The existing item model owns the authoritative transaction total through this effect.
      setTransaction(prev => ({
        ...prev,
        total_amount: getTransactionTotalValue(items, transaction.global_discount),
      }));
    }
  }, [items, transaction.global_discount]);

  // --- Helpers ---
  const isLegoCategory = () => {
    const selectedCat = categories.find(c => String(c.id) === String(transaction.category_id));
    return selectedCat?.name === 'Lego' || selectedCat?.name === 'לגו';
  };

  const isLoanCategory = () => {
    return String(transaction.category_id) === '24';
  };

  // Keep the complete loan records available for form/accounting behavior,
  // while preventing new activity from being linked to a paid loan. An edit
  // must still be able to represent its existing historical loan relation.
  const loanOptions = loans.filter((loan) => (
    loan.status !== 'paid'
      || (isEditMode && String(loan.id) === String(transaction.loan_id))
  ));

  // --- Handlers ---
  const handleTransactionChange = (e) => {
    const { name, value } = e.target;

    if (name === 'loan_id' && String(value) !== String(transaction.loan_id)) {
      setLoanHandling({
        mode: 'link_only',
        principal_amount: '',
        interest_amount: '',
        other_amount: '0',
        next_scheduled_due_date: '',
      });
      setLoanPaymentError('');
    }

    setTransaction(prev => {
      const updated = { ...prev, [name]: value };

      // לוגיקה לזיהוי אוטומטי של קטגוריה לפי תיאור
      if (name === 'description') {
        const foundCategory = categories.find(cat =>
          cat.keywords && cat.keywords.some(k => value.toLowerCase().includes(k.toLowerCase()))
        );

        if (foundCategory) {
          updated.category_id = foundCategory.id;
        }
      }

      // חישוב אוטומטי של תאריך חיוב
      if (name === 'payment_source_id') {
        const selectedPS = paymentSources.find(ps => String(ps.id) === String(value));
        if (selectedPS?.method === 'credit_card') {
          updated.charge_date = getNextMonth2nd(prev.transaction_date);
        } else {
          updated.charge_date = prev.transaction_date;
        }
      }
      if (name === 'transaction_date') {
        const currentPS = paymentSources.find(ps => String(ps.id) === String(prev.payment_source_id));
        if (currentPS?.method === 'credit_card') {
          updated.charge_date = getNextMonth2nd(value);
        } else {
          updated.charge_date = value;
        }
      }

      return updated;
    });
  };

  const handleItemChange = (index, field, value) => {
    setItems((currentItems) => currentItems.map((item, itemIndex) => (
      itemIndex === index
        ? {
          ...item,
          [field]: value,
          ...(field === 'set_number' ? { pieces: null, image_url: null } : {}),
          ...(field === 'acquisition_type' && ['gift', 'gwp'].includes(value)
            ? { discount_type: 'percent', discount_value: 100 }
            : {}),
          ...(field === 'acquisition_type' && value === 'purchase'
            ? { discount_type: 'amount', discount_value: 0 }
            : {}),
        }
        : item
    )));
  };

  const handleLoanHandlingModeChange = (mode) => {
    const selectedLoan = loans.find(
      (loan) => String(loan.id) === String(transaction.loan_id),
    );
    setLoanHandling((previous) => ({
      ...previous,
      mode,
      ...(mode === 'link_only' ? {
        principal_amount: '',
        interest_amount: '',
        other_amount: '0',
      } : {
        next_scheduled_due_date: previous.next_scheduled_due_date
          || addCalendarMonthIso(selectedLoan?.next_payment_date),
      }),
    }));
    setLoanPaymentError('');
  };

  const handleLoanPaymentChange = (event) => {
    const { name, value } = event.target;
    setLoanHandling((previous) => ({ ...previous, [name]: value }));
    setLoanPaymentError('');
  };

  const addItem = () => setItems((currentItems) => [
    ...currentItems,
    withItemKey({ item_name: '', quantity: 1, price_per_unit: 0, set_number: '', theme: '', brand: 'LEGO', acquisition_type: 'purchase', tags: '', discount_type: 'amount', discount_value: 0 }),
  ]);

  const clearItems = () => setItems([]);

  const removeItem = (index) => setItems((currentItems) => currentItems.filter((_, itemIndex) => itemIndex !== index));

  const handleSaveNewCategory = async () => {
    if (!newCategoryName.trim()) return;

    try {
      const res = await createCategory({ name: newCategoryName });
      const newCat = res.data;

      setCategories(prev => [...prev, newCat]);
      setTransaction(prev => ({ ...prev, category_id: newCat.id }));

      setNewCategoryName('');
      setShowNewCategoryModal(false);
    } catch (error) {
      console.error("Failed to create category", error);
      alert("שגיאה ביצירת קטגוריה");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const selectedLoan = loans.find((loan) => String(loan.id) === String(transaction.loan_id));
    const repaymentSelected = isLoanCategory()
      && selectedLoan?.calculation_mode === 'loan_payments'
      && loanHandling.mode === 'repayment';
    if (repaymentSelected) {
      const validationError = validateManualLoanPayment({
        total: transaction.total_amount,
        principal: loanHandling.principal_amount,
        interest: loanHandling.interest_amount,
        other: loanHandling.other_amount,
        nextScheduledDueDate: loanHandling.next_scheduled_due_date,
        requiresNextScheduledDate: Number(selectedLoan.remaining_installments) > 1
          && Number(loanHandling.principal_amount) < Number(selectedLoan.current_balance),
      });
      if (validationError) {
        setLoanPaymentError(validationError);
        return;
      }
    }
    try {
      const payload = {
        transaction: {
            ...transaction,
            category_id: transaction.category_id ? parseInt(transaction.category_id) : null,
            loan_id: transaction.loan_id ? parseInt(transaction.loan_id) : null,
            payment_source_id: transaction.payment_source_id ? parseInt(transaction.payment_source_id) : null,
            installment_count: parseInt(transaction.installment_count) || 1,
        },
        items: items.map(withoutItemKey),
        ...(transaction.loan_id ? {
          loan_handling: {
            mode: repaymentSelected ? 'repayment' : 'link_only',
            ...(repaymentSelected ? {
              principal_amount: loanHandling.principal_amount,
              interest_amount: loanHandling.interest_amount,
              other_amount: loanHandling.other_amount,
              next_scheduled_due_date: loanHandling.next_scheduled_due_date || null,
            } : {}),
          },
        } : {}),
      };

      if (isEditMode) {
        await updateTransaction(id, payload);
        if (isLegoCategory() && items.some((item) => String(item.set_number || '').trim())) {
          invalidateLegoCollection();
        }
        alert('העסקה עודכנה בהצלחה! 💾');
        navigate('/transactions');
        return;
      } else {
        await createTransaction(payload);
        if (isLegoCategory() && items.some((item) => String(item.set_number || '').trim())) {
          invalidateLegoCollection();
        }
        alert('התנועה נשמרה בהצלחה! 🚀');
      }

      // Reset form
      setTransaction({
        transaction_date: new Date().toISOString().split('T')[0],
        charge_date: getNextMonth2nd(),
        description: '',
        movement_type: 'expense',
        category_id: '',
        payment_source_id: transaction.payment_source_id,
        total_amount: 0,
        global_discount: 0,
        global_discount_source: '',
        tags: '',
        loan_id: '',
        original_amount: '',
        currency: 'ILS',
        exchange_rate: '',
        installments_info: '',
        installment_count: 1,
        notes: '',
      });
      setItems([]);
      setLoanHandling({
        mode: 'link_only',
        principal_amount: '',
        interest_amount: '',
        other_amount: '0',
        next_scheduled_due_date: '',
      });
      setLoanPaymentError('');

    } catch (error) {
      console.error('Error saving transaction:', error);
      alert('שגיאה בשמירת התנועה');
    }
  };

  const handleSetNumberBlur = async (itemKey, setNumber) => {
    if (!setNumber || !isLegoCategory()) return false;

    try {
        const res = await getLegoSetDetails(setNumber);
        setItems((currentItems) => currentItems.map((item) => {
          if (item._uiKey !== itemKey) return item;
          return {
            ...item,
            item_name: item.item_name || res.data.name,
            theme: item.theme || res.data.theme,
            brand: item.brand || res.data.brand || 'LEGO',
            pieces: res.data.parts ?? item.pieces ?? null,
            image_url: res.data.img ?? item.image_url ?? null,
          };
        }));
        return res.data;
    } catch {
        console.log("Set details not found");
        return false;
    }
  };

  return {
    // State
    loading,
    transaction,
    setTransaction,
    items,
    categories,
    paymentSources,
    loans,
    loanOptions,
    loanHandling,
    loanPaymentError,
    legoThemes,
    availableTags,
    isEditMode,
    showNewCategoryModal,
    setShowNewCategoryModal,
    newCategoryName,
    setNewCategoryName,

    // Helpers
    isLegoCategory,
    isLoanCategory,

    // Handlers
    handleTransactionChange,
    handleLoanHandlingModeChange,
    handleLoanPaymentChange,
    handleItemChange,
    addItem,
    clearItems,
    removeItem,
    handleSaveNewCategory,
    handleSubmit,
    handleSetNumberBlur,
  };
};

export default useTransactionForm;
