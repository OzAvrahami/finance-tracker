import React, { useEffect, useState, useMemo, useContext } from 'react';
import { getLegoSets, updateLegoSet } from '../../services/api';
import { sortBySetNumber, calculateStats } from '../../utils/legoHelpers';
import StatsDashboard from '../../components/lego/StatsDashboard';
import CollectionFilters from '../../components/lego/CollectionFilters';
import SetCard from '../../components/lego/SetCard';
import AddLegoSetModal from '../../components/lego/AddLegoSetModal';
import { PageHeaderContext } from '../../context/PageHeaderContext';

const LegoCollection = () => {
  const [sets, setSets] = useState([]);
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterTheme, setFilterTheme] = useState('All');
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingSet, setEditingSet] = useState(null);

  const { setPageHeader } = useContext(PageHeaderContext)

  useEffect(() => {
    setPageHeader({
      title: 'אוסף לגו',
      subtitles: 'מעקב סטים ושווי האוסף',
    });
  }, [setPageHeader]);

  const loadSets = async () => {
    try {
      const response = await getLegoSets();
      setSets(sortBySetNumber(response.data));
    } catch (e) {
      console.error('Error loading lego sets', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadSets(); }, []);

  const handleStatusChange = async (id, newStatus) => {
    try {
      await updateLegoSet(id, { status: newStatus });
      loadSets();
    } catch (error) {
      alert('Error updating status');
    }
  };

  const handleBrandChange = async (id, newBrand) => {
    try {
      await updateLegoSet(id, { brand: newBrand });
      loadSets();
    } catch (error) {
      alert('Error updating brand');
    }
  };

  const handleEditSet = (set) => setEditingSet(set);

  const handleModalClose = () => {
    setShowAddModal(false);
    setEditingSet(null);
  };

  const handleSaved = () => {
    setShowAddModal(false);
    setEditingSet(null);
    loadSets();
  };

  const stats = useMemo(() => calculateStats(sets), [sets]);

  const themes = useMemo(() =>
    [...new Set(sets.map(s => s.theme).filter(Boolean))].sort(),
  [sets]);

  const filteredSets = sets
    .filter(s => filterStatus === 'All' || s.status === filterStatus)
    .filter(s => filterTheme === 'All' || s.theme === filterTheme);

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center', fontSize: '1.2rem', color: 'var(--ink-3)' }}>טוען אוסף... 🧱</div>;
  }

  return (
    <div dir="rtl">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <p style={{ color: 'var(--ink-4)', marginTop: 4, fontSize: 14 }}>ניהול מלאי, סטטוס בנייה ומעקב שווי</p>
        <button onClick={() => setShowAddModal(true)} style={addBtnStyle}>
          + הוסף סט לגו
        </button>
      </div>

      <AddLegoSetModal
        show={showAddModal || !!editingSet}
        initialData={editingSet}
        existingSets={sets}
        onClose={handleModalClose}
        onSave={handleSaved}
      />

      <StatsDashboard stats={stats} />
      <CollectionFilters
        filterStatus={filterStatus}
        onFilterChange={setFilterStatus}
        filterTheme={filterTheme}
        onThemeFilterChange={setFilterTheme}
        themes={themes}
      />

      {filteredSets.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '25px' }}>
          {filteredSets.map(set => (
            <SetCard
              key={set.id}
              set={set}
              onStatusChange={handleStatusChange}
              onBrandChange={handleBrandChange}
              onEdit={handleEditSet}
            />
          ))}
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '50px', color: 'var(--ink-4)', fontSize: '1.1rem' }}>
          לא נמצאו סטים תואמים לסינון
        </div>
      )}
    </div>
  );
};

const addBtnStyle = {
  background: 'var(--primary-grad)',
  color: 'var(--primary-ink)',
  border: 'none',
  borderRadius: 'var(--r-8)',
  padding: '9px 18px',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  boxShadow: '0 0 16px rgba(124,92,255,0.25)',
  whiteSpace: 'nowrap',
};

export default LegoCollection;
