const supabase = require('../config/supabase');

// ========== Shopping List Types ==========

// GET /api/settings/shopping/list-types
// Returns ALL list types including inactive, ordered by name.
exports.getAdminListTypes = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('shopping_list_types')
      .select('*')
      .order('name');
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('shoppingSettings.getAdminListTypes Error:', error);
    res.status(500).json({ error: error.message });
  }
};

// POST /api/settings/shopping/list-types
exports.createAdminListType = async (req, res) => {
  try {
    const { name, slug } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'שם הוא שדה חובה' });
    if (!slug || !slug.trim()) return res.status(400).json({ error: 'slug הוא שדה חובה' });
    if (!/^[a-z0-9-]+$/.test(slug.trim())) {
      return res.status(400).json({ error: 'slug חייב להכיל אותיות לועזיות קטנות, ספרות ומקפים בלבד' });
    }

    const { data, error } = await supabase
      .from('shopping_list_types')
      .insert([{ name: name.trim(), slug: slug.trim(), is_active: true }])
      .select()
      .single();
    if (error) {
      if (error.code === '23505') return res.status(400).json({ error: 'slug זה כבר קיים. בחר slug אחר.' });
      throw error;
    }
    res.status(201).json(data);
  } catch (error) {
    console.error('shoppingSettings.createAdminListType Error:', error);
    res.status(500).json({ error: error.message });
  }
};

// PUT /api/settings/shopping/list-types/:id
exports.updateAdminListType = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, slug, is_active } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (slug !== undefined) {
      if (!/^[a-z0-9-]+$/.test(slug.trim())) {
        return res.status(400).json({ error: 'slug חייב להכיל אותיות לועזיות קטנות, ספרות ומקפים בלבד' });
      }
      updates.slug = slug.trim();
    }
    if (is_active !== undefined) updates.is_active = is_active;

    const { data, error } = await supabase
      .from('shopping_list_types')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) {
      if (error.code === '23505') return res.status(400).json({ error: 'slug זה כבר קיים. בחר slug אחר.' });
      throw error;
    }
    res.json(data);
  } catch (error) {
    console.error('shoppingSettings.updateAdminListType Error:', error);
    res.status(500).json({ error: error.message });
  }
};

// DELETE /api/settings/shopping/list-types/:id — soft delete with FK guard
exports.deactivateAdminListType = async (req, res) => {
  try {
    const { id } = req.params;

    const { count, error: countError } = await supabase
      .from('shopping_lists')
      .select('id', { count: 'exact', head: true })
      .eq('list_type_id', id)
      .neq('status', 'archived');
    if (countError) throw countError;

    if (count > 0) {
      return res.status(409).json({
        error: `לא ניתן להשבית: ${count} רשימות קניות פעילות משתמשות בסוג זה`,
      });
    }

    const { data, error } = await supabase
      .from('shopping_list_types')
      .update({ is_active: false })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('shoppingSettings.deactivateAdminListType Error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ========== Shopping Catalog Categories ==========

// GET /api/settings/shopping/catalog-categories
// Returns ALL catalog categories including inactive, ordered by name.
exports.getAdminCatalogCategories = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('shopping_catalog_categories')
      .select('*')
      .order('name');
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('shoppingSettings.getAdminCatalogCategories Error:', error);
    res.status(500).json({ error: error.message });
  }
};

// POST /api/settings/shopping/catalog-categories
exports.createAdminCatalogCategory = async (req, res) => {
  try {
    const { name, icon } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'שם הוא שדה חובה' });

    const { data, error } = await supabase
      .from('shopping_catalog_categories')
      .insert([{ name: name.trim(), icon: icon?.trim() || null }])
      .select()
      .single();
    if (error) {
      if (error.code === '23505') return res.status(400).json({ error: 'קטגוריה עם שם זה כבר קיימת' });
      throw error;
    }
    res.status(201).json(data);
  } catch (error) {
    console.error('shoppingSettings.createAdminCatalogCategory Error:', error);
    res.status(500).json({ error: error.message });
  }
};

// PUT /api/settings/shopping/catalog-categories/:id
exports.updateAdminCatalogCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, icon, is_active } = req.body;

    const updates = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name.trim();
    if (icon !== undefined) updates.icon = icon?.trim() || null;
    if (is_active !== undefined) updates.is_active = is_active;

    const { data, error } = await supabase
      .from('shopping_catalog_categories')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) {
      if (error.code === '23505') return res.status(400).json({ error: 'קטגוריה עם שם זה כבר קיימת' });
      throw error;
    }
    res.json(data);
  } catch (error) {
    console.error('shoppingSettings.updateAdminCatalogCategory Error:', error);
    res.status(500).json({ error: error.message });
  }
};

// DELETE /api/settings/shopping/catalog-categories/:id — soft delete
// Deactivating is always allowed; existing shopping_list_items are unaffected.
exports.deactivateAdminCatalogCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('shopping_catalog_categories')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('shoppingSettings.deactivateAdminCatalogCategory Error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ========== Mapping: List Types <-> Catalog Categories ==========

// GET /api/settings/shopping/list-types/:id/categories
// Returns all catalog categories with a boolean `linked` field.
exports.getListTypeCategoryLinks = async (req, res) => {
  try {
    const { id } = req.params;

    const [{ data: allCategories, error: catError }, { data: links, error: linkError }] = await Promise.all([
      supabase.from('shopping_catalog_categories').select('*').order('name'),
      supabase.from('shopping_catalog_category_list_types').select('category_id').eq('list_type_id', id),
    ]);
    if (catError) throw catError;
    if (linkError) throw linkError;

    const linkedIds = new Set((links || []).map(l => l.category_id));
    res.json((allCategories || []).map(cat => ({ ...cat, linked: linkedIds.has(cat.id) })));
  } catch (error) {
    console.error('shoppingSettings.getListTypeCategoryLinks Error:', error);
    res.status(500).json({ error: error.message });
  }
};

// PUT /api/settings/shopping/list-types/:id/categories
// Diff-based update: inserts new links first, then deletes removed ones.
// If insert fails, nothing is deleted — safe against partial failure.
exports.setListTypeCategoryLinks = async (req, res) => {
  try {
    const { id } = req.params;
    const { categoryIds } = req.body;

    if (!Array.isArray(categoryIds)) {
      return res.status(400).json({ error: 'categoryIds חייב להיות מערך' });
    }

    const { data: existing, error: fetchError } = await supabase
      .from('shopping_catalog_category_list_types')
      .select('category_id')
      .eq('list_type_id', id);
    if (fetchError) throw fetchError;

    const existingIds = (existing || []).map(l => l.category_id);
    const toAdd = categoryIds.filter(cid => !existingIds.includes(cid));
    const toRemove = existingIds.filter(cid => !categoryIds.includes(cid));

    if (toAdd.length > 0) {
      const rows = toAdd.map(cid => ({ list_type_id: Number(id), category_id: cid }));
      const { error: insertError } = await supabase
        .from('shopping_catalog_category_list_types')
        .insert(rows);
      if (insertError) throw insertError;
    }

    if (toRemove.length > 0) {
      const { error: deleteError } = await supabase
        .from('shopping_catalog_category_list_types')
        .delete()
        .eq('list_type_id', id)
        .in('category_id', toRemove);
      if (deleteError) throw deleteError;
    }

    res.json({ linked: categoryIds.length });
  } catch (error) {
    console.error('shoppingSettings.setListTypeCategoryLinks Error:', error);
    res.status(500).json({ error: error.message });
  }
};
