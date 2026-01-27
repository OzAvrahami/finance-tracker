const supabase = require("../config/supabase");

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
}