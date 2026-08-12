import { Link } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  Edit3,
  Inbox,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  Tags,
  Trash2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  Alert,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  GlassCard,
  MoneyAmount,
  PrimaryButton,
  SecondaryButton,
  Select,
  Skeleton,
  TechnicalValue,
} from '../../components/ui';

const formatDate = (value) => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value || '—';
  return `${Number(match[3])}.${Number(match[2])}.${match[1]}`;
};

const signedAmount = (transaction) => {
  const raw = String(transaction.total_amount ?? '0').trim().replace(/^[+-]/, '') || '0';
  return transaction.movement_type === 'income' ? raw : `-${raw}`;
};

const transactionContext = (transaction) => transaction.description || `מספר ${transaction.id}`;

const CategoryBadge = ({ transaction }) => {
  const isUncategorized = transaction.category_id == null;
  return (
    <span className={`transactions-category${isUncategorized ? ' is-uncategorized' : ''}`}>
      <span aria-hidden="true">{isUncategorized ? <Tags size={14} /> : transaction.categories?.icon}</span>
      {isUncategorized ? 'ללא קטגוריה' : (transaction.categories?.name || 'קטגוריה לא זמינה')}
    </span>
  );
};

const TransactionActions = ({ transaction, onRequestDelete, mobile = false }) => (
  <div className={`transactions-actions${mobile ? ' transactions-actions--mobile' : ''}`}>
    <Link
      to={`/edit-transaction/${transaction.id}`}
      className="transactions-action transactions-action--edit"
      aria-label={`עריכת התנועה ${transactionContext(transaction)}`}
      title="עריכה"
    >
      <Edit3 size={16} aria-hidden="true" />
      {mobile && <span>עריכה</span>}
    </Link>
    <button
      type="button"
      className="transactions-action transactions-action--delete"
      onClick={() => onRequestDelete(transaction)}
      aria-label={`מחיקת התנועה ${transactionContext(transaction)}`}
      title="מחיקה"
    >
      <Trash2 size={16} aria-hidden="true" />
      {mobile && <span>מחיקה</span>}
    </button>
  </div>
);

export const TransactionsSummary = ({ totals, loading = false }) => {
  if (loading) {
    return (
      <section className="transactions-summary" aria-label="טוען סיכום לתוצאות המסוננות" aria-busy="true">
        {Array.from({ length: 4 }, (_, index) => (
          <GlassCard key={index} padding="15px 16px" className="transactions-summary-card">
            <Skeleton width="45%" height={12} />
            <Skeleton width="72%" height={26} />
          </GlassCard>
        ))}
      </section>
    );
  }

  const balance = (
    Math.round(Number(totals.income) * 100)
    - Math.round(Number(totals.expense) * 100)
  ) / 100;

  const items = [
    { key: 'count', label: 'תנועות', value: <TechnicalValue>{Number(totals.count).toLocaleString('en-US')}</TechnicalValue> },
    { key: 'income', label: 'הכנסות', value: <MoneyAmount value={totals.income} />, tone: 'income' },
    { key: 'expense', label: 'הוצאות', value: <MoneyAmount value={totals.expense} />, tone: 'expense' },
    { key: 'balance', label: 'מאזן', value: <MoneyAmount value={balance} signed />, tone: balance >= 0 ? 'income' : 'expense' },
  ];

  return (
    <section className="transactions-summary" aria-label="סיכום מלא של התוצאות המסוננות">
      {items.map((item) => {
        return (
          <GlassCard key={item.key} padding="15px 16px" className={`transactions-summary-card${item.tone ? ` is-${item.tone}` : ''}`}>
            <div className="transactions-summary-card__label">{item.label}</div>
            <strong>{item.value}</strong>
          </GlassCard>
        );
      })}
    </section>
  );
};

export const SortableHeader = ({ label, sortKey, sortConfig, onSort, className = '' }) => {
  const isActive = sortConfig.key === sortKey;
  const Icon = !isActive ? ArrowUpDown : sortConfig.direction === 'asc' ? ArrowUp : ArrowDown;
  const ariaSort = isActive ? (sortConfig.direction === 'asc' ? 'ascending' : 'descending') : 'none';
  const nextDirection = isActive && sortConfig.direction === 'asc' ? 'יורד' : 'עולה';

  return (
    <th scope="col" aria-sort={ariaSort} className={className}>
      <button type="button" onClick={() => onSort(sortKey)} aria-label={`מיון לפי ${label}, ${nextDirection}`}>
        {label}
        <Icon size={14} aria-hidden="true" />
      </button>
    </th>
  );
};

export const TransactionsTable = ({ rows, sortConfig, onSort, onRequestDelete }) => (
  <div className="transactions-table-region" role="region" aria-label="טבלת תנועות מסוננות" tabIndex="0">
    <table className="transactions-table">
      <caption>תנועות שנטענו מתוך התוצאות המסוננות</caption>
      <colgroup>
        <col className="transactions-table__col-date" />
        <col className="transactions-table__col-category" />
        <col className="transactions-table__col-description" />
        <col className="transactions-table__col-source" />
        <col className="transactions-table__col-amount" />
        <col className="transactions-table__col-notes" />
        <col className="transactions-table__col-actions" />
      </colgroup>
      <thead>
        <tr>
          <SortableHeader label="תאריך" sortKey="transaction_date" sortConfig={sortConfig} onSort={onSort} />
          <th scope="col">קטגוריה</th>
          <SortableHeader label="תיאור" sortKey="description" sortConfig={sortConfig} onSort={onSort} />
          <th scope="col">אמצעי תשלום</th>
          <SortableHeader label="סכום" sortKey="total_amount" sortConfig={sortConfig} onSort={onSort} className="transactions-table__amount-heading" />
          <th scope="col" className="transactions-table__notes-heading">הערות</th>
          <th scope="col" className="transactions-table__actions-heading">פעולות</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((transaction) => {
          const isUncategorized = transaction.category_id == null;
          const isIncome = transaction.movement_type === 'income';
          return (
            <tr key={transaction.id} className={isUncategorized ? 'is-uncategorized' : ''}>
              <td className="transactions-table__date"><TechnicalValue>{formatDate(transaction.transaction_date)}</TechnicalValue></td>
              <td className="transactions-table__category"><CategoryBadge transaction={transaction} /></td>
              <td className="transactions-table__description"><strong>{transaction.description || 'ללא תיאור'}</strong></td>
              <td className="transactions-table__source">
                <span className="transactions-table__source-value">
                  {transaction.payment_sources?.name || <span aria-label="לא צוין">—</span>}
                </span>
              </td>
              <td className={`transactions-table__amount ${isIncome ? 'is-income' : 'is-expense'}`} dir="ltr">
                <span className="transactions-table__amount-content">
                  <span className="transactions-amount-kind">{isIncome ? <TrendingUp size={14} /> : <TrendingDown size={14} />}<span className="transactions-visually-hidden">{isIncome ? 'הכנסה' : 'הוצאה'}</span></span>
                  <MoneyAmount value={signedAmount(transaction)} signed />
                </span>
              </td>
              <td className="transactions-table__notes">
                {transaction.notes ? <span title={transaction.notes}>{transaction.notes}</span> : <span className="transactions-quiet-value" aria-label="אין הערות">—</span>}
              </td>
              <td className="transactions-table__actions-cell"><TransactionActions transaction={transaction} onRequestDelete={onRequestDelete} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

export const TransactionsMobileSortControl = ({ sortConfig, onSort }) => {
  const sortValue = `${sortConfig.key}:${sortConfig.direction}`;
  const onSortValueChange = (value) => {
    const [key, direction] = value.split(':');
    onSort(key, direction);
  };

  return (
    <div className="transactions-mobile-sort-bar">
      <span>סדר התוצאות המלאות</span>
      <Select
        id="transactions-mobile-sort"
        label="מיון הרשימה"
        value={sortValue}
        onValueChange={onSortValueChange}
        size="compact"
        fullWidth={false}
        className="transactions-mobile-sort"
      >
        <option value="transaction_date:desc">תאריך — חדש לישן</option>
        <option value="transaction_date:asc">תאריך — ישן לחדש</option>
        <option value="description:asc">תיאור — עולה</option>
        <option value="description:desc">תיאור — יורד</option>
        <option value="total_amount:asc">סכום — עולה</option>
        <option value="total_amount:desc">סכום — יורד</option>
      </Select>
    </div>
  );
};

export const TransactionsMobileList = ({ rows, onRequestDelete }) => (
    <section className="transactions-mobile-list" aria-labelledby="transactions-mobile-list-heading">
      <h2 id="transactions-mobile-list-heading">התנועות שנטענו</h2>
      <ul>
        {rows.map((transaction) => {
          const isUncategorized = transaction.category_id == null;
          const isIncome = transaction.movement_type === 'income';
          return (
            <li key={transaction.id} className={isUncategorized ? 'is-uncategorized' : ''}>
              <article aria-label={`תנועה: ${transactionContext(transaction)}`}>
                <div className="transactions-mobile-card__top">
                  <CategoryBadge transaction={transaction} />
                  <div className={`transactions-mobile-card__amount ${isIncome ? 'is-income' : 'is-expense'}`}>
                    <span>{isIncome ? <TrendingUp size={15} /> : <TrendingDown size={15} />}{isIncome ? 'הכנסה' : 'הוצאה'}</span>
                    <MoneyAmount value={signedAmount(transaction)} signed />
                  </div>
                </div>
                <h3>{transaction.description || 'ללא תיאור'}</h3>
                <dl className="transactions-mobile-card__metadata">
                  <div><dt>תאריך</dt><dd><TechnicalValue>{formatDate(transaction.transaction_date)}</TechnicalValue></dd></div>
                  <div><dt>אמצעי תשלום</dt><dd>{transaction.payment_sources?.name || 'לא צוין'}</dd></div>
                </dl>
                {transaction.notes && (
                  <div className="transactions-mobile-card__notes">
                    <MessageSquareText size={15} aria-hidden="true" />
                    <span><strong>הערה:</strong> {transaction.notes}</span>
                  </div>
                )}
                <TransactionActions transaction={transaction} onRequestDelete={onRequestDelete} mobile />
              </article>
            </li>
          );
        })}
      </ul>
    </section>
);

export const TransactionsListSkeleton = () => (
  <section className="transactions-list-skeleton" role="status" aria-live="polite" aria-label="טוען תנועות">
    <span className="transactions-visually-hidden">טוען תנועות…</span>
    {Array.from({ length: 7 }, (_, index) => <Skeleton key={index} height={54} borderRadius="var(--ft-radius-md)" />)}
  </section>
);

export const TransactionsEmptyState = ({ datasetEmpty, onReset }) => (
  <EmptyState
    className="transactions-state-card"
    variant={datasetEmpty ? 'dataset' : 'filtered'}
    icon={datasetEmpty ? Inbox : Tags}
    title={datasetEmpty ? 'אין תנועות במערכת' : 'אין תנועות שמתאימות למסננים'}
    description={datasetEmpty
      ? 'לא נמצאו תנועות בכל ההיסטוריה. אפשר להוסיף את התנועה הראשונה.'
      : 'יש לנסות טווח תאריכים אחר, לשנות מסנן או לחזור לברירת המחדל.'}
    primaryAction={datasetEmpty
      ? <Link className="transactions-state-primary-link" to="/add">תנועה חדשה</Link>
      : <PrimaryButton type="button" onClick={onReset}>איפוס מסננים</PrimaryButton>}
  />
);

export const TransactionsInitialError = ({ onRetry, retrying }) => (
  <ErrorState
    className="transactions-state-card"
    level="page"
    title="טעינת התנועות נכשלה"
    description="לא נטענו רשומות או נתוני סיכום. המסננים שבחרת נשמרו ואפשר לנסות שוב."
    onRetry={onRetry}
    retrying={retrying}
    retryLabel="נסה שוב"
    urgent
  />
);

export const ProgressiveLoadFooter = ({ loadedCount, totalCount, hasMore, loadingMore, error, onLoadMore }) => (
  <footer className={`transactions-progressive-footer${error ? ' is-error' : ''}`}>
    <span className="transactions-progressive-footer__count">
      מוצגות <TechnicalValue>{loadedCount.toLocaleString('en-US')}</TechnicalValue> מתוך <TechnicalValue>{Number(totalCount).toLocaleString('en-US')}</TechnicalValue> תנועות
    </span>
    {loadingMore && (
      <span className="transactions-progressive-footer__status" role="status" aria-live="polite">
        <LoaderCircle className="transactions-spinner" size={17} aria-hidden="true" />
        טוען תנועות נוספות…
      </span>
    )}
    {!loadingMore && error && (
      <Alert
        className="transactions-progressive-footer__error"
        variant="warning"
        announce
        title="טעינת המשך הרשימה נכשלה"
        action={(
          <SecondaryButton type="button" size="sm" onClick={onLoadMore}>
            <RefreshCw size={14} aria-hidden="true" />
            נסה שוב
          </SecondaryButton>
        )}
      >
        הרשומות שכבר נטענו נשארו במקומן.
      </Alert>
    )}
    {!loadingMore && !error && hasMore && (
      <PrimaryButton type="button" size="sm" onClick={onLoadMore}>טען תנועות נוספות</PrimaryButton>
    )}
    {!loadingMore && !error && !hasMore && (
      <span className="transactions-progressive-footer__end" role="status">
        <Check size={16} aria-hidden="true" />
        הגעת לסוף ההיסטוריה
      </span>
    )}
  </footer>
);

export const TransactionDeleteDialog = ({ transaction, onClose, onConfirm }) => (
  <ConfirmDialog
    open={Boolean(transaction)}
    onClose={onClose}
    onConfirm={onConfirm}
    title="מחיקת תנועה"
    message={transaction ? (
      <p>
        למחוק את התנועה <strong>„{transactionContext(transaction)}”</strong>? לא ניתן לבטל את הפעולה.
      </p>
    ) : null}
    confirmLabel="מחיקת התנועה"
    cancelLabel="ביטול"
    variant="destructive"
    errorMessage="מחיקת התנועה נכשלה. הרשומה והסיכומים לא השתנו."
  />
);

export const TransactionsLoadedContent = ({ rows, totals, sortConfig, onSort, onRequestDelete, ...footerProps }) => (
  <section className="transactions-results" aria-label="תוצאות התנועות">
    <TransactionsTable rows={rows} sortConfig={sortConfig} onSort={onSort} onRequestDelete={onRequestDelete} />
    <TransactionsMobileList rows={rows} onRequestDelete={onRequestDelete} />
    <ProgressiveLoadFooter loadedCount={rows.length} totalCount={totals.count} {...footerProps} />
  </section>
);

export default TransactionsLoadedContent;
