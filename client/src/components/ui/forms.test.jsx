import { createRef, useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Field from './Field';
import TextField from './TextField';
import TextArea from './TextArea';
import DateField from './DateField';
import NumberField from './NumberField';
import Select from './Select';
import SearchField from './SearchField';
import FileUpload from './FileUpload';

describe('Field foundation', () => {
  it('associates a visible label with a generated input ID', () => {
    render(<TextField label="שם" />);
    const input = screen.getByRole('textbox', { name: 'שם' });
    expect(input.id).toMatch(/^field-/);
    expect(screen.getByText('שם')).toHaveAttribute('for', input.id);
  });

  it('associates helper and error messages and exposes invalid state', () => {
    render(<TextField label="שם" helperText="טקסט עזר" error="ערך שגוי" />);
    const input = screen.getByRole('textbox', { name: 'שם' });
    const describedBy = input.getAttribute('aria-describedby').split(' ');
    expect(describedBy).toContain(screen.getByText('טקסט עזר').id);
    expect(describedBy).toContain(screen.getByText('ערך שגוי').id);
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('passes required, disabled, and read-only states without owning validation', () => {
    render(
      <>
        <TextField label="חובה" required disabled />
        <TextField label="לקריאה" readOnly defaultValue="קבוע" />
      </>,
    );
    const required = screen.getByRole('textbox', { name: 'חובה' });
    expect(required).toBeRequired();
    expect(required).toBeDisabled();
    expect(required).toHaveAttribute('aria-required', 'true');
    expect(screen.getByRole('textbox', { name: 'לקריאה' })).toHaveAttribute('readonly');
  });

  it('renders prefix, suffix, leading, and trailing slots', () => {
    render(
      <TextField
        label="סכום"
        prefix="₪"
        suffix="ILS"
        leading={<span>לפני</span>}
        trailing={<span>אחרי</span>}
      />,
    );
    ['₪', 'ILS', 'לפני', 'אחרי'].forEach((text) => expect(screen.getByText(text)).toBeInTheDocument());
  });

  it('allows direct Field composition with the same accessible contract', () => {
    render(
      <Field label="שדה מותאם" required successMessage="תקין">
        {({ controlId, ariaProps }) => <input id={controlId} {...ariaProps} required />}
      </Field>,
    );
    expect(screen.getByRole('textbox', { name: 'שדה מותאם' })).toHaveAccessibleDescription('תקין');
  });

  it('gives an error precedence over a stale success message', () => {
    render(<TextField label="שדה" error="שגיאה" successMessage="תקין" />);
    const input = screen.getByRole('textbox', { name: 'שדה' });
    expect(input).toHaveAccessibleDescription('שגיאה');
    expect(screen.queryByText('תקין')).not.toBeInTheDocument();
    expect(input.closest('.ui-field')).not.toHaveClass('is-success');
  });
});

describe('TextField and TextArea', () => {
  it('supports controlled text input and value callbacks', async () => {
    const Harness = () => {
      const [value, setValue] = useState('');
      return <TextField label="תיאור" value={value} onValueChange={setValue} />;
    };
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole('textbox', { name: 'תיאור' }), 'בדיקה');
    expect(screen.getByRole('textbox', { name: 'תיאור' })).toHaveValue('בדיקה');
  });

  it('isolates explicitly technical email input as LTR', () => {
    render(<TextField type="email" label="דוא״ל" technicalLtr />);
    expect(screen.getByRole('textbox', { name: 'דוא״ל' })).toHaveAttribute('dir', 'ltr');
    expect(screen.getByRole('textbox', { name: 'דוא״ל' })).toHaveClass('u-technical-ltr');
  });

  it('forwards the native input ref', () => {
    const ref = createRef();
    render(<TextField ref={ref} label="שדה" />);
    expect(ref.current).toBe(screen.getByRole('textbox', { name: 'שדה' }));
  });

  it('counts textarea characters and preserves mixed-direction user content', async () => {
    const user = userEvent.setup();
    render(<TextArea label="הערות" showCharacterCount maxLength={20} />);
    const textarea = screen.getByRole('textbox', { name: 'הערות' });
    await user.type(textarea, 'שלום ABC');
    expect(textarea).toHaveAttribute('dir', 'auto');
    expect(textarea).toHaveClass('u-user-content');
    expect(screen.getByText('8 / 20')).toBeInTheDocument();
  });
});

describe('DateField and NumberField', () => {
  it('keeps native date behavior and technical LTR direction', () => {
    render(<DateField label="תאריך" min="2026-01-01" max="2026-12-31" />);
    const input = screen.getByLabelText('תאריך');
    expect(input).toHaveAttribute('type', 'date');
    expect(input).toHaveAttribute('dir', 'ltr');
    expect(input).toHaveAttribute('min', '2026-01-01');
    expect(input).toHaveAttribute('max', '2026-12-31');
  });

  it('passes numeric constraints and preserves decimal strings without rounding', () => {
    const onValueChange = vi.fn();
    render(
      <NumberField
        label="סכום"
        min="0"
        max="9999.99"
        step="0.01"
        prefix="₪"
        suffix="ILS"
        onValueChange={onValueChange}
      />,
    );
    const input = screen.getByRole('spinbutton', { name: 'סכום' });
    fireEvent.change(input, { target: { value: '1234.50' } });
    expect(onValueChange).toHaveBeenLastCalledWith('1234.50');
    expect(input).toHaveAttribute('step', '0.01');
    expect(input).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText('₪')).toBeInTheDocument();
    expect(screen.getByText('ILS')).toBeInTheDocument();
  });

  it('associates numeric errors with the native input', () => {
    render(<NumberField label="אחוז" suffix="%" error="מחוץ לטווח" />);
    expect(screen.getByRole('spinbutton', { name: 'אחוז' })).toHaveAccessibleDescription('מחוץ לטווח');
  });
});

describe('Select and SearchField', () => {
  it('supports labels, placeholders, required selection, and change callbacks', async () => {
    const onValueChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Select label="סוג" placeholder="בחירה" required onValueChange={onValueChange} defaultValue="">
        <option value="expense">הוצאה</option>
        <option value="income">הכנסה</option>
      </Select>,
    );
    const select = screen.getByRole('combobox', { name: 'סוג' });
    expect(within(select).getByRole('option', { name: 'בחירה' })).toHaveValue('');
    expect(select).toBeRequired();
    await user.selectOptions(select, 'income');
    expect(onValueChange).toHaveBeenCalledWith('income');
  });

  it('disables a loading native Select and exposes busy state', () => {
    render(
      <Select label="טוען" loading>
        <option value="a">א</option>
      </Select>,
    );
    const select = screen.getByRole('combobox', { name: 'טוען' });
    expect(select).toBeDisabled();
    expect(select).toHaveAttribute('aria-busy', 'true');
    expect(document.querySelector('.ui-field-spinner')).toBeInTheDocument();
  });

  it('clears controlled search through its named button and returns focus', async () => {
    const Harness = () => {
      const [value, setValue] = useState('חיפוש');
      return <SearchField label="חיפוש" value={value} onValueChange={setValue} />;
    };
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('searchbox', { name: 'חיפוש' });
    await user.click(screen.getByRole('button', { name: 'ניקוי החיפוש' }));
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
  });

  it('clears search with Escape only while the search field owns focus', async () => {
    const Harness = () => {
      const [value, setValue] = useState('abc');
      return <SearchField label="חיפוש" value={value} onValueChange={setValue} loading />;
    };
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('searchbox', { name: 'חיפוש' });
    input.focus();
    await user.keyboard('{Escape}');
    expect(input).toHaveValue('');
    expect(document.querySelector('.ui-field-spinner')).toBeInTheDocument();
  });
});

describe('FileUpload', () => {
  it('passes native file constraints and presents selected file metadata with LTR isolation', async () => {
    const user = userEvent.setup();
    render(<FileUpload label="קובץ" accept=".csv,.xlsx" multiple />);
    const input = screen.getByLabelText('קובץ');
    const file = new File(['x'.repeat(1536)], 'statement-2026.csv', { type: 'text/csv' });
    await user.upload(input, file);
    expect(input).toHaveAttribute('accept', '.csv,.xlsx');
    expect(input).toHaveAttribute('multiple');
    expect(screen.getByText('statement-2026.csv')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText('1.5 KB')).toHaveAttribute('dir', 'ltr');
  });

  it('removes a selected file through an accessible action', async () => {
    const user = userEvent.setup();
    render(<FileUpload label="קובץ" />);
    const file = new File(['data'], 'data.csv', { type: 'text/csv' });
    await user.upload(screen.getByLabelText('קובץ'), file);
    await user.click(screen.getByRole('button', { name: 'הסרת data.csv' }));
    expect(screen.queryByText('data.csv')).not.toBeInTheDocument();
  });

  it('accepts drag-and-drop enhancement without parsing the file', () => {
    const onFilesChange = vi.fn();
    render(<FileUpload label="קובץ" onFilesChange={onFilesChange} />);
    const file = new File(['raw'], 'raw.xls', { type: 'application/vnd.ms-excel' });
    const dropzone = document.querySelector('.ui-file-dropzone');
    fireEvent.dragEnter(dropzone, { dataTransfer: { files: [file] } });
    expect(dropzone).toHaveClass('is-dragging');
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
    expect(onFilesChange).toHaveBeenCalledWith([file]);
    expect(screen.getByText('raw.xls')).toBeInTheDocument();
  });

  it('prevents selection and dropped-file changes while disabled', () => {
    const onFilesChange = vi.fn();
    render(<FileUpload label="קובץ" disabled onFilesChange={onFilesChange} />);
    const file = new File(['raw'], 'raw.csv', { type: 'text/csv' });
    expect(screen.getByLabelText('קובץ')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'בחירת קובץ' })).toBeDisabled();
    fireEvent.drop(document.querySelector('.ui-file-dropzone'), { dataTransfer: { files: [file] } });
    expect(onFilesChange).not.toHaveBeenCalled();
  });
});
