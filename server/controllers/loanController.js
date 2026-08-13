const supabase = require('../config/supabase');
const axios = require('axios');

exports.getAllLoans = async (req, res) => {
    try {
        const {data, error} = await supabase.from('loans').select('*').order('current_balance', { ascending: false});
        if (error) throw error;
        res.status(200).json(data);
    } catch (error) {
        res.status(400).json({ error: error.message});
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
