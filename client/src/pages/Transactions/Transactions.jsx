import React, { useState, useEffect, useRef, useMemo, useContext } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, Edit, Trash2, Calendar, PlusCircle, ArrowUp, ArrowDown, ArrowUpDown,
} from 'lucide-react';
import { getTransactions, deleteTransaction, getCategories, getPaymentSources } from '../../services/api';
import { PageHeaderContext } from '../../context/PageHeaderContext';
import { getMonthRange, getRelativeMonthRange, getYearRange } from '../../utils/dateRange';

// One server page. The backend clamps anything above its own maximum (250).
const PAGE_SIZE = 100;

const EMPTY_TOTALS = { count: 0, income: 0, expense: 0 };

const EMPTY_LIST = {
  rows: [],
  totals: EMPTY_TOTALS,
  cursor: null,
  hasMore: false,
  error: null,
  loading: true,
};

/**
 * A clickable column header.
 *
 * The old implementation showed the same static up/down glyph on every sortable
 * column, so the header never told you what the table was actually sorted by.
 * The arrow now reflects the active column and direction, and `aria-sort`
 * exposes the same thing to assistive tech.
 */
const SortableHeader = ({ label, sortKey, sortConfig, onSort }) => {
  const isActive = sortConfig.key === sortKey;
  const Icon = !isActive ? ArrowUpDown : sortConfig.direction === 'asc' ? ArrowUp : ArrowDown;

  return (
    <th
      style={sortableThStyle}
      onClick={() => onSort(sortKey)}
      aria-sort={isActive ? (sortConfig.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      title={`מיין לפי ${label}`}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        {label}
        <Icon size={13} style={{ opacity: isActive ? 1 : 0.45 }} aria-hidden="true" />
      </span>
    </th>
  );
};

const Transactions = () => {
  // --- State ניהול נתונים ---
  // A single object so a filter change can reset rows, totals, cursor and
  // error atomically — a partial reset would let the summary bar describe one
  // filter while the table shows another.
  // `rows` holds only the pages loaded so far, never the whole table.
  const [list, setList] = useState(EMPTY_LIST);
  const [categories, setCategories] = useState([]);
  const [paymentSources, setPaymentSources] = useState([]);

  // "Load more" is tracked separately from the first page: it appends rather
  // than replaces, and it can fail without invalidating the rows on screen.
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(null);

  // --- State מיון ---
  // Sent to the server; the database orders the whole filtered set, not the
  // rows that happen to be loaded. Defaults match the previous behaviour.
  const [sortConfig, setSortConfig] = useState({ key: 'transaction_date', direction: 'desc' });

  // --- State פילטרים ---
  const [searchText, setSearchText] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedPaymentSources, setSelectedPaymentSources] = useState('all');
  // Default view is the current month — unchanged from the previous behaviour.
  const [dateRange, setDateRange] = useState(() => getMonthRange());
  const [debouncedSearchText, setDebouncedSearchText] = useState('');
  const [showUncategorizedOnly, setShowUncategorizedOnly] = useState(false);

  const { setPageHeader } = useContext(PageHeaderContext);

  // Monotonic request id. Every response checks that it is still the newest
  // request before touching state, so a slow reply for an old filter can never
  // overwrite the rows of a newer one.
  const requestIdRef = useRef(0);

  useEffect(() => {
    setPageHeader({
      title: 'תנועות',
      subtitles: 'כל ההכנסות וההוצאות שלך',
    });
  }, [setPageHeader]);

  // --- Debounce: only the free-text search. Dropdown and date changes apply
  // immediately, because they are discrete choices rather than typing. ---
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchText(searchText);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  // Lookup tables for the filter dropdowns. Loaded once — they are small and
  // independent of the transaction filters.
  useEffect(() => {
    let cancelled = false;
    Promise.all([getCategories(), getPaymentSources()])
      .then(([catsRes, psRes]) => {
        if (cancelled) return;
        setCategories(catsRes.data);
        setPaymentSources(psRes.data);
      })
      .catch((error) => {
        console.error('Error loading filter options:', error);
      });
    return () => { cancelled = true; };
  }, []);

  // The filter set sent to the server. Memoised so it is a stable effect
  // dependency, and serialised so a change can be detected during render.
  // Sort is part of this set on purpose: changing it changes which rows the
  // first page contains, so it must reset the loaded pages and the cursor
  // exactly like a filter change does. A cursor issued for one sort is also
  // rejected by the server, so reusing one is not merely wrong, it is refused.
  const filters = useMemo(() => ({
    from: dateRange.start || undefined,
    to: dateRange.end || undefined,
    categoryId: selectedCategory,
    paymentSourceId: selectedPaymentSources,
    uncategorizedOnly: showUncategorizedOnly,
    search: debouncedSearchText,
    sortBy: sortConfig.key,
    sortDirection: sortConfig.direction,
  }), [dateRange.start, dateRange.end, selectedCategory, selectedPaymentSources, showUncategorizedOnly, debouncedSearchText, sortConfig.key, sortConfig.direction]);

  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);
  const [loadedFilterKey, setLoadedFilterKey] = useState(filterKey);

  // Reset during render rather than in an effect. This is React's documented
  // way to adjust state when an input changes, and it matters here: an effect
  // would run only after a commit, so the table would paint one frame of the
  // previous filter's rows alongside the new filter's controls.
  if (loadedFilterKey !== filterKey) {
    setLoadedFilterKey(filterKey);
    setList(EMPTY_LIST);
    setMoreError(null);
  }

  // --- Load the first page whenever any filter changes ---
  useEffect(() => {
    const requestId = ++requestIdRef.current;

    getTransactions({
      ...filters,
      limit: PAGE_SIZE,
      includeTotals: true,
    })
      .then((res) => {
        if (requestId !== requestIdRef.current) return;
        const { data, pagination, totals } = res.data;
        setList({
          rows: data,
          totals: totals || EMPTY_TOTALS,
          cursor: pagination.nextCursor,
          hasMore: pagination.hasMore,
          error: null,
          loading: false,
        });
      })
      .catch((error) => {
        if (requestId !== requestIdRef.current) return;
        console.error('Error loading transactions:', error);
        setList({ ...EMPTY_LIST, error: 'שגיאה בטעינת התנועות', loading: false });
      })
      .finally(() => {
        if (requestId !== requestIdRef.current) return;
        setInitialLoading(false);
      });
  }, [filters]);

  // --- Load the next page and append ---
  const handleLoadMore = () => {
    if (!list.cursor || loadingMore) return;

    const requestId = requestIdRef.current;
    setLoadingMore(true);
    setMoreError(null);

    getTransactions({
      ...filters,
      limit: PAGE_SIZE,
      cursor: list.cursor,
    })
      .then((res) => {
        // A filter changed while this page was in flight — discard it.
        if (requestId !== requestIdRef.current) return;
        const { data, pagination } = res.data;

        setList((prev) => {
          // Defensive de-duplication. The keyset cursor should never return a
          // row twice, but appending blindly would corrupt the list if it did.
          const seen = new Set(prev.rows.map((t) => t.id));
          return {
            ...prev,
            rows: [...prev.rows, ...data.filter((t) => !seen.has(t.id))],
            cursor: pagination.nextCursor,
            hasMore: pagination.hasMore,
          };
        });
      })
      .catch((error) => {
        if (requestId !== requestIdRef.current) return;
        console.error('Error loading more transactions:', error);
        setMoreError('שגיאה בטעינת תנועות נוספות');
      })
      .finally(() => {
        if (requestId !== requestIdRef.current) return;
        setLoadingMore(false);
      });
  };

  // --- פונקציות עזר ---
  // Toggle rule preserved from the original implementation: a newly chosen
  // column starts ascending, and only a column that is already ascending flips
  // to descending. There is no third "unsorted" state.
  const handleSort = (key) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const setPresetDate = (type) => {
    if (type === 'thisMonth') {
      setDateRange(getMonthRange());
    } else if (type === 'lastMonth') {
      setDateRange(getRelativeMonthRange(-1));
    } else if (type === 'thisYear') {
      setDateRange(getYearRange());
    } else {
      // 'clear' — no date bounds, so the cursor can walk the entire history.
      setDateRange({ start: '', end: '' });
    }
  };

  const handleDelete = async (transaction) => {
    if (!window.confirm('האם אתה בטוח שברצונך למחוק תנועה זו?')) return;
    try {
      await deleteTransaction(transaction.id);
      // Adjust the server-computed totals by the exact amount removed, so the
      // summary bar stays consistent without refetching every loaded page.
      setList((prev) => {
        const amount = Number(transaction.total_amount) || 0;
        return {
          ...prev,
          rows: prev.rows.filter((t) => t.id !== transaction.id),
          totals: {
            count: Math.max(prev.totals.count - 1, 0),
            income: transaction.movement_type === 'income' ? prev.totals.income - amount : prev.totals.income,
            expense: transaction.movement_type === 'expense' ? prev.totals.expense - amount : prev.totals.expense,
          },
        };
      });
    } catch (error) {
      console.error('Error deleting transaction:', error);
      alert('שגיאה במחיקה');
    }
  };

  if (initialLoading) return <div style={{ textAlign: 'center', marginTop: 50, color: 'var(--ink-3)' }}>טוען נתונים...</div>;

  const { rows, totals } = list;
  const balance = totals.income - totals.expense;

  return (
    <div dir="rtl" style={{ color: 'var(--ink-2)' }}>

      {/* --- כותרת ראשית --- */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--s-24)' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 'var(--fs-20)', fontWeight: 700, color: 'var(--ink-1)', letterSpacing: '-0.015em' }}>הליבה הפיננסית 📊</h1>
          <p style={{ margin: '4px 0 0 0', color: 'var(--ink-4)', fontSize: 'var(--fs-14)' }}>ניהול וחקירת תנועות עומק</p>
        </div>
        <Link to="/add" style={primaryBtnStyle}>
          <PlusCircle size={18} />
          הוסף תנועה
        </Link>
      </div>

      {/* --- סרגל כלים ופילטרים --- */}
      <div style={filterContainerStyle}>

        {/* חיפוש חופשי */}
        <div style={searchBoxStyle}>
          {/* #5A607A = --ink-4; Lucide color prop does not accept CSS variables */}
          <Search size={18} color="#5A607A" />
          <input
            type="text"
            placeholder="חיפוש לפי תיאור או סכום..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ border: 'none', outline: 'none', width: '100%', fontSize: 'var(--fs-14)', backgroundColor: 'transparent', color: 'var(--ink-1)' }}
          />
        </div>

        {/* פילטרים נוספים */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            style={selectStyle}
          >
            <option value="all">כל הקטגוריות</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
            ))}
          </select>

          <select
            value={selectedPaymentSources}
            onChange={(e) => setSelectedPaymentSources(e.target.value)}
            style={selectStyle}
          >
            <option value="all">כל אמצעי התשלום</option>
            {paymentSources.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          <div style={dateGroupStyle}>
            {/* #5A607A = --ink-4 */}
            <Calendar size={16} color="#5A607A" />
            <input
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
              style={dateInputStyle}
            />
            <span style={{ color: 'var(--ink-4)' }}>-</span>
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
              style={dateInputStyle}
            />
          </div>

          {/* כפתורים מהירים */}
          <button onClick={() => setPresetDate('thisMonth')} style={quickBtnStyle}>החודש</button>
          <button onClick={() => setPresetDate('lastMonth')} style={quickBtnStyle}>חודש שעבר</button>
          <button onClick={() => setPresetDate('clear')} style={quickBtnStyle}>הכל</button>
        </div>

        {/* שורה נפרדת: סינון לפי תנועות ללא קטגוריה */}
        <div style={{ display: 'flex', width: '100%', flexBasis: '100%', gap: 10, flexWrap: 'wrap' }}>
          <button
            onClick={() => setShowUncategorizedOnly((prev) => !prev)}
            style={showUncategorizedOnly ? uncategorizedBtnActiveStyle : uncategorizedBtnStyle}
            aria-pressed={showUncategorizedOnly}
          >
            ללא קטגוריה
          </button>
        </div>
      </div>

      {/* --- שורת סיכום חכמה ---
          Totals come from the server and cover the entire filtered set, not
          just the pages loaded into the table. --- */}
      <div style={summaryBarStyle}>
        <div style={summaryItemStyle}>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--ink-4)' }}>מספר תנועות</span>
          <span className="num" style={{ fontWeight: 700, fontSize: 'var(--fs-16)', color: 'var(--ink-1)' }}>{totals.count.toLocaleString()}</span>
        </div>
        <div style={{ width: 1, background: 'var(--border-strong)', height: 30 }} />
        <div style={summaryItemStyle}>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--ink-4)' }}>סה"כ הכנסות</span>
          <span className="num" style={{ fontWeight: 700, fontSize: 'var(--fs-16)', color: 'var(--pos)' }}>₪{totals.income.toLocaleString()}</span>
        </div>
        <div style={{ width: 1, background: 'var(--border-strong)', height: 30 }} />
        <div style={summaryItemStyle}>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--ink-4)' }}>סה"כ הוצאות</span>
          <span className="num" style={{ fontWeight: 700, fontSize: 'var(--fs-16)', color: 'var(--neg)' }}>₪{totals.expense.toLocaleString()}</span>
        </div>
        <div style={{ width: 1, background: 'var(--border-strong)', height: 30 }} />
        <div style={summaryItemStyle}>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--ink-4)' }}>יתרה בסינון</span>
          <span className="num" style={{ fontWeight: 700, fontSize: 'var(--fs-16)', color: balance >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
            ₪{balance.toLocaleString()}
          </span>
        </div>
      </div>

      {/* --- הטבלה --- */}
      <div style={tableContainerStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ backgroundColor: 'var(--surface-3)', borderBottom: '1px solid var(--border-strong)' }}>
              {/* Only these three columns were ever sortable. Clicking one
                  re-queries the server — the database orders the entire
                  filtered set, not the pages loaded so far. */}
              <SortableHeader label="תאריך" sortKey="transaction_date" sortConfig={sortConfig} onSort={handleSort} />
              <th style={thStyle}>קטגוריה</th>
              <SortableHeader label="תיאור" sortKey="description" sortConfig={sortConfig} onSort={handleSort} />
              <th style={thStyle}>אמצעי תשלום</th>
              <SortableHeader label="סכום" sortKey="total_amount" sortConfig={sortConfig} onSort={handleSort} />
              <th style={thStyle}>הערות</th>
              <th style={thStyle}>פעולות</th>
            </tr>
          </thead>
          <tbody>
            {list.loading ? (
              <tr>
                <td colSpan="7" style={{ padding: 40, textAlign: 'center', color: 'var(--ink-4)' }}>
                  טוען תנועות...
                </td>
              </tr>
            ) : list.error ? (
              <tr>
                <td colSpan="7" style={{ padding: 40, textAlign: 'center', color: 'var(--neg)' }}>
                  {list.error}
                </td>
              </tr>
            ) : rows.length > 0 ? rows.map((t) => (
              <tr key={t.id} className="tr-hover" style={trStyle}>
                <td className="num" style={{ ...tdStyle, color: 'var(--ink-4)', whiteSpace: 'nowrap' }}>
                  {new Date(t.transaction_date).toLocaleDateString('he-IL')}
                </td>
                <td style={tdStyle}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink-3)' }}>
                    {t.categories?.icon} {t.categories?.name}
                  </span>
                </td>
                <td style={tdStyle}>
                  <div style={{ fontWeight: 500, color: 'var(--ink-2)' }}>{t.description}</div>
                </td>
                <td style={{ ...tdStyle, color: 'var(--ink-3)' }}>
                  {t.payment_sources?.name || '−'}
                </td>
                <td className="num" style={{ ...tdStyle, fontWeight: 700, color: t.movement_type === 'income' ? 'var(--pos)' : 'var(--neg)' }}>
                  {t.movement_type === 'income' ? '+' : '−'}₪{Number(t.total_amount).toLocaleString()}
                </td>
                <td style={{ ...tdStyle, color: 'var(--ink-4)', fontSize: 'var(--fs-13)' }}>
                  {t.notes}
                </td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Link to={`/edit-transaction/${t.id}`} style={actionBtnStyle} title="ערוך">
                      {/* #9B82FF = --primary-hi */}
                      <Edit size={15} color="#9B82FF" />
                    </Link>
                    <button onClick={() => handleDelete(t)} style={actionBtnStyle} title="מחק">
                      {/* #FF7A8A = --neg */}
                      <Trash2 size={15} color="#FF7A8A" />
                    </button>
                  </div>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan="7" style={{ padding: 40, textAlign: 'center', color: 'var(--ink-4)' }}>
                  לא נמצאו תנועות התואמות את הסינון 🔍
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* --- טעינת עמוד נוסף --- */}
      {!list.loading && !list.error && rows.length > 0 && (
        <div style={loadMoreContainerStyle}>
          <span style={{ fontSize: 'var(--fs-13)', color: 'var(--ink-4)' }}>
            מוצגות {rows.length.toLocaleString()} מתוך {totals.count.toLocaleString()} תנועות
          </span>

          {moreError && (
            <span style={{ fontSize: 'var(--fs-13)', color: 'var(--neg)' }}>{moreError}</span>
          )}

          {list.hasMore ? (
            <button onClick={handleLoadMore} disabled={loadingMore} style={loadMoreBtnStyle}>
              {loadingMore ? 'טוען...' : moreError ? 'נסה שוב' : 'טען תנועות נוספות'}
            </button>
          ) : (
            <span style={{ fontSize: 'var(--fs-13)', color: 'var(--ink-4)' }}>הוצגו כל התנועות</span>
          )}
        </div>
      )}
    </div>
  );
};

// --- Styles ---
const primaryBtnStyle = {
  background: 'var(--primary-grad)',
  color: 'var(--primary-ink)',
  padding: '10px 18px',
  borderRadius: 'var(--r-10)',
  textDecoration: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--s-8)',
  fontSize: 'var(--fs-14)',
  fontWeight: 600,
  border: '1px solid rgba(255,255,255,0.12)',
  boxShadow: '0 4px 12px rgba(124,92,255,0.3)',
};

const filterContainerStyle = {
  backgroundColor: 'var(--surface-2)',
  padding: 'var(--s-16)',
  borderRadius: 'var(--r-12)',
  boxShadow: 'var(--shadow-sm)',
  border: '1px solid var(--border)',
  marginBottom: 'var(--s-16)',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--s-12)',
  alignItems: 'center',
};

const searchBoxStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  backgroundColor: 'var(--surface-3)',
  padding: '10px 14px',
  borderRadius: 30,
  flex: 1,
  minWidth: 250,
  border: '1px solid var(--border)',
};

const selectStyle = {
  padding: '9px 14px',
  borderRadius: 'var(--r-8)',
  border: '1px solid var(--border)',
  backgroundColor: 'var(--surface-3)',
  color: 'var(--ink-2)',
  outline: 'none',
  cursor: 'pointer',
  fontSize: 'var(--fs-14)',
};

const dateGroupStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  backgroundColor: 'var(--surface-3)',
  border: '1px solid var(--border)',
  padding: '8px 12px',
  borderRadius: 'var(--r-8)',
};

const dateInputStyle = {
  border: 'none',
  outline: 'none',
  color: 'var(--ink-2)',
  backgroundColor: 'transparent',
  fontFamily: 'inherit',
  fontSize: 'var(--fs-13)',
};

const quickBtnStyle = {
  backgroundColor: 'var(--primary-soft)',
  color: 'var(--primary-hi)',
  border: '1px solid rgba(124,92,255,0.2)',
  padding: '8px 14px',
  borderRadius: 20,
  fontSize: 'var(--fs-13)',
  cursor: 'pointer',
  fontWeight: 600,
};

const uncategorizedBtnStyle = {
  backgroundColor: 'var(--surface-3)',
  color: 'var(--ink-3)',
  border: '1px solid var(--border)',
  padding: '8px 16px',
  borderRadius: 20,
  fontSize: 'var(--fs-13)',
  cursor: 'pointer',
  fontWeight: 600,
};

const uncategorizedBtnActiveStyle = {
  ...uncategorizedBtnStyle,
  background: 'var(--primary-grad)',
  color: 'var(--primary-ink)',
  border: '1px solid rgba(255,255,255,0.12)',
  boxShadow: '0 4px 12px rgba(124,92,255,0.3)',
};

const summaryBarStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--s-20)',
  backgroundColor: 'var(--surface-2)',
  padding: '14px 24px',
  borderRadius: 'var(--r-12)',
  marginBottom: 'var(--s-16)',
  border: '1px solid var(--border)',
};

const summaryItemStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

const tableContainerStyle = {
  backgroundColor: 'var(--surface-2)',
  borderRadius: 'var(--r-12)',
  boxShadow: 'var(--shadow-sm)',
  border: '1px solid var(--border)',
  overflow: 'hidden',
};

const thStyle = {
  textAlign: 'start',
  padding: '13px 15px',
  color: 'var(--ink-4)',
  fontSize: 'var(--fs-11)',
  fontWeight: 600,
  userSelect: 'none',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
};

// Only the three sortable headers are clickable. The original code put
// `cursor: pointer` on every header, including the four that did nothing.
const sortableThStyle = {
  ...thStyle,
  cursor: 'pointer',
};

const trStyle = {
  borderBottom: '1px solid var(--border)',
  transition: 'background-color 0.15s',
};

const tdStyle = {
  padding: '14px 15px',
  fontSize: 'var(--fs-14)',
  color: 'var(--ink-2)',
};

const actionBtnStyle = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '4px 6px',
  borderRadius: 'var(--r-6)',
  transition: 'background 0.1s',
  display: 'flex',
};

const loadMoreContainerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--s-16)',
  flexWrap: 'wrap',
  padding: 'var(--s-16)',
};

const loadMoreBtnStyle = {
  backgroundColor: 'var(--primary-soft)',
  color: 'var(--primary-hi)',
  border: '1px solid rgba(124,92,255,0.2)',
  padding: '10px 22px',
  borderRadius: 20,
  fontSize: 'var(--fs-14)',
  cursor: 'pointer',
  fontWeight: 600,
};

export default Transactions;
