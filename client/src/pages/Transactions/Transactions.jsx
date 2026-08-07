import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getCategories, getPaymentSources, getTransactions, deleteTransaction } from '../../services/api';
import { PageHeaderContext } from '../../context/PageHeaderContext';
import { getMonthRange, getRelativeMonthRange } from '../../utils/dateRange';
import { TechnicalValue } from '../../components/ui';
import TransactionsFilters from './TransactionsFilters';
import {
  TransactionDeleteDialog,
  TransactionsEmptyState,
  TransactionsInitialError,
  TransactionsListSkeleton,
  TransactionsLoadedContent,
  TransactionsMobileSortControl,
  TransactionsSummary,
} from './TransactionsList';
import './Transactions.css';

// One server page. The backend clamps anything above its own maximum (250).
const PAGE_SIZE = 100;
const DEFAULT_SORT = { key: 'transaction_date', direction: 'desc' };
const EMPTY_TOTALS = { count: 0, income: 0, expense: 0 };
const EMPTY_LIST = {
  rows: [],
  totals: EMPTY_TOTALS,
  cursor: null,
  hasMore: false,
  error: null,
  loading: true,
};

const sameRange = (first, second) =>
  first.start === second.start && first.end === second.end;

const formatPeriodMonth = (value) => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})/);
  if (!match) return '';
  return new Intl.DateTimeFormat('he-IL', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)));
};

const Transactions = () => {
  // The query result stays in one object so a filter/sort change resets rows,
  // whole-filter totals, cursor, and error atomically.
  const [list, setList] = useState(EMPTY_LIST);
  const [categories, setCategories] = useState([]);
  const [paymentSources, setPaymentSources] = useState([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(null);
  const [retryVersion, setRetryVersion] = useState(0);

  // Sorting remains server-owned and uses the established default/toggle rule.
  const [sortConfig, setSortConfig] = useState(DEFAULT_SORT);

  // Filters remain page-owned. Only free text is debounced.
  const [searchText, setSearchText] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedPaymentSource, setSelectedPaymentSource] = useState('all');
  const [dateRange, setDateRange] = useState(() => getMonthRange());
  const [debouncedSearchText, setDebouncedSearchText] = useState('');
  const [showUncategorizedOnly, setShowUncategorizedOnly] = useState(false);
  const [transactionToDelete, setTransactionToDelete] = useState(null);

  const { setPageHeader } = useContext(PageHeaderContext);
  const requestIdRef = useRef(0);

  useEffect(() => {
    setPageHeader({
      title: 'תנועות',
      subtitle: 'ספר החשבונות המלא — סינון, מיון וטעינה מתגלגלת',
    });
  }, [setPageHeader]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchText(searchText), 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getCategories(), getPaymentSources()])
      .then(([categoriesResponse, paymentSourcesResponse]) => {
        if (cancelled) return;
        setCategories(categoriesResponse.data);
        setPaymentSources(paymentSourcesResponse.data);
      })
      .catch((error) => {
        console.error('Error loading filter options:', error);
      });
    return () => { cancelled = true; };
  }, []);

  // This is the established API parameter object. Keeping sort in it ensures a
  // new sort restarts the keyset cursor exactly like a filter change.
  const filters = useMemo(() => ({
    from: dateRange.start || undefined,
    to: dateRange.end || undefined,
    categoryId: selectedCategory,
    paymentSourceId: selectedPaymentSource,
    uncategorizedOnly: showUncategorizedOnly,
    search: debouncedSearchText,
    sortBy: sortConfig.key,
    sortDirection: sortConfig.direction,
  }), [
    dateRange.start,
    dateRange.end,
    selectedCategory,
    selectedPaymentSource,
    showUncategorizedOnly,
    debouncedSearchText,
    sortConfig.key,
    sortConfig.direction,
  ]);

  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);
  const [loadedFilterKey, setLoadedFilterKey] = useState(filterKey);

  // Reset during render so old rows never paint under newly applied filters.
  if (loadedFilterKey !== filterKey) {
    setLoadedFilterKey(filterKey);
    setList(EMPTY_LIST);
    setMoreError(null);
  }

  useEffect(() => {
    const requestId = ++requestIdRef.current;

    getTransactions({
      ...filters,
      limit: PAGE_SIZE,
      includeTotals: true,
    })
      .then((response) => {
        if (requestId !== requestIdRef.current) return;
        const { data, pagination, totals } = response.data;
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
  }, [filters, retryVersion]);

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
      .then((response) => {
        if (requestId !== requestIdRef.current) return;
        const { data, pagination } = response.data;

        setList((previous) => {
          const seen = new Set(previous.rows.map((transaction) => transaction.id));
          return {
            ...previous,
            rows: [...previous.rows, ...data.filter((transaction) => !seen.has(transaction.id))],
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

  const handleSort = (key, explicitDirection) => {
    setSortConfig((previous) => ({
      key,
      direction: explicitDirection
        || (previous.key === key && previous.direction === 'asc' ? 'desc' : 'asc'),
    }));
  };

  const setPresetDate = (type) => {
    if (type === 'thisMonth') {
      setDateRange(getMonthRange());
    } else if (type === 'lastMonth') {
      setDateRange(getRelativeMonthRange(-1));
    } else {
      setDateRange({ start: '', end: '' });
    }
  };

  const resetAllFilters = () => {
    setDateRange(getMonthRange());
    setSelectedCategory('all');
    setSelectedPaymentSource('all');
    setSearchText('');
    setDebouncedSearchText('');
    setShowUncategorizedOnly(false);
    setSortConfig(DEFAULT_SORT);
  };

  const retryInitialLoad = () => {
    setInitialLoading(true);
    setList(EMPTY_LIST);
    setMoreError(null);
    setRetryVersion((version) => version + 1);
  };

  const confirmDelete = async () => {
    const transaction = transactionToDelete;
    if (!transaction) return false;

    try {
      await deleteTransaction(transaction.id);
      setList((previous) => {
        const amount = Number(transaction.total_amount) || 0;
        return {
          ...previous,
          rows: previous.rows.filter((row) => row.id !== transaction.id),
          totals: {
            count: Math.max(previous.totals.count - 1, 0),
            income: transaction.movement_type === 'income'
              ? previous.totals.income - amount
              : previous.totals.income,
            expense: transaction.movement_type === 'expense'
              ? previous.totals.expense - amount
              : previous.totals.expense,
          },
        };
      });
      return true;
    } catch (error) {
      console.error('Error deleting transaction:', error);
      throw error;
    }
  };

  const currentMonthRange = getMonthRange();
  const previousMonthRange = getRelativeMonthRange(-1);
  const activeDatePreset = sameRange(dateRange, currentMonthRange)
    ? 'thisMonth'
    : sameRange(dateRange, previousMonthRange)
      ? 'lastMonth'
      : (!dateRange.start && !dateRange.end ? 'clear' : 'custom');

  const selectedCategoryRecord = categories.find(
    (category) => String(category.id) === String(selectedCategory),
  );
  const selectedPaymentSourceRecord = paymentSources.find(
    (source) => String(source.id) === String(selectedPaymentSource),
  );

  const activeFilters = [];
  if (activeDatePreset === 'lastMonth') {
    activeFilters.push({
      key: 'date',
      label: 'החודש הקודם',
      accessibleName: 'החודש הקודם',
      onRemove: () => setPresetDate('thisMonth'),
    });
  } else if (activeDatePreset === 'clear') {
    activeFilters.push({
      key: 'date',
      label: 'כל ההיסטוריה',
      accessibleName: 'כל ההיסטוריה',
      onRemove: () => setPresetDate('thisMonth'),
    });
  } else if (activeDatePreset === 'custom') {
    activeFilters.push({
      key: 'date',
      label: (
        <>
          טווח: <TechnicalValue>{dateRange.start || 'ללא התחלה'}</TechnicalValue>
          {' – '}
          <TechnicalValue>{dateRange.end || 'ללא סיום'}</TechnicalValue>
        </>
      ),
      accessibleName: 'טווח תאריכים מותאם',
      onRemove: () => setPresetDate('thisMonth'),
    });
  }
  if (selectedCategory !== 'all') {
    activeFilters.push({
      key: 'category',
      label: `קטגוריה: ${selectedCategoryRecord?.name || selectedCategory}`,
      accessibleName: `קטגוריה ${selectedCategoryRecord?.name || selectedCategory}`,
      onRemove: () => setSelectedCategory('all'),
    });
  }
  if (selectedPaymentSource !== 'all') {
    activeFilters.push({
      key: 'payment-source',
      label: `אמצעי תשלום: ${selectedPaymentSourceRecord?.name || selectedPaymentSource}`,
      accessibleName: `אמצעי תשלום ${selectedPaymentSourceRecord?.name || selectedPaymentSource}`,
      onRemove: () => setSelectedPaymentSource('all'),
    });
  }
  if (searchText) {
    activeFilters.push({
      key: 'search',
      label: `חיפוש: „${searchText}”`,
      accessibleName: `חיפוש ${searchText}`,
      onRemove: () => {
        setSearchText('');
        setDebouncedSearchText('');
      },
    });
  }
  if (showUncategorizedOnly) {
    activeFilters.push({
      key: 'uncategorized',
      label: 'ללא קטגוריה בלבד',
      accessibleName: 'ללא קטגוריה בלבד',
      onRemove: () => setShowUncategorizedOnly(false),
    });
  }

  const filterProps = {
    categories,
    paymentSources,
    searchText,
    selectedCategory,
    selectedPaymentSource,
    dateRange,
    activeDatePreset,
    showUncategorizedOnly,
    searchPending: searchText !== debouncedSearchText,
    onSearchChange: setSearchText,
    onCategoryChange: setSelectedCategory,
    onPaymentSourceChange: setSelectedPaymentSource,
    onDateRangeChange: setDateRange,
    onPresetDate: setPresetDate,
    onToggleUncategorized: () => setShowUncategorizedOnly((visible) => !visible),
  };

  const datasetEmpty = activeDatePreset === 'clear'
      && selectedCategory === 'all'
      && selectedPaymentSource === 'all'
      && !searchText.trim()
      && !showUncategorizedOnly;

  return (
    <div className="transactions-page" dir="rtl">
      <TransactionsFilters
        activeFilters={activeFilters}
        periodContext={activeDatePreset === 'thisMonth'
          ? `תקופה: ${formatPeriodMonth(dateRange.start)}`
          : null}
        onReset={resetAllFilters}
        resetAvailable={
          activeFilters.length > 0
          || sortConfig.key !== DEFAULT_SORT.key
          || sortConfig.direction !== DEFAULT_SORT.direction
        }
        {...filterProps}
      />

      <TransactionsMobileSortControl sortConfig={sortConfig} onSort={handleSort} />

      {!list.error && <TransactionsSummary totals={list.totals} loading={list.loading} />}

      {list.loading && <TransactionsListSkeleton />}

      {!list.loading && list.error && (
        <TransactionsInitialError onRetry={retryInitialLoad} retrying={initialLoading} />
      )}

      {!list.loading && !list.error && list.rows.length === 0 && (
        <TransactionsEmptyState datasetEmpty={datasetEmpty} onReset={resetAllFilters} />
      )}

      {!list.loading && !list.error && list.rows.length > 0 && (
        <TransactionsLoadedContent
          rows={list.rows}
          totals={list.totals}
          sortConfig={sortConfig}
          onSort={handleSort}
          onRequestDelete={setTransactionToDelete}
          hasMore={list.hasMore}
          loadingMore={loadingMore}
          error={moreError}
          onLoadMore={handleLoadMore}
        />
      )}

      <TransactionDeleteDialog
        transaction={transactionToDelete}
        onClose={() => setTransactionToDelete(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
};

export default Transactions;
