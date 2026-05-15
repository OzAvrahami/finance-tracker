import { useState, useEffect } from 'react';
import { createTransaction, updateTransaction, getTransactionById, getTags, getLegoThemes, getLegoSetDetails, getCategories, getPaymentSources, createCategory, getAllLoans } from '../services/api';
import { useNavigate, useParams } from 'react-router-dom';

const getNextMonth2nd = (dateStr) => {
  const d = dateStr ? new Date(dateStr) : new Date();
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 2);
  return next.toISOString().split('T')[0];
};

const useTransactionForm = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditMode = Boolean(id);

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [availableTags, setAvailableTags] = useState([]);
  const [legoThemes, setLegoThemes] = useState([]);
  const [categories, setCategories] = useState([]);
  const [paymentSources, setPaymentSources] = useState([]);
  const [loans, setLoans] = useState([]);
  const [showNewCategoryModal, setShowNewCategoryModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');

  const [transaction, setTransaction] = useState({
    transaction_date: new Date().toISOString().split('T')[0],
    charge_date: getNextMonth2nd(),
    description: '',
    movement_type: 'expense',
    category_id: '',
    payment_source_id: '',
    total_amount: 0,
    global_discount: 0,
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
  }, []);

  // Load Transaction for Edit
  useEffect(() => {
    if (isEditMode) {
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
            tags: data.tags || '',
            loan_id: data.loan_id || '',
            original_amount: data.original_amount || '',
            currency: data.currency || 'ILS',
            exchange_rate: data.exchange_rate || '',
            installments_info: data.installments_info || '',
            installment_count: 1,
            notes: data.notes || ''
          });

          if (data.transaction_items?.length > 0) {
            setItems(data.transaction_items);
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

  // --- Calculations ---
  const calculateFinalPrice = (price, type, value) => {
    if (!price) return 0;
    const p = Number(price);
    const v = Number(value);
    return type === 'percent' ? p - (p * (v / 100)) : p - v;
  };

  const calculateTotal = () => {
    const itemsTotal = items.reduce((sum, item) => {
      const linePrice = calculateFinalPrice(item.price_per_unit, item.discount_type, item.discount_value);
      return sum + (linePrice * item.quantity);
    }, 0);

    const finalTotal = itemsTotal - Number(transaction.global_discount);
    return finalTotal > 0 ? finalTotal : 0;
  };

  useEffect(() => {
    if (items.length > 0) {
      setTransaction(prev => ({ ...prev, total_amount: calculateTotal() }));
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

  // --- Handlers ---
  const handleTransactionChange = (e) => {
    const { name, value } = e.target;

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
    const newItems = [...items];
    newItems[index][field] = value;
    setItems(newItems);
  };

  const addItem = () => setItems([...items, { item_name: '', quantity: 1, price_per_unit: 0, set_number: '', theme: '', brand: 'LEGO', tags: '', discount_type: 'amount', discount_value: 0 }]);

  const removeItem = (index) => setItems(items.filter((_, i) => i !== index));

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
    try {
      const payload = {
        transaction: {
            ...transaction,
            category_id: transaction.category_id ? parseInt(transaction.category_id) : null,
            loan_id: transaction.loan_id ? parseInt(transaction.loan_id) : null,
            payment_source_id: transaction.payment_source_id ? parseInt(transaction.payment_source_id) : null,
            installment_count: parseInt(transaction.installment_count) || 1,
        },
        items
      };

      if (isEditMode) {
        await updateTransaction(id, payload);
        alert('העסקה עודכנה בהצלחה! 💾');
      } else {
        await createTransaction(payload);
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

    } catch (error) {
      console.error('Error saving transaction:', error);
      alert('שגיאה בשמירת התנועה');
    }
  };

  const handleSetNumberBlur = async (index, setNumber) => {
    if (!setNumber || !isLegoCategory()) return;

    try {
        const res = await getLegoSetDetails(setNumber);
        const newItems = [...items];
        if (!newItems[index].item_name) newItems[index].item_name = res.data.name;
        if (!newItems[index].theme) newItems[index].theme = res.data.theme;
        setItems(newItems);
    } catch (error) {
        console.log("Set details not found");
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
    handleItemChange,
    addItem,
    removeItem,
    handleSaveNewCategory,
    handleSubmit,
    handleSetNumberBlur,
  };
};

export default useTransactionForm;
