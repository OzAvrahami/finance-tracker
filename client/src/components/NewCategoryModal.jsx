import React from 'react';
import { inputStyle, modalOverlayStyle, modalContentStyle, cancelBtnStyle, saveModalBtnStyle } from '../pages/AddTransaction.styles';

const NewCategoryModal = ({ show, newCategoryName, setNewCategoryName, onSave, onClose }) => {
  if (!show) return null;

  return (
    <div style={modalOverlayStyle}>
      <div style={modalContentStyle}>
        <h3 style={{ marginTop: 0 }}>קטגוריה חדשה ✨</h3>
        <input
          type="text"
          placeholder="שם הקטגוריה..."
          value={newCategoryName}
          onChange={(e) => setNewCategoryName(e.target.value)}
          style={inputStyle}
          autoFocus
        />
        <div style={{ display: 'flex', gap: '10px', marginTop: '20px', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={cancelBtnStyle}>ביטול</button>
          <button type="button" onClick={onSave} style={saveModalBtnStyle}>שמור</button>
        </div>
      </div>
    </div>
  );
};

export default NewCategoryModal;
