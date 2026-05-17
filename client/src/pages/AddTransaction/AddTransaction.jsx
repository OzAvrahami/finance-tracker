import React from 'react';
import { Link } from 'react-router-dom';
import { FileUp } from 'lucide-react';
import useTransactionForm from '../../hooks/useTransactionForm';
import CategoryCombobox from '../../components/CategoryCombobox';
import NewCategoryModal from '../../components/NewCategoryModal';
import ItemCard from '../../components/ItemCard';
import { sectionStyle, rowStyle, inputGroupStyle, labelStyle, inputStyle, addBtnStyle, footerStyle, submitBtnStyle } from '../../components/transactions/AddTransaction.styles';

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
    removeItem,
    handleSaveNewCategory,
    handleSubmit,
    handleSetNumberBlur,
  } = useTransactionForm();

  if (loading) return <div style={{textAlign: 'center', marginTop: '50px'}}>טוען נתונים...</div>;

  return (
  <div style={{ maxWidth: '800px', margin: '40px auto', padding: '30px', backgroundColor: 'var(--surface-2)', borderRadius: '15px', boxShadow: 'var(--shadow-md)', border: '1px solid var(--border)', color: 'var(--ink-2)' }} dir="rtl">

      {/* --- Header Area --- */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '30px',
        borderBottom: '1px solid var(--border)',
        paddingBottom: '20px'
      }}>
          <h1 style={{ margin: 0, color: 'var(--ink-1)', fontSize: '1.8rem' }}>
              {isEditMode ? 'עריכת תנועה ✏️' : 'הוספת תנועה חדשה 💰'}
          </h1>

          {!isEditMode && (
            <Link to="/import" style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              backgroundColor: 'var(--primary-soft)',
              color: 'var(--primary-hi)',
              padding: '10px 18px',
              borderRadius: '30px',
              textDecoration: 'none',
              fontWeight: '600',
              fontSize: '0.95rem',
              transition: 'all 0.2s ease',
              border: '1px solid rgba(124,92,255,0.25)'
            }}>
              <FileUp size={18} />
              <span>ייבוא מאקסל?</span>
            </Link>
          )}
      </div>

      <form onSubmit={handleSubmit}>

        {/* --- Transaction Details --- */}
        <div style={sectionStyle}>
            <div style={rowStyle}>
                <div style={inputGroupStyle}>
                    <label style={labelStyle}>תאריך</label>
                    <input type="date" name="transaction_date" value={transaction.transaction_date} onChange={handleTransactionChange} style={inputStyle} required />
                </div>

                <div style={inputGroupStyle}>
                    <label style={labelStyle}>סוג תנועה</label>
                    <select name="movement_type" value={transaction.movement_type} onChange={handleTransactionChange} style={inputStyle}>
                        <option value="expense">הוצאה 💸</option>
                        <option value="income">הכנסה 💰</option>
                    </select>
                </div>
            </div>

            <div style={inputGroupStyle}>
                <label style={labelStyle}>תיאור כללי</label>
                <input type="text" name="description" value={transaction.description} onChange={handleTransactionChange} placeholder="למשל: קניות בסופר, דלק, משכורת..." style={inputStyle} required />
            </div>

            <div style={rowStyle}>
              <div style={inputGroupStyle}>
                <label style={labelStyle}>קטגוריה</label>
                <CategoryCombobox
                  categories={categories}
                  selectedCategoryId={transaction.category_id}
                  onSelect={(catId) => setTransaction(prev => ({ ...prev, category_id: catId }))}
                  onOpenNewModal={() => setShowNewCategoryModal(true)}
                />
              </div>

                <div style={inputGroupStyle}>
                    <label style={labelStyle}>אמצעי תשלום</label>
                    <select name="payment_source_id" value={transaction.payment_source_id} onChange={handleTransactionChange} style={inputStyle}>
                        <option value="">בחר אמצעי תשלום</option>
                        {paymentSources.map(ps => (
                          <option key={ps.id} value={ps.id}>
                            {ps.name}{ps.last4 ? ` (${ps.last4})` : ''}
                          </option>
                        ))}
                    </select>
                </div>
            </div>

            {isLoanCategory() && (
                <div style={inputGroupStyle}>
                    <label style={labelStyle}>בחר הלוואה 🏦</label>
                    <select
                      name="loan_id"
                      value={transaction.loan_id}
                      onChange={handleTransactionChange}
                      style={inputStyle}
                      required
                    >
                      <option value="">בחר הלוואה</option>
                      {loans.map((loan) => (
                        <option key={loan.id} value={loan.id}>
                          {loan.name} - {loan.lender_name} (₪{Number(loan.current_balance).toLocaleString()})
                        </option>
                      ))}
                    </select>
                </div>
            )}

            <div style={inputGroupStyle}>
                <label style={labelStyle}>סכום העסקה (₪)</label>
                <input
                    type="number"
                    name="total_amount"
                    value={transaction.total_amount}
                    onChange={handleTransactionChange}
                    placeholder="הזן סכום"
                    style={inputStyle}
                    min="0"
                    step="0.01"
                    required
                />
            </div>

            {/* תאריך חיוב + תשלומים */}
            <div style={rowStyle}>
                <div style={inputGroupStyle}>
                    <label style={labelStyle}>תאריך חיוב</label>
                    <input type="date" name="charge_date" value={transaction.charge_date} onChange={handleTransactionChange} style={inputStyle} />
                </div>
                {!isEditMode ? (
                    <div style={inputGroupStyle}>
                        <label style={labelStyle}>מספר תשלומים</label>
                        <input
                            type="number"
                            name="installment_count"
                            value={transaction.installment_count}
                            onChange={handleTransactionChange}
                            min="1"
                            style={inputStyle}
                        />
                        {transaction.installment_count > 1 && transaction.total_amount > 0 && (
                            <div className="num" style={{ fontSize: '12px', color: 'var(--ink-4)', marginTop: '4px' }}>
                                ₪{Math.round(transaction.total_amount / transaction.installment_count * 100) / 100} לתשלום
                            </div>
                        )}
                    </div>
                ) : (
                    <div style={inputGroupStyle}>
                        <label style={labelStyle}>תשלומים</label>
                        <input type="text" name="installments_info" value={transaction.installments_info} onChange={handleTransactionChange} placeholder="למשל: 3/12 תשלומים" style={inputStyle} />
                    </div>
                )}
            </div>

            {/* מטבע חוץ */}
            <div style={rowStyle}>
                <div style={inputGroupStyle}>
                    <label style={labelStyle}>מטבע</label>
                    <select name="currency" value={transaction.currency} onChange={handleTransactionChange} style={inputStyle}>
                        <option value="ILS">ILS - שקל</option>
                        <option value="USD">USD - דולר</option>
                        <option value="EUR">EUR - יורו</option>
                        <option value="GBP">GBP - ליש"ט</option>
                    </select>
                </div>
                {transaction.currency !== 'ILS' && (
                    <>
                        <div style={inputGroupStyle}>
                            <label style={labelStyle}>סכום מקורי ({transaction.currency})</label>
                            <input type="number" name="original_amount" value={transaction.original_amount} onChange={handleTransactionChange} placeholder="סכום במטבע מקור" style={inputStyle} step="0.01" />
                        </div>
                        <div style={inputGroupStyle}>
                            <label style={labelStyle}>שער המרה</label>
                            <input type="number" name="exchange_rate" value={transaction.exchange_rate} onChange={handleTransactionChange} placeholder="שער" style={inputStyle} step="0.0001" />
                        </div>
                    </>
                )}
            </div>

            {/* שדה הערות */}
            <div style={rowStyle}>
              <div style={inputGroupStyle}>
                <label style={labelStyle}>הערות</label>
                <input type="text" name='notes' value={transaction.notes} onChange={handleTransactionChange} placeholder="הוסף הערה" style={inputStyle} />
              </div>
            </div>
        </div>

        <hr style={{ margin: '30px 0', border: 'none', borderTop: '1px solid var(--border)' }} />

        {/* --- Items Section --- */}
        <h3 style={{ color: 'var(--ink-2)', marginBottom: '15px' }}>פירוט פריטים 🛒</h3>

        {items.map((item, index) => (
          <ItemCard
            key={index}
            item={item}
            index={index}
            isLego={isLegoCategory()}
            legoThemes={legoThemes}
            onItemChange={handleItemChange}
            onRemove={removeItem}
            onSetNumberBlur={handleSetNumberBlur}
          />
        ))}

        <button type="button" onClick={addItem} style={addBtnStyle}>+ הוסף פריט נוסף</button>

        <hr style={{ margin: '30px 0', border: 'none', borderTop: '1px solid var(--border)' }} />

        {/* --- Footer --- */}
        <div style={footerStyle}>
            <div style={{ flex: 1 }}>
                 <label style={labelStyle}>הנחה כללית (₪)</label>
                 <input type="number" name="global_discount" value={transaction.global_discount} onChange={handleTransactionChange} style={{ ...inputStyle, width: '150px' }} />
            </div>

            <div style={{ textAlign: 'left' }}>
                <h2 style={{ margin: 0, color: 'var(--ink-1)' }}>סה"כ: <span className="num">₪{transaction.total_amount.toLocaleString()}</span></h2>
                <button type="submit" style={submitBtnStyle}>
                    {isEditMode ? 'עדכן תנועה' : 'שמור תנועה'}
                </button>
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
