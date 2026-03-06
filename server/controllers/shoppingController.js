const supabase = require('../config/supabase');

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
        .select('shopping_catalog_categories(id, name, icon, is_active)')
        .eq('list_type_id', list_type_id);

      if (error) throw error;

      const categories = (data || [])
        .map(row => row.shopping_catalog_categories)
        .filter(cat => cat && cat.is_active)
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
    const { category_id, search } = req.query;

    let query = supabase
      .from('shopping_catalog_items')
      .select('*, shopping_catalog_categories(name, icon)')
      .eq('is_active', true);

    if (category_id) query = query.eq('category_id', category_id);
    if (search) query = query.ilike('name', `%${search}%`);

    query = query.order('name');

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

    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }

    const { data, error } = await supabase
      .from('shopping_lists')
      .insert([{ title, list_type_id: list_type_id || null, status: 'draft' }])
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
    const updates = {};

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

    await supabase.from('shopping_checkouts').delete().eq('list_id', id);
    await supabase.from('shopping_list_items').delete().eq('list_id', id);

    const { error } = await supabase.from('shopping_lists').delete().eq('id', id);
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
    const { catalog_item_id, custom_name, category_id, quantity, unit, price, notes } = req.body;

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
        custom_name: custom_name || null,
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

    const fields = ['quantity', 'unit', 'price', 'notes', 'is_purchased', 'custom_name', 'category_id'];
    fields.forEach(f => {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    });

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
    const { id } = req.params;
    const { payment_source_id, category_id } = req.body;

    // Fetch list with items
    const { data: list, error: listErr } = await supabase
      .from('shopping_lists')
      .select('*, shopping_list_items(*)')
      .eq('id', id)
      .single();

    if (listErr) throw listErr;
    if (list.status === 'checked_out') {
      return res.status(400).json({ error: 'List is already checked out' });
    }

    // Calculate total from purchased items
    const purchasedItems = (list.shopping_list_items || []).filter(i => i.is_purchased);
    const totalAmount = purchasedItems.reduce((sum, item) => {
      return sum + ((Number(item.quantity) || 1) * (Number(item.price) || 0));
    }, 0);

    // Create transaction
    const { data: transaction, error: transErr } = await supabase
      .from('transactions')
      .insert([{
        description: list.title,
        movement_type: 'expense',
        category_id: category_id || null,
        payment_source_id: payment_source_id || null,
        total_amount: totalAmount,
        transaction_date: new Date().toISOString().split('T')[0],
        charge_date: new Date().toISOString().split('T')[0],
        created_at: new Date(),
      }])
      .select();

    if (transErr) throw transErr;

    // Create checkout record
    const { data: checkout, error: checkoutErr } = await supabase
      .from('shopping_checkouts')
      .insert([{
        list_id: parseInt(id),
        checkout_date: new Date().toISOString().split('T')[0],
        total_amount: totalAmount,
        payment_source_id: payment_source_id || null,
        category_id: category_id || null,
        transaction_id: transaction[0].id,
      }])
      .select();

    if (checkoutErr) throw checkoutErr;

    // Update list status
    await supabase
      .from('shopping_lists')
      .update({ status: 'checked_out', updated_at: new Date().toISOString() })
      .eq('id', id);

    res.json({ checkout: checkout[0], transaction_id: transaction[0].id, total_amount: totalAmount });
  } catch (error) {
    console.error('checkoutList Error:', error);
    res.status(500).json({ error: error.message });
  }
};
