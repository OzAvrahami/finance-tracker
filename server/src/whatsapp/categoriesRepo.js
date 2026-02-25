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
 * Get the first N expense categories (for the numbered selection menu).
 * Returns [{ id, name }]
 */
async function getTopCategories(limit = 5) {
  const { data, error } = await supabase
    .from('categories')
    .select('id, name')
    .eq('type', 'expense')
    .order('id', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('[WhatsApp] categoriesRepo.getTopCategories error:', error.message);
    return [];
  }

  return data || [];
}

module.exports = {
  findCategoryByMerchant,
  findMerchantMapping,
  saveMerchantMapping,
  getTopCategories,
};
