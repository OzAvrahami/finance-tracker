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
    try {
        const { data, error } = await supabase.from('lego_set').insert([req.body]).select();
        if (error) throw error;
        res.status(200).json(data);
    } catch (error) {
        res.status(400).json({ error: error.message});
    }
};

exports.updateSet = async (req, res) => {
    try {
        const { id } = req.params;
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