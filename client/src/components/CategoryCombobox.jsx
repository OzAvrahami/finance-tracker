import React, { useState, useEffect, useRef } from 'react';
import { inputStyle, categoryDropdownStyle, categoryOptionStyle } from './transactions/AddTransaction.styles';

const CategoryCombobox = ({ categories, selectedCategoryId, onSelect, onOpenNewModal }) => {
  const [search, setSearch] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const ref = useRef(null);

  const getCategoryDisplayText = (catId) => {
    const cat = categories.find(c => String(c.id) === String(catId));
    return cat ? `${cat.icon || ''} ${cat.name}`.trim() : '';
  };

  const filteredCategories = categories.filter(cat => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (cat.name || '').toLowerCase().includes(s) || (cat.icon || '').toLowerCase().includes(s);
  });

  // Sync search text when selectedCategoryId changes (auto-detect, edit mode)
  useEffect(() => {
    if (selectedCategoryId) {
      setSearch(getCategoryDisplayText(selectedCategoryId));
    } else {
      setSearch('');
    }
  }, [selectedCategoryId, categories]);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div style={{ display: 'flex', gap: '10px' }}>
      <div ref={ref} style={{ position: 'relative', flex: 1 }}>
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setShowDropdown(true);
            if (!e.target.value) {
              onSelect('');
            }
          }}
          onFocus={() => setShowDropdown(true)}
          placeholder="הקלד לחיפוש קטגוריה..."
          style={inputStyle}
          autoComplete="off"
        />
        {/* Hidden input for form validation */}
        <input type="hidden" name="category_id" value={selectedCategoryId} required />

        {showDropdown && (
          <div style={categoryDropdownStyle}>
            {filteredCategories.length > 0 ? (
              filteredCategories.map(cat => (
                <div
                  key={cat.id}
                  onClick={() => {
                    onSelect(cat.id);
                    setSearch(`${cat.icon || ''} ${cat.name}`.trim());
                    setShowDropdown(false);
                  }}
                  style={{
                    ...categoryOptionStyle,
                    backgroundColor: String(selectedCategoryId) === String(cat.id) ? 'var(--primary-soft)' : 'var(--surface-elev)'
                  }}
                >
                  {cat.icon} {cat.name}
                </div>
              ))
            ) : (
              <div style={{ padding: '10px', color: 'var(--ink-4)', textAlign: 'center' }}>
                לא נמצאו תוצאות
              </div>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onOpenNewModal}
        style={{
          ...inputStyle,
          width: '50px',
          backgroundColor: 'var(--primary-soft)',
          color: 'var(--primary-hi)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1.5rem',
          padding: '0'
        }}
        title="הוסף קטגוריה חדשה"
      >
        +
      </button>
    </div>
  );
};

export default CategoryCombobox;
