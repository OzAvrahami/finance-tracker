const supabase = require('../config/supabase');
const axios = require('axios');

const CREATE_INTEREST_TYPES = new Set(['fixed', 'prime']);
const CREATE_INDEXATION_TYPES = new Set(['none', 'cpi']);

const isIsoDate = (value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const requiredNumber = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

exports.getAllLoans = async (req, res) => {
    try {
        const { data: loans, error: loansError } = await supabase
            .from('loans')
            .select('*')
            .order('current_balance', { ascending: false});
        if (loansError) throw loansError;

        if (!loans?.length) return res.status(200).json([]);

        const { data: paymentKinds, error: paymentsError } = await supabase
            .from('loan_payments')
            .select('loan_id, payment_kind, installments_covered')
            .in('loan_id', loans.map((loan) => loan.id));
        if (paymentsError) throw paymentsError;

        const summaries = new Map(loans.map((loan) => [Number(loan.id), {
            regular_payment_count: 0,
            has_early_payoff: false,
        }]));

        (paymentKinds || []).forEach((payment) => {
            const summary = summaries.get(Number(payment.loan_id));
            if (!summary) return;
            if (payment.payment_kind === 'installment' || payment.payment_kind === 'catch_up') {
                summary.regular_payment_count += Number(
                    payment.installments_covered
                    ?? (payment.payment_kind === 'installment' ? 1 : 0),
                );
            }
            if (payment.payment_kind === 'early_payoff') summary.has_early_payoff = true;
        });

        return res.status(200).json(loans.map((loan) => ({
            ...loan,
            ...summaries.get(Number(loan.id)),
        })));
    } catch (error) {
        return res.status(400).json({ error: error.message});
    }
};

exports.getLoanDetails = async (req, res) => {
    try {
        if (!/^\d+$/.test(String(req.params.id))) {
            return res.status(400).json({ error: 'Invalid loan id' });
        }

        const loanId = Number(req.params.id);
        const { data: loan, error: loanError } = await supabase
            .from('loans')
            .select('*, payment_source:payment_sources(id, name, method, last4)')
            .eq('id', loanId)
            .maybeSingle();

        if (loanError) throw loanError;
        if (!loan) return res.status(404).json({ error: 'Loan not found' });

        const [paymentsResult, transactionsResult] = await Promise.all([
            supabase
                .from('loan_payments')
                .select('*')
                .eq('loan_id', loanId)
                .order('payment_date', { ascending: true })
                .order('id', { ascending: true }),
            supabase
                .from('transactions')
                .select(`
                    *,
                    category:categories(id, name),
                    payment_source:payment_sources(id, name, method, last4)
                `)
                .eq('loan_id', loanId)
                .order('charge_date', { ascending: true })
                .order('id', { ascending: true }),
        ]);

        if (paymentsResult.error) throw paymentsResult.error;
        if (transactionsResult.error) throw transactionsResult.error;

        return res.status(200).json({
            loan,
            loan_payments: paymentsResult.data || [],
            related_transactions: transactionsResult.data || [],
        });
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
};

exports.createLoan = async (req, res) => {
    try {
        const input = req.body || {};
        const name = typeof input.name === 'string' ? input.name.trim() : '';
        const lenderName = typeof input.lender_name === 'string' ? input.lender_name.trim() : '';
        const originalAmount = requiredNumber(input.original_amount);
        const totalInstallments = requiredNumber(input.total_installments);
        const monthlyPayment = requiredNumber(input.monthly_payment);
        const interestRate = requiredNumber(input.interest_rate);
        const interestType = input.interest_type;
        const primeMargin = interestType === 'prime' ? requiredNumber(input.prime_margin) : 0;
        const indexationType = input.indexation_type ?? 'none';
        const baseIndexSupplied = input.base_index !== undefined
            && input.base_index !== null
            && input.base_index !== '';
        const baseIndex = baseIndexSupplied ? requiredNumber(input.base_index) : null;
        const autoPaymentEnabled = input.auto_payment_enabled === undefined
            ? true
            : input.auto_payment_enabled;
        const paymentSourceId = input.payment_source_id === '' || input.payment_source_id === null
            || input.payment_source_id === undefined
            ? null
            : (typeof input.payment_source_id === 'number' || typeof input.payment_source_id === 'string'
                ? Number(input.payment_source_id)
                : Number.NaN);
        const nextPaymentDate = input.next_payment_date || null;
        const endDate = input.end_date || null;

        if (!name) return res.status(400).json({ error: 'Loan name is required' });
        if (originalAmount === null || originalAmount <= 0) {
            return res.status(400).json({ error: 'Original amount must be greater than zero' });
        }
        if (!Number.isInteger(totalInstallments) || totalInstallments <= 0) {
            return res.status(400).json({ error: 'Total installments must be a positive integer' });
        }
        if (monthlyPayment === null || monthlyPayment <= 0) {
            return res.status(400).json({ error: 'Monthly payment must be greater than zero' });
        }
        if (!CREATE_INTEREST_TYPES.has(interestType)) {
            return res.status(400).json({ error: 'Interest type must be fixed or prime' });
        }
        if (interestRate === null || interestRate < 0) {
            return res.status(400).json({ error: 'Interest rate must be zero or greater' });
        }
        if (interestType === 'prime' && primeMargin === null) {
            return res.status(400).json({ error: 'Prime margin is required for a prime-rate loan' });
        }
        if (!CREATE_INDEXATION_TYPES.has(indexationType)) {
            return res.status(400).json({ error: 'Indexation type must be none or cpi' });
        }
        if (baseIndexSupplied && (baseIndex === null || baseIndex <= 0)) {
            return res.status(400).json({ error: 'Base index must be greater than zero when supplied' });
        }
        if (!isIsoDate(input.start_date)) {
            return res.status(400).json({ error: 'Start date must be a valid YYYY-MM-DD date' });
        }
        if (endDate && !isIsoDate(endDate)) {
            return res.status(400).json({ error: 'Planned end date must be a valid YYYY-MM-DD date' });
        }
        if (nextPaymentDate && !isIsoDate(nextPaymentDate)) {
            return res.status(400).json({ error: 'Next payment date must be a valid YYYY-MM-DD date' });
        }
        if (endDate && endDate < input.start_date) {
            return res.status(400).json({ error: 'Planned end date cannot precede the start date' });
        }
        if (nextPaymentDate && nextPaymentDate < input.start_date) {
            return res.status(400).json({ error: 'Next payment date cannot precede the start date' });
        }
        if (typeof autoPaymentEnabled !== 'boolean') {
            return res.status(400).json({ error: 'Automatic payment must be a boolean' });
        }
        if (indexationType === 'cpi' && autoPaymentEnabled) {
            return res.status(400).json({
                error: 'Automatic payment is not supported for CPI-indexed loans',
            });
        }
        if (paymentSourceId !== null && (!Number.isInteger(paymentSourceId) || paymentSourceId <= 0)) {
            return res.status(400).json({ error: 'Payment source id must be a positive integer' });
        }
        if (autoPaymentEnabled && paymentSourceId === null) {
            return res.status(400).json({ error: 'Payment source is required when automatic payment is enabled' });
        }
        if (autoPaymentEnabled && !nextPaymentDate) {
            return res.status(400).json({ error: 'Next payment date is required when automatic payment is enabled' });
        }

        if (paymentSourceId !== null) {
            const { data: paymentSource, error: paymentSourceError } = await supabase
                .from('payment_sources')
                .select('id')
                .eq('id', paymentSourceId)
                .eq('is_active', true)
                .maybeSingle();
            if (paymentSourceError) throw paymentSourceError;
            if (!paymentSource) {
                return res.status(400).json({ error: 'Payment source was not found or is inactive' });
            }
        }

        // Creation is intentionally limited to a new, active Spitzer loan. Historical
        // state and compatibility-mode fields are server owned and cannot be supplied
        // by a client through this endpoint.
        const loanData = {
            name,
            lender_name: lenderName || null,
            loan_type: 'bank_loan',
            original_amount: originalAmount,
            current_balance: originalAmount,
            monthly_payment: monthlyPayment,
            interest_rate: interestRate,
            total_installments: totalInstallments,
            remaining_installments: totalInstallments,
            start_date: input.start_date,
            end_date: endDate,
            status: 'active',
            amortization_type: 'spitzer',
            interest_type: interestType,
            prime_margin: primeMargin,
            indexation_type: indexationType,
            base_index: baseIndex,
            calculation_mode: 'loan_payments',
            next_payment_date: nextPaymentDate,
            payment_source_id: paymentSourceId,
            auto_payment_enabled: autoPaymentEnabled,
            closed_date: null,
        };

        const {data, error} = await supabase.from('loans').insert([loanData]).select();

        if (error) throw error;
        res.status(200).json(data[0]);
    } catch (error) {
        res.status(400).json({ error: error.message});
    }
};
