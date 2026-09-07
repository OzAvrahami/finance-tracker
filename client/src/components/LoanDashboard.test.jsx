import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import LoansDashboard from './LoanDashboard';
import { nearestEndingLoan } from '../utils/loanDisplay';
import { currentBusinessDate, formatCalendarDate, isCalendarDate } from '../utils/calendarDate';

const loan = (id, end_date, extra = {}) => ({
  id, name: `הלוואה ${id}`, status: 'active', current_balance: '100.00', end_date, ...extra,
});

describe('nearest-ending active loan', () => {
  it('orders the complete portfolio by upcoming date, then ID, without mutating it', () => {
    const loans = [loan(10, '2026-10-01'), loan(9, '2026-09-09'), loan(2, '2026-09-09')];
    expect(nearestEndingLoan(loans, '2026-09-07').id).toBe(2);
    expect(nearestEndingLoan([...loans].reverse(), '2026-09-07').id).toBe(2);
    expect(loans.map(({ id }) => id)).toEqual([10, 9, 2]);
  });

  it('includes today and excludes yesterday', () => {
    expect(nearestEndingLoan([loan(1, '2026-09-06'), loan(2, '2026-09-07')], '2026-09-07').id).toBe(2);
    expect(nearestEndingLoan([loan(1, '2026-09-06')], '2026-09-07')).toBeNull();
  });

  it.each([null, undefined, '', 'not-a-date', '2026-02-29', '2026-13-01', '2026-04-31', '2026-09-07T00:00:00Z'])('excludes invalid/missing date %s', (date) => {
    expect(nearestEndingLoan([loan(1, date)], '2026-01-01')).toBeNull();
  });

  it.each([{ status: 'paid' }, { closed_date: '2026-09-01' }, { current_balance: 0 }, { current_balance: -1 }, { current_balance: null }])('excludes finished loans: %j', (extra) => {
    expect(nearestEndingLoan([loan(1, '2026-09-08', extra)], '2026-09-07')).toBeNull();
  });

  it('uses Jerusalem today even when the UTC day differs, and validates leap dates', () => {
    expect(currentBusinessDate(new Date('2026-09-06T22:30:00Z'))).toBe('2026-09-07');
    expect(isCalendarDate('2028-02-29')).toBe(true);
    expect(isCalendarDate('2100-02-29')).toBe(false);
    expect(formatCalendarDate('2028-02-29')).toBe('29/02/2028');
  });

  it('renders a Hebrew date and full loan name, then refreshes when loans change', () => {
    const fullName = 'הלוואה לשיפוץ הבית ולרכישת ציוד משפחתי עם שם ארוך במיוחד';
    const { rerender } = render(<LoansDashboard loans={[loan(1, '2099-09-08', { name: fullName })]} />);
    const insight = screen.getByRole('note', { name: 'ההלוואה הקרובה לסיום' });
    const summary = screen.getByRole('region', { name: 'סיכום תיק ההלוואות' });
    expect(within(summary).getAllByRole('article')).toHaveLength(4);
    expect(summary).not.toContainElement(insight);
    expect(summary.nextElementSibling).toBe(insight);
    expect(within(insight).getByText(fullName)).toBeInTheDocument();
    expect(within(insight).getByText('08/09/2099')).toHaveAttribute('dateTime', '2099-09-08');
    rerender(<LoansDashboard loans={[loan(2, '2099-09-07')]} />);
    expect(within(insight).getByText('הלוואה 2')).toBeInTheDocument();
    expect(screen.queryByText(fullName)).not.toBeInTheDocument();
    rerender(<LoansDashboard loans={[loan(2, '2099-09-07', { status: 'paid' })]} />);
    expect(screen.queryByRole('note', { name: 'ההלוואה הקרובה לסיום' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'סיכום תיק ההלוואות' }).querySelectorAll('article')).toHaveLength(4);
  });

  it('has no empty insight when there are no loans', () => {
    render(<LoansDashboard loans={[]} />);
    expect(screen.queryByRole('note', { name: 'ההלוואה הקרובה לסיום' })).not.toBeInTheDocument();
  });
});
