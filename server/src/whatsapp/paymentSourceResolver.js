const supabase = require('../../config/supabase');

async function resolvePaymentSourceId(paymentHint) {
  // בסיס: רק מקורות תשלום פעילים
  const base = () =>
    supabase
      .from('payment_sources')
      .select('id, name, method, last4, created_at')
      .eq('is_active', true);

  // 1) אין רמז -> ברירת מחדל: הראשון (הכי ותיק)
  if (!paymentHint) {
    const { data, error } = await base()
      .order('created_at', { ascending: true })
      .limit(1);

    if (error) return null;
    return data?.[0]?.id ?? null;
  }

  // 2) מזומן
  if (paymentHint.kind === 'cash') {
    const { data, error } = await base()
      .or('method.ilike.%cash%,name.ilike.%מזומן%')
      .order('created_at', { ascending: true })
      .limit(1);

    if (error) return null;
    return data?.[0]?.id ?? null;
  }

  // 3) כרטיס לפי last4
  if (paymentHint.kind === 'card_last4') {
    const { data, error } = await base()
      .eq('last4', paymentHint.last4)
      .order('created_at', { ascending: true })
      .limit(1);

    if (error) return null;
    return data?.[0]?.id ?? null;
  }

  // 4) כרטיס בלי last4 (אם כתבו רק "כרטיס"/"אשראי")
  if (paymentHint.kind === 'card') {
    const { data, error } = await base()
      .or('method.ilike.%card%,method.ilike.%credit%,name.ilike.%כרטיס%,name.ilike.%אשראי%')
      .order('created_at', { ascending: true })
      .limit(1);

    if (error) return null;
    return data?.[0]?.id ?? null;
  }

  return null;
}

module.exports = { resolvePaymentSourceId };
