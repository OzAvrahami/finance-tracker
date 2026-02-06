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

        const {data, error} = await supabase.from('loans').insert([loanData]).select();

        if (error) throw error;
        res.status(200).json(data[0]);
    } catch (error) {
        res.status(400).json({ error: error.message});
    }
};
