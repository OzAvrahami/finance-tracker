import React, { useEffect, useState, useMemo } from 'react';
import { getLegoSets, updateLegoSet } from '../services/api';
import { sortBySetNumber, calculateStats } from '../utils/legoHelpers';
import StatsDashboard from '../components/lego/StatsDashboard';
import CollectionFilters from '../components/lego/CollectionFilters';
import SetCard from '../components/lego/SetCard';

const LegoCollection = () => {
  const [sets, setSets] = useState([]);
  const [filterStatus, setFilterStatus] = useState('All');
  const [loading, setLoading] = useState(true);

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

  const stats = useMemo(() => calculateStats(sets), [sets]);

  const filteredSets = filterStatus === 'All'
    ? sets
    : sets.filter(s => s.status === filterStatus);

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center', fontSize: '1.2rem', color: '#666' }}>טוען אוסף... 🧱</div>;
  }

  return (
    <div dir="rtl">
      <div style={{ marginBottom: 24 }}>
        <p style={{ color: '#64748B', marginTop: 4, fontSize: 14 }}>ניהול מלאי, סטטוס בנייה ומעקב שווי</p>
      </div>

      <StatsDashboard stats={stats} />
      <CollectionFilters filterStatus={filterStatus} onFilterChange={setFilterStatus} />

      {filteredSets.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '25px' }}>
          {filteredSets.map(set => (
            <SetCard key={set.id} set={set} onStatusChange={handleStatusChange} onBrandChange={handleBrandChange} />
          ))}
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '50px', color: '#999', fontSize: '1.1rem' }}>
          לא נמצאו סטים תואמים לסינון
        </div>
      )}
    </div>
  );
};

export default LegoCollection;
