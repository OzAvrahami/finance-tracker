import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { TransactionsTable, TransactionsMobileList } from './TransactionsList';

const examples = [
  [0, 'expense', '₪0.00'], ['-0.000000', 'expense', '₪0.00'],
  ['6.0000000000000000', 'expense', '−₪6.00'], [-10, 'expense', '−₪10.00'],
  ['1234.56000000000000', 'expense', '−₪1,234.56'], ['19.75', 'income', '+₪19.75'],
  ['9007199254740993.010000', 'expense', '−₪9,007,199,254,740,993.01'],
  [null, 'expense', '—'], [undefined, 'expense', '—'], ['', 'expense', '—'], ['invalid', 'expense', '—'],
];
for (const [name, View] of [['desktop', TransactionsTable], ['mobile', TransactionsMobileList]]) describe(`${name} transaction money presentation`, () => {
  it.each(examples)('renders %s / %s without changing the financial value', (value, movement, expected) => {
    const row = {id:1, total_amount:value, movement_type:movement, description:'Test purchase',transaction_date:'2026-09-30', category_id:1, categories:{name:'Test'}, payment_sources:{name:'Test'}};
    render(<MemoryRouter><View rows={[row]} sortConfig={{key:'transaction_date',direction:'desc'}} onSort={vi.fn()} onRequestDelete={vi.fn()} /></MemoryRouter>);
    const amount=expected==='—' ? screen.getByLabelText('סכום לא זמין') : screen.getByText(expected);
    expect(amount).toHaveAttribute('dir','ltr'); expect(amount.tagName).toBe('BDI');
    expect(row.total_amount).toBe(value);
    if(expected==='—')expect(amount).toHaveAccessibleName('סכום לא זמין');
  });
});
