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
