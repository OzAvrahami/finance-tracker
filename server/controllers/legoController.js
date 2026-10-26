const supabase = require('../config/supabase');
const axios = require('axios');

const ACQUISITION_TYPES = ['purchase', 'gift', 'gwp'];
const FREE_ACQUISITION_TYPES = new Set(['gift', 'gwp']);
const PHYSICAL_STATUSES = ['New', 'In Progress', 'Built', 'Disassembled'];
const RETURN_FIELDS = ['acquisition_type', 'purchase_price', 'receipt_price', 'original_price', 'purchase_date'];
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
    if (hasOwn(input, 'subtheme')) payload.subtheme = input.subtheme == null ? null : String(input.subtheme).trim() ||  null;
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
        payload.subtheme ??= null;
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

    if (hasOwn(req.body, 'action') || hasOwn(req.body, 'transaction_id') ||
        (hasOwn(req.body, 'status') && !PHYSICAL_STATUSES.includes(req.body.status))) {
        return res.status(400).json({ error: 'סט חדש חייב להיווצר עם סטטוס הרכבה תקין וללא קישור עסקה ידני' });
    }

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
        const isReturn = req.body.action === 'return';
        const isSale = req.body.status === 'Sold';
        if ((hasOwn(req.body, 'action') && !isReturn) || hasOwn(req.body, 'transaction_id')) {
            return res.status(400).json({ error: 'פעולה או קישור עסקה לא תקינים' });
        }
        if (hasOwn(req.body, 'status') && ![...PHYSICAL_STATUSES, 'Sold'].includes(req.body.status)) {
            return res.status(400).json({ error: 'סטטוס הסט אינו תקין' });
        }
        // Selling is status-only. Never rewrite the acquisition or financial link.
        if (isSale && Object.keys(req.body).some((key) => key !== 'status')) {
            return res.status(400).json({ error: 'סימון כנמכר משנה רק את סטטוס הסט' });
        }
        if (acquisition_type != null && acquisition_type !== '' && !ACQUISITION_TYPES.includes(acquisition_type)) {
            return res.status(400).json({ error: 'אופן קבלה לא תקין' });
        }

        if (isReturn) {
            if (!PHYSICAL_STATUSES.includes(req.body.status) ||
                !ACQUISITION_TYPES.includes(acquisition_type) ||
                RETURN_FIELDS.some((field) => !hasOwn(req.body, field))) {
                return res.status(400).json({ error: 'להחזרה לאוסף יש לבחור מצב הרכבה ולמלא או לנקות את פרטי הרכישה' });
            }
            for (const field of ['purchase_price', 'receipt_price', 'original_price']) {
                const value = req.body[field];
                if (value !== null && (typeof value !== 'number' && typeof value !== 'string' ||
                    String(value).trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0)) {
                    return res.status(400).json({ error: 'מחיר רכישה חייב להיות מספר לא שלילי או ריק' });
                }
            }
            const date = req.body.purchase_date;
            if (date !== null && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
                !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) {
                return res.status(400).json({ error: 'תאריך רכישה אינו תקין' });
            }
        }

        const { data: current, error: readError } = await supabase.from('lego_sets')
            .select('id, status, set_number').eq('id', id).maybeSingle();
        if (readError) throw readError;
        if (!current) return res.status(404).json({ error: 'הסט לא נמצא באוסף' });
        if (isReturn && current.status !== 'Sold') {
            return res.status(409).json({ code: 'LEGO_STATE_CHANGED', error: 'הסט כבר אינו מסומן כנמכר. יש לרענן את האוסף.' });
        }
        if (!isReturn && current.status === 'Sold' && hasOwn(req.body, 'status') && !isSale) {
            return res.status(409).json({ code: 'LEGO_RETURN_REQUIRED', error: 'יש להשתמש בפעולת החזר לאוסף' });
        }
        if (isReturn && hasOwn(req.body, 'set_number') && String(req.body.set_number).trim() !== current.set_number) {
            return res.status(400).json({ error: 'בהחזרה לאוסף יש לשמור על מספר הסט הקיים' });
        }
        if (req.body.set_number) {
            const { data: existing, error: duplicateError } = await supabase
                .from('lego_sets')
                .select('id')
                .eq('set_number', String(req.body.set_number).trim())
                .neq('id', id)
                .maybeSingle();
            if (duplicateError) throw duplicateError;
            if (existing) return res.status(409).json({ error: 'הסט כבר קיים באוסף' });
        }
        const payload = buildLegoPayload(req.body);
        // One conditional UPDATE both returns the record and detaches the old
        // purchase. A concurrent sale/return must not be undone by a stale edit.
        if (isReturn) payload.transaction_id = null;
        let update = supabase
            .from('lego_sets')
            .update(payload)
            .eq('id', id);
        update = current.status === null
            ? update.is('status', null)
            : update.eq('status', current.status);
        const { data, error } = await update.select();
        if (error) throw error;
        if (!data?.length) {
            return res.status(409).json({ code: 'LEGO_STATE_CHANGED', error: 'מצב הסט השתנה. יש לרענן את האוסף ולנסות שוב.' });
        }
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
