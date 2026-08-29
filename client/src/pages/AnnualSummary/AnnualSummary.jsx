import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarRange } from 'lucide-react';
import {
  EmptyState,
  ErrorState,
  GlassCard,
} from '../../components/ui';
import { PageHeaderContext } from '../../context/PageHeaderContext';
import { compareMoney } from '../../utils/money';
import { getAnnualBudgetSummary, getMonthlyCategoryBreakdown } from '../../services/api';
import {
  AnnualBreakdownSection,
  AnnualCategoryAnalysis,
  AnnualForecastAndChart,
  AnnualKpis,
  AnnualSpendingAnalysis,
  AnnualSummarySkeleton,
  AnnualToolbar,
  SparseBudgetAlert,
} from './AnnualSummarySections';
import { buildAnnualInsights } from './annualSummaryPresentation';
import './AnnualSummary.css';

const currentCalendarYear = () => new Date().getFullYear();

const emptyBreakdownState = {
  year: null,
  data: null,
  loading: false,
  error: '',
};

const AnnualSummary = () => {
  const currentYear = currentCalendarYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [requestVersion, setRequestVersion] = useState(0);
  const [query, setQuery] = useState({ year: null, version: -1, data: null, error: '' });
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [breakdown, setBreakdown] = useState(emptyBreakdownState);
  const [monthRange, setMonthRange] = useState('3');
  const breakdownGeneration = useRef(0);
  const { setPageHeader } = useContext(PageHeaderContext);

  const years = useMemo(() => {
    const supportedYears = [];
    for (let year = 2022; year <= currentYear + 1; year += 1) supportedYears.push(year);
    return supportedYears;
  }, [currentYear]);

  const loading = query.year !== selectedYear || query.version !== requestVersion;
  const data = query.year === selectedYear ? query.data : null;
  const pageError = !loading && query.year === selectedYear ? query.error : '';

  useEffect(() => {
    setPageHeader({
      title: 'סיכום שנתי',
      subtitle: 'ניתוח תקציב מול הוצאות לאורך השנה',
    });
  }, [setPageHeader]);

  useEffect(() => {
    let active = true;
    const year = selectedYear;
    const version = requestVersion;

    getAnnualBudgetSummary(year)
      .then((response) => {
        if (!active) return;
        setQuery({ year, version, data: response.data, error: '' });
      })
      .catch(() => {
        if (!active) return;
        setQuery({ year, version, data: null, error: 'לא ניתן היה לטעון את הסיכום השנתי.' });
      });

    return () => { active = false; };
  }, [requestVersion, selectedYear]);

  const changeYear = (year) => {
    if (year === selectedYear) return;
    breakdownGeneration.current += 1;
    setShowBreakdown(false);
    setBreakdown(emptyBreakdownState);
    setMonthRange('3');
    setSelectedYear(year);
  };

  const loadBreakdown = () => {
    const generation = breakdownGeneration.current + 1;
    breakdownGeneration.current = generation;
    setBreakdown({ year: selectedYear, data: null, loading: true, error: '' });

    getMonthlyCategoryBreakdown(selectedYear)
      .then((response) => {
        if (breakdownGeneration.current !== generation) return;
        setBreakdown({ year: selectedYear, data: response.data, loading: false, error: '' });
      })
      .catch(() => {
        if (breakdownGeneration.current !== generation) return;
        setBreakdown({
          year: selectedYear,
          data: null,
          loading: false,
          error: 'הפירוט החודשי לא נטען. שאר הסיכום השנתי נשאר זמין.',
        });
      });
  };

  const toggleBreakdown = () => {
    if (showBreakdown) {
      setShowBreakdown(false);
      return;
    }

    setShowBreakdown(true);
    if (breakdown.year !== selectedYear || (!breakdown.data && !breakdown.loading)) {
      loadBreakdown();
    }
  };

  const retryPage = () => setRequestVersion((version) => version + 1);
  const isEmpty = data
    && compareMoney(data.summary.yearly_planned ?? '0.00') === 0
    && compareMoney(data.summary.yearly_actual ?? '0.00') === 0;
  const insights = data ? buildAnnualInsights(data) : null;

  return (
    <div className="annual-summary-page" dir="rtl">
      <AnnualToolbar
        selectedYear={selectedYear}
        years={years}
        monthRange={monthRange}
        onYearChange={changeYear}
        onMonthRangeChange={setMonthRange}
      />

      {loading && <AnnualSummarySkeleton />}

      {pageError && (
        <GlassCard padding="24px">
          <ErrorState
            title="טעינת הסיכום השנתי נכשלה"
            description={`הנתונים לשנת ${selectedYear} לא הגיעו. אפשר לנסות שוב.`}
            onRetry={retryPage}
          />
        </GlassCard>
      )}

      {!loading && !pageError && isEmpty && (
        <GlassCard padding="24px" className="annual-empty-card">
          <EmptyState
            icon={CalendarRange}
            title={`אין נתונים לשנת ${selectedYear}`}
            description="לא נרשמו הוצאות ולא הוגדרו תקציבים בשנה הזו. אפשר לבחור שנה אחרת."
          />
        </GlassCard>
      )}

      {!loading && !pageError && data && !isEmpty && (
        <div className="annual-summary-content">
          <SparseBudgetAlert summary={data.summary} />
          <AnnualKpis summary={data.summary} />
          <AnnualForecastAndChart data={data} insights={insights} />
          <AnnualSpendingAnalysis data={data} />
          <AnnualCategoryAnalysis categories={data.categories} />
          <AnnualBreakdownSection
            open={showBreakdown}
            breakdown={breakdown}
            monthRange={monthRange}
            onToggle={toggleBreakdown}
            onRetry={loadBreakdown}
          />
        </div>
      )}
    </div>
  );
};

export default AnnualSummary;
