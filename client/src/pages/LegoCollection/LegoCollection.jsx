import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Blocks, Plus } from 'lucide-react';
import { deleteLegoSet, getLegoSets, updateLegoSet } from '../../services/api';
import { sortBySetNumber, calculateStats } from '../../utils/legoHelpers';
import { useLegoCollectionRevision } from '../../utils/legoCollectionInvalidation';
import StatsDashboard from '../../components/lego/StatsDashboard';
import CollectionFilters from '../../components/lego/CollectionFilters';
import SetCard from '../../components/lego/SetCard';
import AddLegoSetModal from '../../components/lego/AddLegoSetModal';
import {
  Alert,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PrimaryButton,
  Skeleton,
} from '../../components/ui';
import { PageHeaderContext } from '../../context/PageHeaderContext';
import './LegoCollection.css';

const LegoCollectionSkeleton = () => (
  <div className="lego-skeleton" role="status" aria-label="טעינת אוסף לגו">
    <span className="lego-visually-hidden">טוען את נתוני אוסף הלגו</span>
    <div className="lego-summary" aria-hidden="true">
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton key={index} height={112} borderRadius="var(--ft-radius-xl)" />
      ))}
    </div>
    <Skeleton className="lego-skeleton__filters" height={78} borderRadius="var(--ft-radius-xl)" aria-hidden="true" />
    <div className="lego-collection-grid" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} height={380} borderRadius="var(--ft-radius-xl)" />
      ))}
    </div>
  </div>
);

const LegoCollection = () => {
  const { setPageHeader } = useContext(PageHeaderContext);
  const collectionRevision = useLegoCollectionRevision();
  const [sets, setSets] = useState([]);
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterTheme, setFilterTheme] = useState('All');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [mutationError, setMutationError] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingSet, setEditingSet] = useState(null);
  const [pendingQuickUpdate, setPendingQuickUpdate] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const addButtonRef = useRef(null);
  const deleteReturnFocusRef = useRef(null);

  const openAddModal = useCallback(() => {
    setEditingSet(null);
    setShowAddModal(true);
  }, []);

  useEffect(() => {
    setPageHeader({
      title: 'אוסף לגו',
      subtitle: 'מעקב סטים, סטטוס בנייה ונתוני האוסף',
      primaryAction: {
        label: 'הוספת סט',
        icon: Plus,
        onClick: openAddModal,
      },
    });
  }, [openAddModal, setPageHeader]);

  const loadSets = useCallback(async ({ showLoading = true } = {}) => {
    if (showLoading) setLoading(true);
    setLoadError(false);

    try {
      const response = await getLegoSets();
      const nextSets = Array.isArray(response.data) ? response.data : [];
      setSets(sortBySetNumber(nextSets));
      return true;
    } catch {
      if (showLoading) setLoadError(true);
      return false;
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSets();
  }, [collectionRevision, loadSets]);

  const updateSetField = async (id, field, value) => {
    setPendingQuickUpdate({ id, field });
    setMutationError('');
    try {
      await updateLegoSet(id, { [field]: value });
      const refreshed = await loadSets({ showLoading: false });
      if (!refreshed) setMutationError('העדכון נשמר, אך רענון האוסף נכשל. נסו לרענן את הדף.');
    } catch {
      setMutationError(field === 'status' ? 'עדכון סטטוס הסט נכשל.' : 'עדכון מותג הסט נכשל.');
    } finally {
      setPendingQuickUpdate(null);
    }
  };

  const handleModalClose = () => {
    setShowAddModal(false);
    setEditingSet(null);
  };

  const handleSaved = async () => {
    handleModalClose();
    const refreshed = await loadSets({ showLoading: false });
    if (!refreshed) setMutationError('הסט נשמר, אך רענון האוסף נכשל. נסו לרענן את הדף.');
  };

  const openDeleteDialog = (set, event) => {
    deleteReturnFocusRef.current = event?.currentTarget || null;
    setDeleteTarget(set);
    setDeleteError('');
  };

  const closeDeleteDialog = () => {
    if (deletePending) return;
    setDeleteTarget(null);
    setDeleteError('');
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deletePending) return false;
    setDeletePending(true);
    setDeleteError('');
    try {
      await deleteLegoSet(deleteTarget.id);
      const refreshed = await loadSets({ showLoading: false });
      setDeleteTarget(null);
      if (!refreshed) setMutationError('הסט נמחק, אך רענון האוסף נכשל. נסו לרענן את הדף.');
      return true;
    } catch {
      setDeleteError('מחיקת הסט נכשלה. הסט נשאר באוסף ואפשר לנסות שוב.');
      return false;
    } finally {
      setDeletePending(false);
    }
  };

  const stats = useMemo(() => calculateStats(sets), [sets]);
  const themes = useMemo(
    () => [...new Set(sets.map((set) => set.theme).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he')),
    [sets],
  );
  const filteredSets = useMemo(
    () => sets
      .filter((set) => filterStatus === 'All' || set.status === filterStatus)
      .filter((set) => filterTheme === 'All' || set.theme === filterTheme),
    [filterStatus, filterTheme, sets],
  );
  const resetFilters = () => {
    setFilterStatus('All');
    setFilterTheme('All');
  };

  return (
    <div className="lego-page" dir="rtl">
      {loading && <LegoCollectionSkeleton />}

      {!loading && loadError && (
        <ErrorState
          level="page"
          title="טעינת אוסף הלגו נכשלה"
          description="לא ניתן להציג את הסטים כרגע. הנתונים הקיימים לא הוצגו כנתונים עדכניים."
          retryLabel="נסו שוב"
          onRetry={loadSets}
        />
      )}

      {!loading && !loadError && (
        <>
          <StatsDashboard stats={stats} />
          <CollectionFilters
            filterStatus={filterStatus}
            onFilterChange={setFilterStatus}
            filterTheme={filterTheme}
            onThemeFilterChange={setFilterTheme}
            onReset={resetFilters}
            themes={themes}
          />

          {mutationError && (
            <Alert variant="error" urgent onDismiss={() => setMutationError('')}>
              {mutationError}
            </Alert>
          )}

          {sets.length === 0 && (
            <EmptyState
              icon={Blocks}
              title="האוסף עדיין ריק"
              description="הוסיפו את הסט הראשון כדי להתחיל לעקוב אחר הבנייה ונתוני האוסף."
              primaryAction={(
                <PrimaryButton ref={addButtonRef} type="button" onClick={openAddModal}>
                  <Plus size={17} aria-hidden="true" />
                  הוספת סט
                </PrimaryButton>
              )}
            />
          )}

          {sets.length > 0 && filteredSets.length === 0 && (
            <EmptyState
              variant="filtered"
              title="לא נמצאו סטים למסננים שנבחרו"
              description="האוסף קיים, אך אין כרגע התאמה לסטטוס ולנושא שנבחרו."
              primaryAction={(
                <PrimaryButton type="button" onClick={resetFilters}>ניקוי מסננים</PrimaryButton>
              )}
            />
          )}

          {filteredSets.length > 0 && (
            <section className="lego-collection-region" aria-label={`סטים באוסף, ${filteredSets.length} תוצאות`}>
              <div className="lego-collection-grid">
                {filteredSets.map((set) => (
                  <SetCard
                    key={set.id}
                    set={set}
                    pending={pendingQuickUpdate?.id === set.id}
                    onStatusChange={(id, status) => updateSetField(id, 'status', status)}
                    onBrandChange={(id, brand) => updateSetField(id, 'brand', brand)}
                    onEdit={(selectedSet) => {
                      setShowAddModal(false);
                      setEditingSet(selectedSet);
                    }}
                    onDelete={openDeleteDialog}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <AddLegoSetModal
        show={showAddModal || Boolean(editingSet)}
        initialData={editingSet}
        existingSets={sets}
        onClose={handleModalClose}
        onSave={handleSaved}
        returnFocusRef={addButtonRef}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="מחיקת סט מהאוסף"
        message={deleteTarget ? <>למחוק לצמיתות את <strong dir="auto">{deleteTarget.name}</strong>? לא ניתן לבטל את הפעולה.</> : null}
        variant="destructive"
        confirmLabel="מחיקת סט"
        cancelLabel="ביטול"
        loading={deletePending}
        error={deleteError}
        closeOnConfirm={false}
        onClose={closeDeleteDialog}
        onConfirm={confirmDelete}
        returnFocusRef={deleteReturnFocusRef}
      />
    </div>
  );
};

export default LegoCollection;
