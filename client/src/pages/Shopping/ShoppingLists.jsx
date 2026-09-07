import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Plus, ShoppingCart, Tag, Trash2 } from 'lucide-react';
import { PageHeaderContext } from '../../context/PageHeaderContext';
import {
  Alert,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  GlassCard,
  IconButton,
  PrimaryButton,
  ProgressBar,
  SecondaryButton,
  Skeleton,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  TechnicalValue,
} from '../../components/ui';
import {
  createShoppingList,
  deleteShoppingList,
  getShoppingLists,
  getShoppingListTypes,
} from '../../services/api';
import ShoppingListDetail from './ShoppingListDetail';
import ShoppingListDialog from './ShoppingListDialog';
import { SHOPPING_STATUS } from './shoppingConstants';
import './Shopping.css';

const STATUS_FILTERS = [
  { value: 'all', label: 'הכול' },
  { value: 'draft', label: 'טיוטה' },
  { value: 'active', label: 'פעילות' },
  { value: 'checked_out', label: 'הושלמו בקופה' },
  { value: 'archived', label: 'בארכיון' },
];

const formatDate = (value) => {
  if (!value) return 'לא ידוע';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('he-IL');
};

const ShoppingOverviewSkeleton = () => (
  <div className="shopping-skeleton" role="status" aria-label="טעינת רשימות קניות">
    <span className="shopping-visually-hidden">טוען רשימות קניות</span>
    <Skeleton height={68} borderRadius="var(--ft-radius-xl)" aria-hidden="true" />
    <div className="shopping-list-grid" aria-hidden="true">
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton key={index} height={174} borderRadius="var(--ft-radius-xl)" />
      ))}
    </div>
  </div>
);

const ShoppingListCard = ({ list, onOpen, onDelete }) => {
  const status = SHOPPING_STATUS[list.status] || SHOPPING_STATUS.draft;
  const total = Number(list.item_count) || 0;
  const purchased = Number(list.purchased_count) || 0;
  const percentage = total > 0 ? Math.round((purchased / total) * 100) : 0;
  const canDelete = list.status === 'draft' || list.status === 'active';

  return (
    <GlassCard className="shopping-list-card" padding="var(--ft-space-7)">
      <article aria-labelledby={`shopping-list-${list.id}`}>
        <div className="shopping-list-card__header">
          <div className="shopping-list-card__title-block">
            <h3 id={`shopping-list-${list.id}`}>{list.title}</h3>
            <div className="shopping-list-card__badges">
              {list.shopping_list_types?.name && (
                <span className="shopping-badge shopping-badge--type">
                  <Tag size={13} aria-hidden="true" />
                  {list.shopping_list_types.name}
                </span>
              )}
              <span className={`shopping-badge shopping-status ${status.className}`}>{status.label}</span>
            </div>
          </div>
          {canDelete && (
            <IconButton
              type="button"
              size="touch"
              className="shopping-card-delete"
              aria-label={`מחיקת הרשימה ${list.title}`}
              onClick={(event) => onDelete(list, event)}
            >
              <Trash2 size={16} aria-hidden="true" />
            </IconButton>
          )}
        </div>

        <div className="shopping-list-card__progress">
          <div className="shopping-progress-label">
            <span>{purchased} מתוך {total} פריטים</span>
            <TechnicalValue>{percentage}%</TechnicalValue>
          </div>
          <ProgressBar
            value={percentage}
            tone={percentage === 100 ? 'pos' : 'primary'}
            height={7}
            aria-label={`התקדמות הרשימה ${list.title}`}
          />
        </div>

        <div className="shopping-list-card__footer">
          <span>עודכנה: <TechnicalValue>{formatDate(list.updated_at)}</TechnicalValue></span>
          <SecondaryButton type="button" size="sm" onClick={() => onOpen(list.id)}>
            פתיחה
            <ChevronLeft size={15} aria-hidden="true" />
          </SecondaryButton>
        </div>
      </article>
    </GlassCard>
  );
};

const ShoppingLists = () => {
  const { setPageHeader } = useContext(PageHeaderContext);
  const createReturnFocusRef = useRef(null);
  const deleteReturnFocusRef = useRef(null);
  const [lists, setLists] = useState([]);
  const [listTypes, setListTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [mutationError, setMutationError] = useState('');
  const [selectedListId, setSelectedListId] = useState(null);

  const openCreate = useCallback((event) => {
    createReturnFocusRef.current = event?.currentTarget || null;
    setMutationError('');
    setShowCreateDialog(true);
  }, []);

  useEffect(() => {
    if (selectedListId) return;
    setPageHeader({
      title: 'רשימות קניות',
      subtitle: 'טיוטות, רשימות פעילות וסגירת קנייה',
      primaryAction: {
        label: 'רשימה חדשה',
        icon: Plus,
        onClick: openCreate,
      },
    });
  }, [openCreate, selectedListId, setPageHeader]);

  const loadShoppingData = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [listsResponse, typesResponse] = await Promise.all([
        getShoppingLists(),
        getShoppingListTypes(),
      ]);
      setLists(Array.isArray(listsResponse.data) ? listsResponse.data : []);
      setListTypes(Array.isArray(typesResponse.data) ? typesResponse.data : []);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshLists = useCallback(async () => {
    try {
      const response = await getShoppingLists();
      setLists(Array.isArray(response.data) ? response.data : []);
      return true;
    } catch {
      setMutationError('רענון רשימות הקניות נכשל. אפשר לנסות שוב.');
      return false;
    }
  }, []);

  useEffect(() => {
    loadShoppingData();
  }, [loadShoppingData]);

  const counts = useMemo(() => STATUS_FILTERS.reduce((result, filter) => ({
    ...result,
    [filter.value]: filter.value === 'all'
      ? lists.length
      : lists.filter((list) => list.status === filter.value).length,
  }), {}), [lists]);

  const filteredLists = useMemo(() => (
    statusFilter === 'all' ? lists : lists.filter((list) => list.status === statusFilter)
  ), [lists, statusFilter]);

  const handleCreate = async (payload) => {
    await createShoppingList(payload);
    setShowCreateDialog(false);
    await refreshLists();
  };

  const requestDelete = (list, event) => {
    deleteReturnFocusRef.current = event.currentTarget;
    setMutationError('');
    setDeleteTarget(list);
  };

  const confirmDelete = async () => {
    await deleteShoppingList(deleteTarget.id);
    await refreshLists();
  };

  if (selectedListId) {
    return (
      <ShoppingListDetail
        listId={selectedListId}
        listTypeName={lists.find((list) => list.id === selectedListId)?.shopping_list_types?.name || ''}
        onBack={() => {
          setSelectedListId(null);
          refreshLists();
        }}
      />
    );
  }

  return (
    <div className="shopping-page" dir="rtl">
      {loading && <ShoppingOverviewSkeleton />}

      {!loading && loadError && (
        <ErrorState
          level="page"
          title="טעינת רשימות הקניות נכשלה"
          description="לא ניתן להציג את הרשימות כרגע."
          retryLabel="נסה שוב"
          onRetry={loadShoppingData}
        />
      )}

      {!loading && !loadError && (
        <Tabs value={statusFilter} onValueChange={setStatusFilter} className="shopping-tabs">
          <section className="shopping-filter-panel" aria-label="סינון רשימות קניות">
            <TabList className="shopping-status-tabs" aria-label="סינון לפי סטטוס רשימה">
              {STATUS_FILTERS.map((filter) => (
                <Tab key={filter.value} value={filter.value} badge={counts[filter.value]}>
                  {filter.label}
                </Tab>
              ))}
            </TabList>
          </section>

          {mutationError && (
            <Alert variant="error" urgent onDismiss={() => setMutationError('')}>
              {mutationError}
            </Alert>
          )}

          {STATUS_FILTERS.map((filter) => (
            <TabPanel key={filter.value} value={filter.value} className="shopping-overview-results">
              {statusFilter === filter.value && (
                <>
                  {lists.length === 0 && (
                    <EmptyState
                      icon={ShoppingCart}
                      title="אין רשימות קניות"
                      description="רשימה חדשה נפתחת כטיוטה. אחרי הוספת פריטים אפשר להפעיל אותה ולצאת לקנייה."
                      primaryAction={(
                        <PrimaryButton type="button" onClick={openCreate}>
                          <Plus size={16} aria-hidden="true" />
                          רשימה חדשה
                        </PrimaryButton>
                      )}
                    />
                  )}

                  {lists.length > 0 && filteredLists.length === 0 && (
                    <EmptyState
                      variant="filtered"
                      title="אין רשימות בסטטוס הזה"
                      description="אפשר לעבור ללשונית ״הכול״ ולראות את כל הרשימות."
                      primaryAction={(
                        <SecondaryButton type="button" onClick={() => setStatusFilter('all')}>
                          הצגת כל הרשימות
                        </SecondaryButton>
                      )}
                    />
                  )}

                  {filteredLists.length > 0 && (
                    <div className="shopping-list-grid" aria-label="רשימות קניות">
                      {filteredLists.map((list) => (
                        <ShoppingListCard
                          key={list.id}
                          list={list}
                          onOpen={setSelectedListId}
                          onDelete={requestDelete}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </TabPanel>
          ))}
        </Tabs>
      )}

      <ShoppingListDialog
        open={showCreateDialog}
        listTypes={listTypes}
        onClose={() => setShowCreateDialog(false)}
        onSave={handleCreate}
        returnFocusRef={createReturnFocusRef}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="מחיקת רשימת קניות"
        message={deleteTarget
          ? `הרשימה „${deleteTarget.title}” והפריטים שבה יימחקו. הפעולה אינה ניתנת לשחזור.`
          : ''}
        confirmLabel="מחיקת הרשימה"
        cancelLabel="ביטול"
        variant="destructive"
        errorMessage="מחיקת הרשימה נכשלה. הרשימה נשארה ללא שינוי."
        returnFocusRef={deleteReturnFocusRef}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
};

export default ShoppingLists;
