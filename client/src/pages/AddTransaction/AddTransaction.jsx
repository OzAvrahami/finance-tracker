import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronRight,
  FileUp,
  Info,
  Plus,
  Save,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import useTransactionForm from '../../hooks/useTransactionForm';
import CategoryCombobox from '../../components/CategoryCombobox';
import NewCategoryModal from '../../components/NewCategoryModal';
import ItemCard, { LegoItemFields } from '../../components/ItemCard';
import {
  Alert,
  Button,
  DateField,
  MoneyAmount,
  NumberField,
  SegmentedControl,
  Select,
  TextArea,
  TextField,
} from '../../components/ui';
import TransactionFormSection from './TransactionFormSection';
import TransactionFormSkeleton from './TransactionFormSkeleton';
import TransactionTotals from './TransactionTotals';
import './TransactionForm.css';

const movementOptions = [
  { value: 'expense', label: 'הוצאה', icon: TrendingDown },
  { value: 'income', label: 'הכנסה', icon: TrendingUp },
];

const amountModeOptions = [
  { value: 'direct', label: 'סכום אחיד' },
  { value: 'items', label: 'פירוט פריטים' },
];

const AddTransaction = () => {
  const {
    loading,
    transaction,
    setTransaction,
    items,
    categories,
    paymentSources,
    loans,
    legoThemes,
    isEditMode,
    showNewCategoryModal,
    setShowNewCategoryModal,
    newCategoryName,
    setNewCategoryName,
    isLegoCategory,
    isLoanCategory,
    handleTransactionChange,
    handleItemChange,
    addItem,
    clearItems,
    removeItem,
    handleSaveNewCategory,
    handleSubmit,
    handleSetNumberBlur,
  } = useTransactionForm();
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const submitForm = async (event) => {
    if (submittingRef.current) {
      event.preventDefault();
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      await handleSubmit(event);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  if (loading) return <TransactionFormSkeleton />;

  const legoCategorySelected = isLegoCategory();
  const loanCategorySelected = isLoanCategory();
  const hasItems = items.length > 0;
  const hasContextFields = legoCategorySelected || loanCategorySelected;
  const installmentCount = Number(transaction.installment_count) || 1;
  const perInstallment = installmentCount > 1 && Number(transaction.total_amount) > 0
    ? Math.round((Number(transaction.total_amount) / installmentCount) * 100) / 100
    : null;

  const handleAmountModeChange = (value) => {
    if (value === 'items' && !hasItems) {
      addItem();
    } else if (value === 'direct' && hasItems) {
      clearItems();
    }
  };

  const amountMode = (
    <SegmentedControl
      className="transaction-amount-mode"
      label="אופן הזנת הסכום"
      value={hasItems ? 'items' : 'direct'}
      options={amountModeOptions}
      size="compact"
      onValueChange={handleAmountModeChange}
    />
  );

  return (
    <div className="transaction-form-page" dir="rtl">
      <div className="transaction-form-toolbar">
        <Link className="transaction-form-back-link" to="/transactions">
          <ChevronRight size={16} aria-hidden="true" />
          חזרה לתנועות
        </Link>
        <span className="transaction-form-toolbar__spacer" />
        {!isEditMode && (
          <Link className="transaction-form-import-link" to="/import">
            <FileUp size={17} aria-hidden="true" />
            ייבוא מאקסל
          </Link>
        )}
      </div>

      {isEditMode && transaction.installments_info && (
        <Alert variant="info" title="עריכת תשלום יחיד">
          השינויים יחולו על התנועה הזאת בלבד ולא על יתר התשלומים בסדרה.
        </Alert>
      )}

      <form className="transaction-form" onSubmit={submitForm}>
        <TransactionFormSection
          step="1"
          title="פרטי הליבה"
        >
          <div className="transaction-form-movement">
            <span id="movement-type-label" className="u-sr-only">סוג תנועה</span>
            <SegmentedControl
              labelledBy="movement-type-label"
              value={transaction.movement_type}
              options={movementOptions}
              fullWidth
              onValueChange={(value) => handleTransactionChange({ target: { name: 'movement_type', value } })}
            />
          </div>

          <div className="transaction-core-grid">
            <TextField
              className="transaction-core-grid__wide"
              name="description"
              label="תיאור"
              value={transaction.description}
              onChange={handleTransactionChange}
              required
            />
            <DateField
              name="transaction_date"
              label="תאריך התנועה"
              value={transaction.transaction_date}
              onChange={handleTransactionChange}
              required
            />
            <DateField
              name="charge_date"
              label="תאריך חיוב"
              value={transaction.charge_date}
              onChange={handleTransactionChange}
              helperText="מועד החיוב בפועל בכרטיס — יכול להיות שונה מתאריך התנועה."
            />
            <CategoryCombobox
              label="קטגוריה"
              categories={categories}
              selectedCategoryId={transaction.category_id}
              onSelect={(categoryId) => setTransaction((previous) => ({ ...previous, category_id: categoryId }))}
              onOpenNewModal={(categoryName = '') => {
                setNewCategoryName(categoryName);
                setShowNewCategoryModal(true);
              }}
              required
            />
            <Select
              name="payment_source_id"
              label="אמצעי תשלום"
              value={transaction.payment_source_id}
              onChange={handleTransactionChange}
              placeholder="בחירת אמצעי תשלום"
              required
            >
              {paymentSources.map((paymentSource) => (
                <option key={paymentSource.id} value={paymentSource.id}>
                  {paymentSource.name}{paymentSource.last4 ? ` (${paymentSource.last4})` : ''}
                </option>
              ))}
            </Select>
            <TextArea
              className="transaction-core-grid__wide transaction-core-notes"
              name="notes"
              label="הערות"
              value={transaction.notes}
              onChange={handleTransactionChange}
              placeholder="למשל: קנייה משותפת, יש להחזיר חצי"
              rows={2}
            />
          </div>
        </TransactionFormSection>

        <TransactionFormSection
          step="2"
          title="סכום התנועה"
          headerAside={amountMode}
        >
          {!hasItems && (
            <NumberField
              className="transaction-direct-amount"
              name="total_amount"
              label="סכום"
              value={transaction.total_amount}
              onChange={handleTransactionChange}
              placeholder="0.00"
              min="0"
              step="0.01"
              suffix="₪"
              required
            />
          )}

          {hasItems && (
            <div className="transaction-items" aria-label="פריטי התנועה">
              <div className="transaction-items__head" aria-hidden="true">
                <span>שם הפריט</span>
                <span>כמות</span>
                <span>מחיר יחידה</span>
                <span>הנחה</span>
                <span>סה״כ</span>
                <span />
              </div>
              {items.map((item, index) => (
                <ItemCard
                  key={index}
                  item={item}
                  index={index}
                  onItemChange={handleItemChange}
                  onRemove={removeItem}
                />
              ))}
            </div>
          )}

          <Button type="button" className="transaction-add-item" onClick={addItem}>
            <Plus size={18} aria-hidden="true" />
            הוספת פריט
          </Button>

          {(hasItems || Number(transaction.global_discount) !== 0) && (
            <TransactionTotals
              items={items}
              globalDiscount={transaction.global_discount}
              total={transaction.total_amount}
              onDiscountChange={handleTransactionChange}
            />
          )}
        </TransactionFormSection>

        <div className="transaction-form-split">
          <TransactionFormSection step="3" title="תשלומים" className="transaction-form-section--secondary">
            {!isEditMode ? (
              <div className="transaction-installments-layout">
                <NumberField
                  className="transaction-installment-count"
                  name="installment_count"
                  label="מספר תשלומים"
                  value={transaction.installment_count}
                  onChange={handleTransactionChange}
                  min="1"
                  step="1"
                />
                <p className="transaction-form-calculation">
                  <Info size={17} aria-hidden="true" />
                  <span>
                    {perInstallment === null
                      ? 'תנועה בתשלום אחד.'
                      : <>ייווצרו {installmentCount - 1} תנועות עתידיות נוספות, בסכום של כ־<MoneyAmount value={perInstallment} /> לכל תשלום.</>}
                  </span>
                </p>
              </div>
            ) : (
              <TextField
                name="installments_info"
                label="תיאור תשלומים"
                value={transaction.installments_info}
                onChange={handleTransactionChange}
                placeholder="למשל: 3/12 תשלומים"
                technicalLtr
              />
            )}
          </TransactionFormSection>

          <TransactionFormSection step="4" title="מטבע חוץ" className="transaction-form-section--secondary">
            <div className="transaction-currency-row">
              <Select
                className="transaction-currency-select"
                name="currency"
                label="מטבע"
                value={transaction.currency}
                onChange={handleTransactionChange}
                technicalLtr
              >
                <option value="ILS">ILS — שקל</option>
                <option value="USD">USD — דולר</option>
                <option value="EUR">EUR — אירו</option>
                <option value="GBP">GBP — ליש״ט</option>
              </Select>
            </div>
            {transaction.currency !== 'ILS' && (
              <div className="transaction-form-grid transaction-form-grid--two transaction-form-grid--nested">
                <NumberField
                  name="original_amount"
                  label={`סכום מקורי (${transaction.currency})`}
                  value={transaction.original_amount}
                  onChange={handleTransactionChange}
                  step="0.01"
                />
                <NumberField
                  name="exchange_rate"
                  label="שער המרה"
                  value={transaction.exchange_rate}
                  onChange={handleTransactionChange}
                  step="0.0001"
                />
              </div>
            )}
            {transaction.currency === 'ILS' && (
              <p className="transaction-currency-hint">כשהמטבע הוא שקל, השדות האלה מוסתרים.</p>
            )}
          </TransactionFormSection>
        </div>

        {hasContextFields && (
          <TransactionFormSection
            step="5"
            title="שדות לפי הקשר"
            description="השדות האלה נפתחים לפי הקטגוריה שנבחרה — הלוואה לקטגוריות החזר, ושדות לגו לקטגוריית לגו."
          >
            {loanCategorySelected && (
              <div className="transaction-context-block">
                <Select
                  name="loan_id"
                  label="שיוך להלוואה"
                  value={transaction.loan_id}
                  onChange={handleTransactionChange}
                  placeholder="בחירת הלוואה"
                  helperText="השיוך מסמן את התנועה כהחזר על ההלוואה, ואינו משנה את יתרת ההלוואה אוטומטית."
                  required
                >
                  {loans.map((loan) => (
                    <option key={loan.id} value={loan.id}>
                      {loan.name} — {loan.lender_name} (₪{Number(loan.current_balance).toLocaleString('en-US')})
                    </option>
                  ))}
                </Select>
              </div>
            )}

            {legoCategorySelected && (
              <div className="transaction-context-block">
                {isEditMode && (
                  <Alert variant="info">
                    עריכת התנועה אינה מסנכרנת רשומות אוסף LEGO שכבר נוצרו.
                  </Alert>
                )}
                {hasItems ? (
                  <div className="transaction-context-items">
                    {items.map((item, index) => (
                      <LegoItemFields
                        key={index}
                        item={item}
                        index={index}
                        legoThemes={legoThemes}
                        onItemChange={handleItemChange}
                        onSetNumberBlur={handleSetNumberBlur}
                      />
                    ))}
                  </div>
                ) : (
                  <Alert variant="info">הוסיפו פריט בשלב 2 כדי להזין מספר סט, נושא ומותג.</Alert>
                )}
              </div>
            )}
          </TransactionFormSection>
        )}

        <div className="transaction-form-actions">
          <div className="transaction-form-actions__total">
            <span>סכום לשמירה</span>
            <MoneyAmount value={transaction.total_amount} />
          </div>
          <div className="transaction-form-actions__submit">
            <Link className="transaction-form-cancel" to="/transactions">ביטול</Link>
            <Button
              type="submit"
              size="lg"
              loading={submitting}
              loadingText={isEditMode ? 'מעדכן תנועה…' : 'שומר תנועה…'}
            >
              <Save size={19} aria-hidden="true" />
              {isEditMode ? 'עדכן תנועה' : 'שמור תנועה'}
            </Button>
          </div>
        </div>
      </form>

      <NewCategoryModal
        show={showNewCategoryModal}
        newCategoryName={newCategoryName}
        setNewCategoryName={setNewCategoryName}
        onSave={handleSaveNewCategory}
        onClose={() => setShowNewCategoryModal(false)}
      />
    </div>
  );
};

export default AddTransaction;
