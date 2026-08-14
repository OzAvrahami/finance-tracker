import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLoanDetails } from '../../services/api';
import LoanDetailsModal from './LoanDetailsModal';

vi.mock('../../services/api', () => ({ getLoanDetails: vi.fn() }));

describe('LoanDetailsModal irregular payment history', () => {
  beforeEach(() => vi.resetAllMocks());

  it('labels catch-up and provider balance rows without fake installment numbers', async () => {
    const loan = {
      id: 20,
      name: 'הלוואת הפניקס',
      original_amount: '21000.00',
      current_balance: '20158.00',
      total_installments: 71,
      remaining_installments: 63,
      status: 'active',
    };
    getLoanDetails.mockResolvedValue({
      data: {
        loan,
        loan_payments: [
          {
            id: 1, payment_date: '2025-11-03', payment_kind: 'catch_up',
            installments_covered: 3, installment_number: null,
            payment_amount: '1097.00', principal_amount: '0', interest_amount: '0',
            other_amount: '1097.00', balance_adjustment_amount: '0',
            source_kind: 'reconstructed',
          },
          {
            id: 2, payment_date: '2026-04-30', payment_kind: 'balance_adjustment',
            installments_covered: 0, installment_number: null,
            payment_amount: '0', principal_amount: '0', interest_amount: '0',
            other_amount: '0', balance_adjustment_amount: '842.00',
            source_kind: 'reconstructed',
          },
        ],
        related_transactions: [],
      },
    });

    render(<LoanDetailsModal loan={loan} open onClose={() => {}} />);
    const modal = await screen.findByRole('dialog', { name: 'הלוואת הפניקס' });
    await waitFor(() => expect(getLoanDetails).toHaveBeenCalledWith(20));
    await userEvent.click(within(modal).getByRole('tab', { name: /לוח תשלומים/ }));

    expect(within(modal).getByText('השלמת פיגורים')).toBeInTheDocument();
    expect(within(modal).getByText('כיסה 3 תשלומים')).toBeInTheDocument();
    expect(within(modal).getByText('התאמת יתרה')).toBeInTheDocument();
    expect(within(modal).getByText('התאמת ספק ללא תנועת מזומן')).toBeInTheDocument();
    expect(within(modal).queryByText('/71', { exact: false })).not.toBeInTheDocument();
  });
});
