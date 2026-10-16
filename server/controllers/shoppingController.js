const supabase = require('../config/supabase');
const { normalizeShoppingListFields } = require('../utils/shoppingListFields');
const { planningUnit, supportedPlanningUnit } = require('../../shared/shoppingEntryOptions.mjs');
const { decimal } = require('../../shared/shoppingQuantities.mjs');

// ========== Reference Data ==========

exports.getListTypes = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('shopping_list_types')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('getListTypes Error:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.getCatalogCategories = async (req, res) => {
  try {
    const { list_type_id } = req.query;

    if (list_type_id) {
      // Filter via M2M table: only categories linked to this list type
      const { data, error } = await supabase
        .from('shopping_catalog_category_list_types')
        .select('shopping_catalog_categories(id, name, icon, is_active, is_neutral)')
        .eq('list_type_id', list_type_id);

      if (error) throw error;

      const categories = (data || [])
        .map(row => row.shopping_catalog_categories)
        .filter(cat => cat && (cat.is_active || cat.is_neutral))
        .sort((a, b) => a.name.localeCompare(b.name, 'he'));

      return res.json(categories);
    }

    // No filter — return all active categories
    const { data, error } = await supabase
      .from('shopping_catalog_categories')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('getCatalogCategories Error:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.createCatalogCategory = async (req, res) => {
  try {
    const { name, icon, list_type_id } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const { data: newCategory, error } = await supabase
      .from('shopping_catalog_categories')
      .insert([{ name: name.trim(), icon: icon || null, is_active: true }])
      .select()
      .single();

    if (error) throw error;

    // Link the new category to the list type if provided
    if (list_type_id) {
      const { error: linkErr } = await supabase
        .from('shopping_catalog_category_list_types')
        .insert([{ category_id: newCategory.id, list_type_id }]);

      if (linkErr) console.error('Failed to link category to list type:', linkErr);
    }

    res.status(201).json(newCategory);
  } catch (error) {
    console.error('createCatalogCategory Error:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.getCatalogItems = async (req, res) => {
  try {
    const { category_id, search, list_type_id, limit } = req.query;

    let query = supabase
      .from('shopping_catalog_items')
      .select('*, shopping_catalog_categories(name, icon)')
      .eq('is_active', true);

    if (category_id) query = query.eq('category_id', category_id);
    if (list_type_id) {
      const { data: links, error: scopeError } = await supabase.from('shopping_catalog_category_list_types')
        .select('category_id,shopping_catalog_categories(is_active,is_neutral)').eq('list_type_id', list_type_id);
      if (scopeError) throw scopeError;
      const ids = (links || []).filter(row => row.shopping_catalog_categories?.is_active || row.shopping_catalog_categories?.is_neutral).map(row => row.category_id);
      if (!ids.length) return res.json([]);
      query = query.in('category_id', ids);
    }
    if (search) query = query.ilike('name', `%${String(search).slice(0,300).replace(/[\\%_]/g, '\\$&')}%`);

    query = query.order('name');
    if (limit !== undefined || list_type_id) query = query.limit(Math.min(20, Math.max(1, Number.parseInt(limit,10) || 8)));

    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('getCatalogItems Error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ========== Shopping Lists CRUD ==========

exports.getShoppingLists = async (req, res) => {
  try {
    const { status } = req.query;

    let query = supabase
      .from('shopping_lists')
      .select('*, shopping_list_types(name), shopping_list_items(id, is_purchased)')
      .order('updated_at', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;

    const lists = data.map(list => ({
      ...list,
      item_count: list.shopping_list_items?.length || 0,
      purchased_count: list.shopping_list_items?.filter(i => i.is_purchased).length || 0,
      shopping_list_items: undefined,
    }));

    res.json(lists);
  } catch (error) {
    console.error('getShoppingLists Error:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.getShoppingListById = async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('shopping_lists')
      .select(`
        *,
        shopping_confirmed_purchases(items,basis,purchase_date),
        shopping_list_items(
          *,
          shopping_catalog_items(name, default_unit, default_price),
          shopping_catalog_categories(name, icon)
        )
      `)
      .eq('id', id)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('getShoppingListById Error:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.createShoppingList = async (req, res) => {
  try {
    const { title, list_type_id } = req.body;
    const optional = normalizeShoppingListFields(req.body);
    if (optional.error) return res.status(400).json({ error: optional.error });

    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }
    if (!list_type_id) {
      return res.status(400).json({ error: 'list_type_id is required' });
    }

    const { data, error } = await supabase
      .from('shopping_lists')
      .insert([{ title, list_type_id, status: 'draft', ...optional.values }])
      .select();

    if (error) throw error;
    res.status(201).json(data[0]);
  } catch (error) {
    console.error('createShoppingList Error:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.updateShoppingList = async (req, res) => {
  try {
    const { id } = req.params;
    const optional = normalizeShoppingListFields(req.body);
    if (optional.error) return res.status(400).json({ error: optional.error });
    const updates = { ...optional.values };

    if (req.body.title !== undefined) updates.title = req.body.title;
    if (req.body.list_type_id !== undefined) updates.list_type_id = req.body.list_type_id;
    if (req.body.status !== undefined) updates.status = req.body.status;
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('shopping_lists')
      .update(updates)
      .eq('id', id)
      .select();

    if (error) throw error;
    res.json(data[0]);
  } catch (error) {
    console.error('updateShoppingList Error:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.deleteShoppingList = async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase.rpc('shopping_delete_draft', { p_list: id });
    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error('deleteShoppingList Error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ========== List Items ==========

exports.addListItem = async (req, res) => {
  try {
    const { id } = req.params;
    if (req.body.entry_mode === 'name_first') {
      const item = { ...req.body };
      if (item.unit_mode === 'controlled') {
        if (item.unit != null && typeof item.unit !== 'string') return res.status(400).json({ error: 'יש לבחור יחידה מהרשימה.' });
        item.unit = planningUnit(item.unit);
      }
      const { data, error } = await supabase.rpc('shopping_add_planned_item', { p_list: id, p_item: item });
      if (error) {
        const messages = {
          shopping_category_scope: 'הקטגוריה או הפריט אינם זמינים לסוג הרשימה. בחרו הצעה אחרת או הוסיפו פריט חדש.',
          shopping_category_name_invalid: 'יש להזין שם קטגוריה עד 300 תווים, או להשאיר את השדה ריק.',
          shopping_category_ambiguous: 'יש כמה קטגוריות בשם זה. בחרו קטגוריה מפורשת מההצעות.',
          shopping_category_exists: 'קטגוריה בשם זה כבר קיימת. נסו שוב כדי להשתמש בזהות הקיימת.',
          shopping_unit_invalid: 'יש לבחור יחידה מהרשימה. יחידה ישנה מותרת רק ללא שינוי בפריט השמור.',
          shopping_list_closed: 'הרשימה נסגרה ואינה ניתנת לשינוי.',
          shopping_catalog_missing: 'הפריט השמור אינו זמין עוד. אפשר להוסיף את השם כפריט חדש.',
          shopping_item_name_required: 'יש להזין שם פריט עד 300 תווים.',
          shopping_item_invalid: 'יש להזין כמות חיובית, מחיר תקין ופרטים באורך המותר.',
        };
        return res.status(error.code === '23505' ? 409 : 400).json({ error: messages[error.message] || (error.code === '23505'
          ? 'פריט בשם זה כבר שמור בקטגוריה. בחרו אותו מההצעות או הוסיפו לרשימה בלבד.'
          : 'הפריט לא נוסף. בדקו את הפרטים ונסו שוב.') });
      }
      return res.status(201).json(data);
    }
    const { catalog_item_id, custom_name, quantity, unit, price, notes } = req.body;
    let { category_id } = req.body;
    if (catalog_item_id) {
      const { data: catalog, error } = await supabase.from('shopping_catalog_items').select('category_id').eq('id',catalog_item_id).single();
      if (error || !catalog) return res.status(400).json({ error: 'catalog item not found' });
      category_id = catalog.category_id;
    }

    if (!catalog_item_id && !custom_name) {
      return res.status(400).json({ error: 'catalog_item_id or custom_name is required' });
    }

    if (!category_id) {
      return res.status(400).json({ error: 'category_id is required' });
    }

    let resolvedCatalogItemId = catalog_item_id || null;
    let itemUnit = unit;
    let itemPrice = price;

    // If no catalog_item_id but a custom_name was given, look up or create the catalog item
    if (!catalog_item_id && custom_name) {
      const { data: foundItems } = await supabase
        .from('shopping_catalog_items')
        .select('id, default_unit, default_price')
        .ilike('name', custom_name.trim())
        .eq('category_id', category_id)
        .limit(1);
      const existingItem = foundItems?.[0] || null;

      if (existingItem) {
        resolvedCatalogItemId = existingItem.id;
        if (!itemUnit) itemUnit = existingItem.default_unit;
        if (!itemPrice && itemPrice !== 0) itemPrice = existingItem.default_price;
      } else {
        const { data: newItem, error: createErr } = await supabase
          .from('shopping_catalog_items')
          .insert([{
            name: custom_name.trim(),
            category_id,
            default_unit: unit || null,
            default_price: price || null,
            is_active: true,
          }])
          .select()
          .single();

        if (createErr) {
          console.error('Failed to create catalog item:', createErr);
        } else if (newItem) {
          resolvedCatalogItemId = newItem.id;
        }
      }
    }

    if (resolvedCatalogItemId && (!itemUnit || !itemPrice)) {
      const { data: catalogItem } = await supabase
        .from('shopping_catalog_items')
        .select('default_unit, default_price')
        .eq('id', resolvedCatalogItemId)
        .single();

      if (catalogItem) {
        if (!itemUnit) itemUnit = catalogItem.default_unit;
        if (!itemPrice && itemPrice !== 0) itemPrice = catalogItem.default_price;
      }
    }

    const { data, error } = await supabase
      .from('shopping_list_items')
      .insert([{
        list_id: id,
        catalog_item_id: resolvedCatalogItemId,
        custom_name: resolvedCatalogItemId ? null : (custom_name || null),
        category_id,
        quantity: quantity || 1,
        unit: itemUnit || null,
        price: itemPrice || null,
        notes: notes || null,
        is_purchased: false,
      }])
      .select('*, shopping_catalog_items(name, default_unit, default_price), shopping_catalog_categories(name, icon)');

    if (error) throw error;

    await supabase.from('shopping_lists').update({ updated_at: new Date().toISOString() }).eq('id', id);

    res.status(201).json(data[0]);
  } catch (error) {
    console.error('addListItem Error:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.updateListItem = async (req, res) => {
  try {
    const { id, itemId } = req.params;
    const updates = {};

    if (req.body.planned_name !== undefined) {
      if (typeof req.body.planned_name !== 'string' || !req.body.planned_name.trim() || req.body.planned_name.trim().length > 300)
        return res.status(400).json({ error: 'יש להזין שם פריט עד 300 תווים.' });
      updates.planned_name = req.body.planned_name.trim();
      if ((req.body.quantity !== undefined && (!Number.isFinite(Number(req.body.quantity)) || Number(req.body.quantity)<=0 || Number(req.body.quantity)>10000)) ||
          (req.body.price != null && req.body.price !== '' && (!Number.isFinite(Number(req.body.price)) || Number(req.body.price)<0 || Number(req.body.price)>100000000)) ||
          (req.body.notes != null && (typeof req.body.notes !== 'string' || req.body.notes.length>2000)) ||
          (req.body.unit != null && (typeof req.body.unit !== 'string' || (req.body.unit_mode !== 'controlled' && req.body.unit.length>30))))
        return res.status(400).json({ error: 'יש להזין כמות חיובית, מחיר תקין ופרטים באורך המותר.' });
    }

    const fields = ['quantity', 'unit', 'price', 'notes', 'is_purchased', 'custom_name', 'category_id'];
    fields.forEach(f => {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    });

    if (req.body.unit_mode === 'controlled') {
      if (req.body.quantity !== undefined) {
        const quantity=decimal(req.body.quantity);
        if (quantity === null || quantity<=0n || quantity>10000000n)
          return res.status(400).json({error:'יש להזין כמות חיובית עד 10000, עם עד שלוש ספרות אחרי הנקודה.'});
      }
      if (req.body.unit !== undefined) {
        if (typeof req.body.unit !== 'string') return res.status(400).json({error:'יש לבחור יחידה מהרשימה.'});
        const unit=planningUnit(req.body.unit);
        if (!supportedPlanningUnit(unit)) {
          const {data:current,error}=await supabase.from('shopping_list_items').select('unit').eq('id',itemId).eq('list_id',id).single();
          if (error || !current || unit !== current.unit) return res.status(400).json({error:'בחרו יחידה מהרשימה או השאירו את היחידה הקיימת ללא שינוי.'});
        }
        updates.unit=unit;
      }
    }

    if (updates.is_purchased === true) updates.purchased_at = new Date().toISOString();
    if (updates.is_purchased === false) updates.purchased_at = null;

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('shopping_list_items')
      .update(updates)
      .eq('id', itemId)
      .eq('list_id', id)
      .select('*, shopping_catalog_items(name, default_unit, default_price), shopping_catalog_categories(name, icon)');

    if (error) throw error;
    res.json(data[0]);
  } catch (error) {
    console.error('updateListItem Error:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.removeListItem = async (req, res) => {
  try {
    const { id, itemId } = req.params;

    const { error } = await supabase
      .from('shopping_list_items')
      .delete()
      .eq('id', itemId)
      .eq('list_id', id);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('removeListItem Error:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.toggleItemPurchased = async (req, res) => {
  try {
    const { id, itemId } = req.params;

    const { data: current, error: fetchErr } = await supabase
      .from('shopping_list_items')
      .select('is_purchased')
      .eq('id', itemId)
      .eq('list_id', id)
      .single();

    if (fetchErr) throw fetchErr;

    const newState = !current.is_purchased;
    const { data, error } = await supabase
      .from('shopping_list_items')
      .update({
        is_purchased: newState,
        purchased_at: newState ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', itemId)
      .eq('list_id', id)
      .select('*, shopping_catalog_items(name, default_unit, default_price), shopping_catalog_categories(name, icon)');

    if (error) throw error;
    res.json(data[0]);
  } catch (error) {
    console.error('toggleItemPurchased Error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ========== Checkout ==========

exports.checkoutList = async (req, res) => {
  try {
    await require('../services/savingsTransactionService').rejectUnsupported(supabase, req.body, [req.body.category_id]);
    const { id, duplicateReviewSchema } = require('../services/shoppingHabitsService');
    const list = id.parse(req.params.id);
    const category = req.body.category_id ? id.parse(req.body.category_id) : null;
    const source = req.body.payment_source_id ? id.parse(req.body.payment_source_id) : null;
    const {data,error}=await supabase.rpc('shopping_checkout',{p_list:list,p_category:category,p_source:source,...(req.body.duplicate_reviewed_ids !== undefined ? {p_duplicate_reviewed_ids: duplicateReviewSchema.parse(req.body.duplicate_reviewed_ids)} : {})});
    if(error)throw error;
    res.json(data);
  } catch(error) { require('../routes/shoppingIntelligenceRoutes').errorResponse(res,error); }
};
