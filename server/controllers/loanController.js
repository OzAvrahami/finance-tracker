const supabase = require('../config/supabase');
const axios = require('axios');

exports.getAllLoans = async (req, res) => {
    try {
        const {data, error} = await supabase
            .from('loans')
            .select('*, loan_payments(payment_kind, installment_number, payment_date)')
            .order('current_balance', { ascending: false});
        if (error) throw error;
        res.status(200).json(data);
    } catch (error) {
        res.status(400).json({ error: error.message});
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
        const loanData = req.body;
        if (!loanData.name || !loanData.original_amount) {
            return res.status(400).json({ error: 'Name and original amount are required'});
        }

        // The database default intentionally remains `legacy` so migration 008
        // cannot change historical loans. New loans created through the product
        // always opt into the authoritative loan_payments accounting model.
        // Put the server-owned value after the request payload so clients cannot
        // select compatibility mode themselves.
        const {data, error} = await supabase.from('loans').insert([{
            ...loanData,
            calculation_mode: 'loan_payments',
        }]).select();

        if (error) throw error;
        res.status(200).json(data[0]);
    } catch (error) {
        res.status(400).json({ error: error.message});
    }
};
