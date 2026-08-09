import { useRef } from 'react';
import { Button, Dialog, SecondaryButton, TextField } from './ui';

const NewCategoryModal = ({ show, newCategoryName, setNewCategoryName, onSave, onClose }) => {
  const inputRef = useRef(null);

  const handleSubmit = (event) => {
    event.preventDefault();
    onSave();
  };

  return (
    <Dialog
      open={show}
      onClose={onClose}
      title="קטגוריה חדשה"
      description="הקטגוריה תיבחר אוטומטית לאחר השמירה."
      initialFocusRef={inputRef}
      size="sm"
      footer={(
        <>
          <SecondaryButton type="button" onClick={onClose}>ביטול</SecondaryButton>
          <Button type="submit" form="new-category-form">שמירת קטגוריה</Button>
        </>
      )}
    >
      <form id="new-category-form" onSubmit={handleSubmit}>
        <TextField
          ref={inputRef}
          label="שם הקטגוריה"
          value={newCategoryName}
          onValueChange={setNewCategoryName}
          placeholder="לדוגמה: לימודים"
          required
        />
      </form>
    </Dialog>
  );
};

export default NewCategoryModal;
