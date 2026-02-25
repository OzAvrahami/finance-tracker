const supabase = require('../../config/supabase');

/**
 * Find a category whose keywords array contains a match for the merchant.
 * categories.keywords is TEXT[] in Postgres.
 * Returns { id, name } or null.
 */
async function findCategoryByMerchant(merchant) {
  const normalized = merchant.trim().toLowerCase();

  const { data: categories, error } = await supabase
    .from('categories')
    .select('id, name, keywords')
    .eq('type', 'expense');

  if (error) {
    console.error('[WhatsApp] categoriesRepo.findByMerchant error:', error.message);
    return null;
  }

  for (const cat of categories) {
    const kws = cat.keywords || [];
    for (const kw of kws) {
      if (kw && normalized.includes(kw.toLowerCase())) {
        return { id: cat.id, name: cat.name };
      }
    }
  }

  return null;
}

/**
 * Check merchant_category_map for a previous user mapping.
 * Returns category_id or null.
 */
async function findMerchantMapping(waId, merchant) {
  const normalized = merchant.trim().toLowerCase();

  const { data, error } = await supabase
    .from('merchant_category_map')
    .select('category_id')
    .eq('wa_id', waId)
    .eq('merchant_normalized', normalized)
    .maybeSingle();

  if (error) {
    console.error('[WhatsApp] categoriesRepo.findMerchantMapping error:', error.message);
    return null;
  }

  return data?.category_id || null;
}

/**
 * Save a merchant → category mapping for future lookups.
 */
async function saveMerchantMapping(waId, merchant, categoryId) {
  const normalized = merchant.trim().toLowerCase();

  const { error } = await supabase
    .from('merchant_category_map')
    .upsert({
      wa_id: waId,
      merchant_normalized: normalized,
      category_id: categoryId,
    }, { onConflict: 'wa_id,merchant_normalized' });

  if (error) {
    console.error('[WhatsApp] categoriesRepo.saveMerchantMapping error:', error.message);
  }
}

/**
 * Get a page of expense categories.
 * @param {number} page - 0-based page index
 * @param {number} pageSize - items per page
 * @returns {{ categories: [{id, name}], hasMore: boolean }}
 */
async function getCategoriesPage(page = 0, pageSize = 5) {
  const from = page * pageSize;
  const to = from + pageSize; // fetch one extra to know if there's more

  const { data, error } = await supabase
    .from('categories')
    .select('id, name')
    .eq('type', 'expense')
    .order('id', { ascending: true })
    .range(from, to);

  if (error) {
    console.error('[WhatsApp] categoriesRepo.getCategoriesPage error:', error.message);
    return { categories: [], hasMore: false };
  }

  const hasMore = (data || []).length > pageSize;
  const categories = (data || []).slice(0, pageSize);

  return { categories, hasMore };
}

/**
 * Search expense categories by name (ILIKE) and keywords.
 * Returns up to `limit` results as [{ id, name }].
 */
async function searchCategories(query, limit = 5) {
  const term = (query || '').trim().toLowerCase();
  if (!term) return [];

  // Search by name
  const { data: byName, error: nameErr } = await supabase
    .from('categories')
    .select('id, name')
    .eq('type', 'expense')
    .ilike('name', `%${term}%`)
    .limit(limit);

  if (nameErr) {
    console.error('[WhatsApp] categoriesRepo.searchCategories name error:', nameErr.message);
  }

  const results = byName || [];
  const foundIds = new Set(results.map(r => r.id));

  // Also search in keywords (fetch all and filter in JS since keywords is TEXT[])
  if (results.length < limit) {
    const { data: all, error: kwErr } = await supabase
      .from('categories')
      .select('id, name, keywords')
      .eq('type', 'expense');

    if (kwErr) {
      console.error('[WhatsApp] categoriesRepo.searchCategories kw error:', kwErr.message);
    } else {
      for (const cat of (all || [])) {
        if (foundIds.has(cat.id)) continue;
        const kws = cat.keywords || [];
        if (kws.some(kw => kw && kw.toLowerCase().includes(term))) {
          results.push({ id: cat.id, name: cat.name });
          if (results.length >= limit) break;
        }
      }
    }
  }

  return results;
}

module.exports = {
  findCategoryByMerchant,
  findMerchantMapping,
  saveMerchantMapping,
  getCategoriesPage,
  searchCategories,
};
