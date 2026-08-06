import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import CategoryCombobox from './CategoryCombobox';

const categories = [
  { id: 1, name: 'מזון וסופר', icon: '🛒', type: 'expense' },
  { id: 2, name: 'Salary', icon: '💰', type: 'income' },
  { id: 3, name: 'תחבורה', icon: '🚌', type: 'expense' },
  { id: 4, name: 'מושבתת', icon: '⛔', type: 'expense', disabled: true },
];

const ControlledHarness = ({ initialValue = '', initialCategories = categories, onOpenNewModal }) => {
  const [value, setValue] = useState(initialValue);
  return (
    <>
      <CategoryCombobox
        label="קטגוריה"
        categories={initialCategories}
        selectedCategoryId={value}
        onSelect={setValue}
        onOpenNewModal={onOpenNewModal}
      />
      <output data-testid="selected-category">{value}</output>
      <button type="button">אחרי הקומבובוקס</button>
    </>
  );
};

describe('CategoryCombobox semantics', () => {
  it('associates a visible Field label and exposes the combobox/listbox contract', async () => {
    const user = userEvent.setup();
    render(
      <CategoryCombobox
        label="קטגוריה"
        helperText="בחרו קטגוריה"
        error="נדרשת קטגוריה"
        required
        categories={categories}
        selectedCategoryId={1}
        onSelect={() => {}}
      />,
    );

    const input = screen.getByRole('combobox', { name: 'קטגוריה' });
    expect(input).toBeRequired();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('בחרו קטגוריה נדרשת קטגוריה');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    expect(input).toHaveAttribute('aria-expanded', 'false');

    await user.click(input);
    const listbox = screen.getByRole('listbox');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-controls', listbox.id);
    const selected = screen.getByRole('option', { name: 'מזון וסופר' });
    expect(selected).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', selected.id);
  });

  it('supports a contextual accessible name when a visible label is not appropriate', () => {
    render(
      <CategoryCombobox
        ariaLabel="קטגוריה עבור קנייה"
        categories={categories}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'קטגוריה עבור קנייה' })).toBeInTheDocument();
  });

  it('exposes disabled and empty-result states', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <CategoryCombobox label="קטגוריה" disabled categories={categories} onSelect={() => {}} />,
    );
    const disabledInput = screen.getByRole('combobox', { name: 'קטגוריה' });
    expect(disabledInput).toBeDisabled();
    await user.click(disabledInput);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    rerender(<CategoryCombobox label="קטגוריה" categories={[]} onSelect={() => {}} />);
    await user.click(screen.getByRole('combobox', { name: 'קטגוריה' }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByText('לא נמצאו תוצאות')).toHaveAttribute('role', 'status');
  });

  it('announces the bounded category-loading state', async () => {
    const user = userEvent.setup();
    render(<CategoryCombobox label="קטגוריה" loading categories={[]} onSelect={() => {}} />);
    await user.click(screen.getByRole('combobox', { name: 'קטגוריה' }));
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('טוען קטגוריות...');
  });
});

describe('CategoryCombobox keyboard and focus behavior', () => {
  it('opens with ArrowDown and navigates enabled options vertically', async () => {
    const user = userEvent.setup();
    render(<ControlledHarness />);
    const input = screen.getByRole('combobox', { name: 'קטגוריה' });
    await user.click(input);
    await user.keyboard('{Escape}');
    expect(input).toHaveAttribute('aria-expanded', 'false');

    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'מזון וסופר' }).id);
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Salary' }).id);
    await user.keyboard('{ArrowUp}');
    expect(input).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'מזון וסופר' }).id);
  });

  it('opens ArrowUp at the final enabled option and supports Home and End', async () => {
    const user = userEvent.setup();
    render(<ControlledHarness />);
    const input = screen.getByRole('combobox', { name: 'קטגוריה' });
    await user.click(input);
    await user.keyboard('{Escape}{ArrowUp}');
    expect(input).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'תחבורה' }).id);
    await user.keyboard('{Home}');
    expect(input).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'מזון וסופר' }).id);
    await user.keyboard('{End}');
    expect(input).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'תחבורה' }).id);
    expect(screen.getByRole('option', { name: 'מושבתת' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('selects with Enter without submitting the surrounding form', async () => {
    const onSubmit = vi.fn((event) => event.preventDefault());
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <form onSubmit={onSubmit}>
        <CategoryCombobox label="קטגוריה" categories={categories} onSelect={onSelect} />
      </form>,
    );
    const input = screen.getByRole('combobox', { name: 'קטגוריה' });
    await user.click(input);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledWith(2);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveFocus();
  });

  it('closes and restores the selected text with Escape', async () => {
    const user = userEvent.setup();
    render(<ControlledHarness initialValue={1} />);
    const input = screen.getByRole('combobox', { name: 'קטגוריה' });
    await user.click(input);
    fireEvent.change(input, { target: { value: 'טקסט זמני' } });
    await user.keyboard('{Escape}');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveValue('🛒 מזון וסופר');
  });

  it('allows Tab to move through the normal focus order without trapping focus', async () => {
    const user = userEvent.setup();
    render(<ControlledHarness />);
    const input = screen.getByRole('combobox', { name: 'קטגוריה' });
    await user.click(input);
    await user.tab();
    expect(screen.getByRole('button', { name: 'אחרי הקומבובוקס' })).toHaveFocus();
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on an outside pointer interaction', async () => {
    const user = userEvent.setup();
    render(<ControlledHarness />);
    const input = screen.getByRole('combobox', { name: 'קטגוריה' });
    await user.click(input);
    fireEvent.pointerDown(document.body);
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('CategoryCombobox filtering and selection', () => {
  it('filters Hebrew and English category text case-insensitively', async () => {
    const user = userEvent.setup();
    render(<ControlledHarness />);
    const input = screen.getByRole('combobox', { name: 'קטגוריה' });

    await user.type(input, 'סופר');
    expect(screen.getByRole('option', { name: 'מזון וסופר' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Salary' })).not.toBeInTheDocument();

    await user.clear(input);
    await user.type(input, 'sAL');
    expect(screen.getByRole('option', { name: 'Salary' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'מזון וסופר' })).not.toBeInTheDocument();
  });

  it('filters category type without mutating the supplied category array', async () => {
    const original = [...categories];
    const user = userEvent.setup();
    render(
      <CategoryCombobox
        label="קטגוריה"
        categories={categories}
        categoryType="expense"
        onSelect={() => {}}
      />,
    );
    await user.click(screen.getByRole('combobox', { name: 'קטגוריה' }));
    expect(screen.queryByRole('option', { name: 'Salary' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'תחבורה' })).toBeInTheDocument();
    expect(categories).toEqual(original);
  });

  it('preserves ID-valued selection, selected display, changing, and clearing', async () => {
    const user = userEvent.setup();
    render(<ControlledHarness initialValue={1} />);
    const input = screen.getByRole('combobox', { name: 'קטגוריה' });
    expect(input).toHaveValue('🛒 מזון וסופר');

    await user.click(input);
    await user.clear(input);
    expect(screen.getByTestId('selected-category')).toHaveTextContent('');
    await user.type(input, 'Salary');
    await user.click(screen.getByRole('option', { name: 'Salary' }));
    expect(screen.getByTestId('selected-category')).toHaveTextContent('2');
    expect(input).toHaveValue('💰 Salary');
  });

  it('opens the full list for an existing selection and permits changing it directly', async () => {
    const user = userEvent.setup();
    render(<ControlledHarness initialValue={1} />);
    const input = screen.getByRole('combobox', { name: 'קטגוריה' });
    await user.click(input);
    expect(screen.getByRole('option', { name: 'Salary' })).toBeInTheDocument();
    expect(input).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option', { name: 'מזון וסופר' }).id,
    );
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.getByTestId('selected-category')).toHaveTextContent('2');
  });

  it('selects with the pointer while retaining input focus', async () => {
    const user = userEvent.setup();
    render(<ControlledHarness />);
    const input = screen.getByRole('combobox', { name: 'קטגוריה' });
    await user.click(input);
    await user.click(screen.getByRole('option', { name: 'תחבורה' }));
    expect(screen.getByTestId('selected-category')).toHaveTextContent('3');
    expect(input).toHaveFocus();
  });
});

describe('CategoryCombobox inline category creation', () => {
  it('offers the typed category name as a distinct semantic action', async () => {
    const onOpenNewModal = vi.fn();
    const user = userEvent.setup();
    render(<ControlledHarness onOpenNewModal={onOpenNewModal} />);
    const input = screen.getByRole('combobox', { name: 'קטגוריה' });
    await user.type(input, 'מזון בריא');
    const create = screen.getByRole('button', { name: 'יצירת קטגוריה ״מזון בריא״' });
    expect(create).not.toHaveAttribute('role', 'option');
    await user.click(create);
    expect(onOpenNewModal).toHaveBeenCalledWith('מזון בריא');
  });

  it('does not offer duplicate creation for an existing category name', async () => {
    const user = userEvent.setup();
    render(<ControlledHarness onOpenNewModal={() => {}} />);
    const input = screen.getByRole('combobox', { name: 'קטגוריה' });
    await user.type(input, 'sALarY');
    expect(screen.queryByRole('button', { name: /יצירת קטגוריה/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Salary' })).toBeInTheDocument();
  });

  it('activates creation by keyboard only when no category option is active', async () => {
    const onOpenNewModal = vi.fn();
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <CategoryCombobox
        label="קטגוריה"
        categories={categories}
        onSelect={onSelect}
        onOpenNewModal={onOpenNewModal}
      />,
    );
    const input = screen.getByRole('combobox', { name: 'קטגוריה' });
    await user.type(input, 'חדשה לגמרי');
    await user.keyboard('{Enter}');
    expect(onOpenNewModal).toHaveBeenCalledWith('חדשה לגמרי');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('selects an active existing option instead of accidentally creating', async () => {
    const onOpenNewModal = vi.fn();
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <CategoryCombobox
        label="קטגוריה"
        categories={categories}
        onSelect={onSelect}
        onOpenNewModal={onOpenNewModal}
      />,
    );
    const input = screen.getByRole('combobox', { name: 'קטגוריה' });
    await user.type(input, 'מזון');
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(1);
    expect(onOpenNewModal).not.toHaveBeenCalled();
  });
});

describe('CategoryCombobox controlled and consumer contracts', () => {
  it('represents a selected edit category after categories load asynchronously', async () => {
    const user = userEvent.setup();
    const Harness = () => {
      const [loadedCategories, setLoadedCategories] = useState([]);
      return (
        <>
          <CategoryCombobox
            label="קטגוריה"
            categories={loadedCategories}
            selectedCategoryId={2}
            onSelect={() => {}}
          />
          <button type="button" onClick={() => setLoadedCategories(categories)}>טעינה</button>
        </>
      );
    };
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'קטגוריה' });
    expect(input).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'טעינה' }));
    expect(input).toHaveValue('💰 Salary');
  });

  it('responds to external selection changes and form reset without derived-state loops', async () => {
    const user = userEvent.setup();
    const Harness = () => {
      const [value, setValue] = useState(1);
      return (
        <>
          <CategoryCombobox label="קטגוריה" categories={categories} selectedCategoryId={value} onSelect={setValue} />
          <button type="button" onClick={() => setValue(2)}>שינוי חיצוני</button>
          <button type="button" onClick={() => setValue('')}>איפוס</button>
        </>
      );
    };
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'קטגוריה' });
    await user.click(screen.getByRole('button', { name: 'שינוי חיצוני' }));
    expect(input).toHaveValue('💰 Salary');
    await user.click(screen.getByRole('button', { name: 'איפוס' }));
    expect(input).toHaveValue('');
  });

  it('does not invent a label or mutate the value when a selected category becomes unavailable', () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <CategoryCombobox
        label="קטגוריה"
        categories={categories}
        selectedCategoryId={1}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'קטגוריה' })).toHaveValue('🛒 מזון וסופר');
    rerender(
      <CategoryCombobox
        label="קטגוריה"
        categories={categories.filter((category) => category.id !== 1)}
        selectedCategoryId={1}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'קטגוריה' })).toHaveValue('');
    expect(screen.getByDisplayValue('1')).toHaveAttribute('name', 'category_id');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('keeps independent import-row instances and IDs isolated', async () => {
    const user = userEvent.setup();
    const ImportRows = () => {
      const [rows, setRows] = useState([{ id: 'a', categoryId: '' }, { id: 'b', categoryId: '' }]);
      const assign = (rowId, categoryId) => setRows((current) => current.map(
        (row) => row.id === rowId ? { ...row, categoryId } : row,
      ));
      return rows.map((row) => (
        <div key={row.id}>
          <CategoryCombobox
            ariaLabel={`קטגוריה לשורה ${row.id}`}
            categories={categories}
            selectedCategoryId={row.categoryId}
            onSelect={(categoryId) => assign(row.id, categoryId)}
          />
          <output data-testid={`row-${row.id}`}>{row.categoryId}</output>
        </div>
      ));
    };
    render(<ImportRows />);
    const first = screen.getByRole('combobox', { name: 'קטגוריה לשורה a' });
    const second = screen.getByRole('combobox', { name: 'קטגוריה לשורה b' });
    expect(first).not.toHaveAttribute('aria-controls', second.getAttribute('aria-controls'));

    await user.click(first);
    const firstListboxId = first.getAttribute('aria-controls');
    await user.click(within(document.getElementById(firstListboxId)).getByRole('option', { name: 'מזון וסופר' }));
    expect(screen.getByTestId('row-a')).toHaveTextContent('1');
    expect(screen.getByTestId('row-b')).toHaveTextContent('');

    await user.click(second);
    expect(second.getAttribute('aria-controls')).not.toBe(firstListboxId);
    expect(first).toHaveAttribute('aria-expanded', 'false');
  });

  it('preserves the Add/Edit transaction category-ID callback shape', async () => {
    const user = userEvent.setup();
    const TransactionForm = () => {
      const [transaction, setTransaction] = useState({ category_id: 1 });
      return (
        <>
          <CategoryCombobox
            label="קטגוריה"
            categories={categories}
            selectedCategoryId={transaction.category_id}
            onSelect={(categoryId) => setTransaction((current) => ({ ...current, category_id: categoryId }))}
          />
          <output data-testid="transaction-category">{transaction.category_id}</output>
        </>
      );
    };
    render(<TransactionForm />);
    const input = screen.getByRole('combobox', { name: 'קטגוריה' });
    expect(input).toHaveValue('🛒 מזון וסופר');
    await user.click(input);
    await user.clear(input);
    await user.type(input, 'תחבורה');
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('transaction-category')).toHaveTextContent('3');
  });

  it('preserves row-targeted Import creation callbacks and the typed name', async () => {
    const user = userEvent.setup();
    const ImportCreation = () => {
      const [target, setTarget] = useState('');
      return (
        <>
          {['a', 'b'].map((rowId) => (
            <CategoryCombobox
              key={rowId}
              ariaLabel={`קטגוריה לשורה ${rowId}`}
              categories={categories}
              onSelect={() => {}}
              onOpenNewModal={(categoryName) => setTarget(`${rowId}:${categoryName}`)}
            />
          ))}
          <output data-testid="creation-target">{target}</output>
        </>
      );
    };
    render(<ImportCreation />);
    const second = screen.getByRole('combobox', { name: 'קטגוריה לשורה b' });
    await user.type(second, 'כלי עבודה');
    await user.click(screen.getByRole('button', { name: 'יצירת קטגוריה ״כלי עבודה״' }));
    expect(screen.getByTestId('creation-target')).toHaveTextContent('b:כלי עבודה');
  });
});
