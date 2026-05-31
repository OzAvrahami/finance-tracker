const supabase = require('../config/supabase');
const axios = require('axios');

exports.getAllSets = async (req, res) => {
    try {
        const { data, error } = await supabase.from('lego_sets').select('*');
        if (error) throw error;
        res.status(200).json(data);
    } catch (error) {
        res.status(400).json({ error: error.message});
    }
};

exports.addSet = async (req, res) => {
    const { set_number, name, theme, brand, status, pieces, purchase_price, original_price, market_value, purchase_date } = req.body;

    if (!set_number || !String(set_number).trim()) {
        return res.status(400).json({ error: 'מספר סט הוא שדה חובה' });
    }
    if (!name || !String(name).trim()) {
        return res.status(400).json({ error: 'שם הסט הוא שדה חובה' });
    }

    const payload = {
        set_number: String(set_number).trim(),
        name: String(name).trim(),
        theme: theme ? String(theme).trim() : null,
        brand: brand || 'LEGO',
        status: status || 'New',
        pieces: pieces !== '' && pieces != null ? Number(pieces) : null,
        purchase_price: purchase_price !== '' && purchase_price != null ? Number(purchase_price) : null,
        original_price: original_price !== '' && original_price != null ? Number(original_price) : null,
        market_value: market_value !== '' && market_value != null ? Number(market_value) : null,
        purchase_date: purchase_date || null,
    };

    try {
        const { data: existing } = await supabase
            .from('lego_sets')
            .select('id')
            .eq('set_number', payload.set_number)
            .maybeSingle();
        if (existing) return res.status(409).json({ error: 'הסט כבר קיים באוסף' });

        const { data, error } = await supabase.from('lego_sets').insert([payload]).select();
        if (error) throw error;
        res.status(201).json(data);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.updateSet = async (req, res) => {
    try {
        const { id } = req.params;
        if (req.body.set_number) {
            const { data: existing } = await supabase
                .from('lego_sets')
                .select('id')
                .eq('set_number', String(req.body.set_number).trim())
                .neq('id', id)
                .maybeSingle();
            if (existing) return res.status(409).json({ error: 'הסט כבר קיים באוסף' });
        }
        const { data, error } = await supabase
            .from('lego_sets')
            .update(req.body)
            .eq('id', id)
            .select();
        if (error) throw error;
        res.status(200).json(data);
    } catch (error) {
        res.status(400).json({ error: error.message});
    }
};

exports.deleteSet = async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await supabase.from('lego_sets').delete().eq('id', id);
        if (error) throw error;
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.getThemes = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('lego_sets')
      .select('theme');

    if (error) throw error;

    const uniqueThemes = [...new Set(data.map(item => item.theme).filter(Boolean))];

    res.json(uniqueThemes);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
