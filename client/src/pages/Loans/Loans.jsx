import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Landmark, Plus } from 'lucide-react';
import { PageHeaderContext } from '../../context/PageHeaderContext';
import { createLoan, getAllLoans } from '../../services/api';
import LoanCard from '../../components/LoanCard';
import LoansDashboard from '../../components/LoanDashboard';
import LoanSimulator from '../../components/LoanSimulator';
import {
  Alert,
  EmptyState,
  ErrorState,
  PrimaryButton,
  SecondaryButton,
  Skeleton,
} from '../../components/ui';
import CreateLoanDialog from './CreateLoanDialog';
import './Loans.css';

const LoansSkeleton = () => (
  <div className="loans-skeleton" role="status" aria-label="טעינת הלוואות">
    <span className="loans-visually-hidden">טוען את נתוני ההלוואות</span>
    <div className="loans-summary-grid" aria-hidden="true">
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton key={index} height={96} borderRadius="var(--ft-radius-xl)" />
      ))}
    </div>
    <div className="loans-cards-grid" aria-hidden="true">
      {Array.from({ length: 3 }, (_, index) => (
        <Skeleton key={index} height={210} borderRadius="var(--ft-radius-xl)" />
      ))}
    </div>
    <Skeleton height={188} borderRadius="var(--ft-radius-xl)" aria-hidden="true" />
  </div>
);

const Loans = () => {
  const { setPageHeader } = useContext(PageHeaderContext);
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showAllLoans, setShowAllLoans] = useState(false);
  const addButtonRef = useRef(null);

  const openCreateDialog = useCallback(() => setShowCreateDialog(true), []);
  const closeCreateDialog = useCallback(() => setShowCreateDialog(false), []);

  useEffect(() => {
    setPageHeader({
      title: 'הלוואות',
      subtitle: 'יתרות, החזרים וסימולציית פירעון מוקדם',
      primaryAction: {
        label: 'הוספת הלוואה',
        icon: Plus,
        onClick: openCreateDialog,
      },
    });
  }, [openCreateDialog, setPageHeader]);

  const fetchLoans = useCallback(async ({ showLoading = true } = {}) => {
    if (showLoading) setLoading(true);
    setLoadError(false);

    try {
      const response = await getAllLoans();
      setLoans(Array.isArray(response.data) ? response.data : []);
      return true;
    } catch {
      if (showLoading) setLoadError(true);
      return false;
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLoans();
  }, [fetchLoans]);

  const handleCreateLoan = useCallback(async (payload) => {
    await createLoan(payload);
    closeCreateDialog();
    await fetchLoans({ showLoading: false });
  }, [closeCreateDialog, fetchLoans]);

  const visibleLoans = showAllLoans ? loans : loans.slice(0, 6);
  const hiddenLoanCount = Math.max(loans.length - 6, 0);

  return (
    <div className="loans-page" dir="rtl">
      {loading && <LoansSkeleton />}

      {!loading && loadError && (
        <ErrorState
          level="page"
          title="טעינת ההלוואות נכשלה"
          description="לא ניתן להציג את תיק ההלוואות כרגע."
          retryLabel="נסה שוב"
          onRetry={fetchLoans}
        />
      )}

      {!loading && !loadError && loans.length === 0 && (
        <EmptyState
          icon={Landmark}
          title="לא נרשמו הלוואות"
          description="אחרי הוספת הלוואה יופיעו כאן היתרה, ההחזר החודשי וסימולטור הפירעון המוקדם."
          primaryAction={(
            <PrimaryButton ref={addButtonRef} type="button" onClick={openCreateDialog}>
              <Plus size={17} aria-hidden="true" />
              הוספת הלוואה
            </PrimaryButton>
          )}
        />
      )}

      {!loading && !loadError && loans.length > 0 && (
        <>
          <LoansDashboard loans={loans} />

          <section className="loans-portfolio" aria-labelledby="loans-portfolio-title">
            <h2 id="loans-portfolio-title" className="loans-visually-hidden">תיק ההלוואות</h2>
            <div id="loans-cards-grid" className="loans-cards-grid">
              {visibleLoans.map((loan) => <LoanCard key={loan.id} loan={loan} />)}
            </div>
            {hiddenLoanCount > 0 && (
              <div className="loans-disclosure">
                <SecondaryButton
                  type="button"
                  size="sm"
                  aria-controls="loans-cards-grid"
                  aria-expanded={showAllLoans}
                  onClick={() => setShowAllLoans((current) => !current)}
                >
                  {showAllLoans
                    ? <ChevronUp size={16} aria-hidden="true" />
                    : <ChevronDown size={16} aria-hidden="true" />}
                  {showAllLoans
                    ? 'הצג פחות'
                    : `הצג עוד ${hiddenLoanCount} ${hiddenLoanCount === 1 ? 'הלוואה' : 'הלוואות'}`}
                </SecondaryButton>
                <span className="loans-visually-hidden" role="status" aria-live="polite">
                  מוצגות {visibleLoans.length} מתוך {loans.length} הלוואות
                </span>
              </div>
            )}
          </section>

          <LoanSimulator loans={loans} />

          <Alert className="loans-limitations" variant="info">
            עריכת הלוואה, מחיקתה, רישום החזר ושינוי סטטוס אינם זמינים כיום ולכן אינם מוצגים כפעולות.
          </Alert>
        </>
      )}

      {showCreateDialog && (
        <CreateLoanDialog
          open
          onClose={closeCreateDialog}
          onSubmit={handleCreateLoan}
          returnFocusRef={addButtonRef}
        />
      )}
    </div>
  );
};

export default Loans;
