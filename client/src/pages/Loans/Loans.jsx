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
import LoanDetailsDrawer from './LoanDetailsDrawer';
import { isActiveLoan, isClosedLoan } from '../../utils/loanDisplay';
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
  const [showAllActiveLoans, setShowAllActiveLoans] = useState(false);
  const [showClosedLoans, setShowClosedLoans] = useState(false);
  const [selectedLoan, setSelectedLoan] = useState(null);
  const addButtonRef = useRef(null);
  const selectedCardRef = useRef(null);

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

  const activeLoans = loans.filter(isActiveLoan);
  const closedLoans = loans
    .filter(isClosedLoan)
    .sort((left, right) => (
      String(right.closed_date || '').localeCompare(String(left.closed_date || ''))
      || Number(right.id) - Number(left.id)
    ));
  const visibleActiveLoans = showAllActiveLoans ? activeLoans : activeLoans.slice(0, 6);
  const hiddenActiveLoanCount = Math.max(activeLoans.length - 6, 0);

  const openLoanDetails = useCallback((loan, trigger) => {
    selectedCardRef.current = trigger;
    setSelectedLoan(loan);
  }, []);

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

          <section className="loans-portfolio" aria-labelledby="active-loans-title">
            <div className="loans-section-heading">
              <div>
                <h2 id="active-loans-title">הלוואות פעילות</h2>
                <span>
                  {activeLoans.length} {activeLoans.length === 1 ? 'הלוואה עם יתרת קרן' : 'הלוואות עם יתרת קרן'}
                </span>
              </div>
            </div>
            <div id="loans-cards-grid" className="loans-cards-grid">
              {visibleActiveLoans.map((loan) => (
                <LoanCard key={loan.id} loan={loan} onSelect={openLoanDetails} />
              ))}
            </div>
            {activeLoans.length === 0 && (
              <div className="loans-active-empty">אין כרגע הלוואות פעילות עם יתרת קרן.</div>
            )}
            {hiddenActiveLoanCount > 0 && (
              <div className="loans-disclosure">
                <SecondaryButton
                  type="button"
                  size="sm"
                  aria-controls="loans-cards-grid"
                  aria-expanded={showAllActiveLoans}
                  onClick={() => setShowAllActiveLoans((current) => !current)}
                >
                  {showAllActiveLoans
                    ? <ChevronUp size={16} aria-hidden="true" />
                    : <ChevronDown size={16} aria-hidden="true" />}
                  {showAllActiveLoans
                    ? 'הצג פחות'
                    : `הצג עוד ${hiddenActiveLoanCount} ${hiddenActiveLoanCount === 1 ? 'הלוואה' : 'הלוואות'}`}
                </SecondaryButton>
                <span className="loans-visually-hidden" role="status" aria-live="polite">
                  מוצגות {visibleActiveLoans.length} מתוך {activeLoans.length} הלוואות פעילות
                </span>
              </div>
            )}
          </section>

          {closedLoans.length > 0 && (
            <section className="loans-closed" aria-labelledby="closed-loans-title">
              <button
                type="button"
                className="loans-closed__toggle"
                aria-controls="closed-loans-grid"
                aria-expanded={showClosedLoans}
                onClick={() => setShowClosedLoans((current) => !current)}
              >
                <span>
                  <strong id="closed-loans-title">הלוואות סגורות</strong>
                  <small>
                    הצג {closedLoans.length} {closedLoans.length === 1 ? 'הלוואה סגורה' : 'הלוואות סגורות'}
                  </small>
                </span>
                {showClosedLoans
                  ? <ChevronUp size={18} aria-hidden="true" />
                  : <ChevronDown size={18} aria-hidden="true" />}
              </button>
              {showClosedLoans && (
                <div id="closed-loans-grid" className="loans-cards-grid loans-cards-grid--closed">
                  {closedLoans.map((loan) => (
                    <LoanCard key={loan.id} loan={loan} onSelect={openLoanDetails} />
                  ))}
                </div>
              )}
            </section>
          )}

          <LoanSimulator loans={activeLoans} />

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

      {selectedLoan && (
        <LoanDetailsDrawer
          key={selectedLoan.id}
          loan={selectedLoan}
          open
          onClose={() => setSelectedLoan(null)}
          returnFocusRef={selectedCardRef}
        />
      )}
    </div>
  );
};

export default Loans;
