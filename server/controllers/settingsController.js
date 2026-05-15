const supabase = require('../config/supabase');

// ========== Categories ==========

// GET /api/settings/categories
// Returns ALL categories (including inactive), ordered by type then name.
exports.getCategories = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .order('type', { ascending: true })
      .order('name', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('settings.getCategories Error:', error);
    res.status(500).json({ error: error.message });
  }
};

// POST /api/settings/categories
exports.createCategory = async (req, res) => {
  try {
    const { name, type, icon, keywords } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!type || !['income', 'expense'].includes(type)) {
      return res.status(400).json({ error: 'type must be "income" or "expense"' });
    }

    const { data, error } = await supabase
      .from('categories')
      .insert([{
        name: name.trim(),
        type,
        icon: icon?.trim() || null,
        keywords: Array.isArray(keywords) ? keywords : [],
        is_active: true,
      }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    console.error('settings.createCategory Error:', error);
    res.status(500).json({ error: error.message });
  }
};

// PUT /api/settings/categories/:id
exports.updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, icon, keywords, is_active } = req.body;

    if (type !== undefined && !['income', 'expense'].includes(type)) {
      return res.status(400).json({ error: 'type must be "income" or "expense"' });
    }

    // Refuse type change if existing transactions reference this category
    if (type !== undefined) {
      const { data: current, error: fetchErr } = await supabase
        .from('categories')
        .select('type')
        .eq('id', id)
        .single();

      if (fetchErr) throw fetchErr;

      if (current.type !== type) {
        const { count, error: countErr } = await supabase
          .from('transactions')
          .select('id', { count: 'exact', head: true })
          .eq('category_id', id);

        if (countErr) throw countErr;

        if (count > 0) {
          return res.status(409).json({
            error: `לא ניתן לשנות סוג: קטגוריה זו מקושרת ל-${count} תנועות קיימות.`,
          });
        }
      }
    }

    const updates = { updated_at: new Date().toISOString() };
    if (name !== undefined)       updates.name       = name.trim();
    if (type !== undefined)       updates.type       = type;
    if (icon !== undefined)       updates.icon       = icon?.trim() || null;
    if (keywords !== undefined)   updates.keywords   = Array.isArray(keywords) ? keywords : [];
    if (is_active !== undefined)  updates.is_active  = is_active;

    const { data, error } = await supabase
      .from('categories')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('settings.updateCategory Error:', error);
    res.status(500).json({ error: error.message });
  }
};

// DELETE /api/settings/categories/:id  — soft delete only (sets is_active = false)
exports.deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('categories')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('settings.deleteCategory Error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ========== Payment Sources ==========

const VALID_METHODS = ['credit_card', 'debit_card', 'cash', 'bank_transfer', 'digital_wallet', 'check'];

function toSlug(name) {
  return name.trim().toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-') + '-' + Date.now();
}

// GET /api/settings/payment-sources — ALL sources (including inactive), ordered by name
exports.getPaymentSources = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('payment_sources')
      .select('*')
      .order('name', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('settings.getPaymentSources Error:', error);
    res.status(500).json({ error: error.message });
  }
};

// POST /api/settings/payment-sources
exports.createPaymentSource = async (req, res) => {
  try {
    const { name, method, issuer, last4, owner } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!method || !VALID_METHODS.includes(method)) {
      return res.status(400).json({ error: `method must be one of: ${VALID_METHODS.join(', ')}` });
    }

    const { data, error } = await supabase
      .from('payment_sources')
      .insert([{
        name: name.trim(),
        method,
        issuer: issuer?.trim() || null,
        last4: last4?.trim() || null,
        owner: owner?.trim() || null,
        slug: toSlug(name),
        is_active: true,
      }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    console.error('settings.createPaymentSource Error:', error);
    res.status(500).json({ error: error.message });
  }
};

// PUT /api/settings/payment-sources/:id
exports.updatePaymentSource = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, method, issuer, last4, owner, is_active } = req.body;

    if (method !== undefined && !VALID_METHODS.includes(method)) {
      return res.status(400).json({ error: `method must be one of: ${VALID_METHODS.join(', ')}` });
    }

    const updates = { updated_at: new Date().toISOString() };
    if (name !== undefined)      updates.name      = name.trim();
    if (method !== undefined)    updates.method    = method;
    if (issuer !== undefined)    updates.issuer    = issuer?.trim() || null;
    if (last4 !== undefined)     updates.last4     = last4?.trim() || null;
    if (owner !== undefined)     updates.owner     = owner?.trim() || null;
    if (is_active !== undefined) updates.is_active = is_active;

    const { data, error } = await supabase
      .from('payment_sources')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('settings.updatePaymentSource Error:', error);
    res.status(500).json({ error: error.message });
  }
};

// DELETE /api/settings/payment-sources/:id — soft delete only (sets is_active = false)
exports.deletePaymentSource = async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('payment_sources')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('settings.deletePaymentSource Error:', error);
    res.status(500).json({ error: error.message });
  }
};
