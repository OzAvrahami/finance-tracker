const supabase = require('../config/supabase');
const axios = require('axios');

const ACQUISITION_TYPES = ['purchase', 'gift', 'gwp'];
const FREE_ACQUISITION_TYPES = new Set(['gift', 'gwp']);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const nullableNumber = (value) => (value !== '' && value != null ? Number(value) : null);

const buildLegoPayload = (input, { create = false } = {}) => {
    const payload = {};
    const acquisitionType = hasOwn(input, 'acquisition_type')
        ? (input.acquisition_type || (create ? 'purchase' : null))
        : (create ? 'purchase' : null);

    if (hasOwn(input, 'set_number')) payload.set_number = String(input.set_number).trim();
    if (hasOwn(input, 'name')) payload.name = String(input.name).trim();
    if (hasOwn(input, 'theme')) payload.theme = input.theme ? String(input.theme).trim() : null;
    if (hasOwn(input, 'brand')) payload.brand = input.brand || 'LEGO';
    if (hasOwn(input, 'status')) payload.status = input.status || 'New';
    if (hasOwn(input, 'pieces')) payload.pieces = nullableNumber(input.pieces);
    if (hasOwn(input, 'image_url')) payload.image_url = input.image_url ? String(input.image_url).trim() : null;
    if (hasOwn(input, 'purchase_date')) payload.purchase_date = input.purchase_date || null;
    if (hasOwn(input, 'original_price')) payload.original_price = nullableNumber(input.original_price);
    if (hasOwn(input, 'receipt_price')) payload.receipt_price = nullableNumber(input.receipt_price);
    if (hasOwn(input, 'purchase_price')) payload.purchase_price = nullableNumber(input.purchase_price);
    if (acquisitionType) payload.acquisition_type = acquisitionType;

    if (create) {
        payload.brand ??= 'LEGO';
        payload.status ??= 'New';
        payload.theme ??= null;
        payload.pieces ??= null;
        payload.image_url ??= null;
        payload.purchase_date ??= null;
        payload.original_price ??= null;
        payload.receipt_price ??= null;
        payload.purchase_price ??= null;
    }

    if (FREE_ACQUISITION_TYPES.has(acquisitionType)) {
        payload.receipt_price = 0;
        payload.purchase_price = 0;
    }

    return payload;
};

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
    const { set_number, name, acquisition_type } = req.body;

    if (!set_number || !String(set_number).trim()) {
        return res.status(400).json({ error: 'מספר סט הוא שדה חובה' });
    }
    if (!name || !String(name).trim()) {
        return res.status(400).json({ error: 'שם הסט הוא שדה חובה' });
    }
    if (acquisition_type != null && acquisition_type !== '' && !ACQUISITION_TYPES.includes(acquisition_type)) {
        return res.status(400).json({ error: 'אופן קבלה לא תקין' });
    }

    const payload = buildLegoPayload(req.body, { create: true });

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
        const { acquisition_type } = req.body;
        if (acquisition_type != null && acquisition_type !== '' && !ACQUISITION_TYPES.includes(acquisition_type)) {
            return res.status(400).json({ error: 'אופן קבלה לא תקין' });
        }
        if (req.body.set_number) {
            const { data: existing } = await supabase
                .from('lego_sets')
                .select('id')
                .eq('set_number', String(req.body.set_number).trim())
                .neq('id', id)
                .maybeSingle();
            if (existing) return res.status(409).json({ error: 'הסט כבר קיים באוסף' });
        }
        const payload = buildLegoPayload(req.body);
        const { data, error } = await supabase
            .from('lego_sets')
            .update(payload)
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
