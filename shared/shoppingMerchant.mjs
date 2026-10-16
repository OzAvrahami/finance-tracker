const clean = value => String(value ?? '').normalize('NFKC').toLowerCase()
  .replace(/[\p{P}\p{S}\u200e\u200f]/gu, ' ').replace(/\s+/g, ' ').trim();
const retailers = [
  ['yohananof', ['יוחננוף', 'יוחננוב', 'yohananof', 'yohannof']],
  ['shufersal', ['שופרסל', 'shufersal']], ['ksp', ['ksp', 'קיי אס פי']],
  ['rami-levy', ['רמי לוי', 'rami levy']], ['victory', ['ויקטורי', 'victory']],
  ['osher-ad', ['אושר עד', 'osher ad']], ['tiv-taam', ['טיב טעם', 'tiv taam']],
];
export function merchantKey(value) {
  const text = clean(value);
  const matches = retailers.filter(([, names]) => names.some(n => (` ${text} `).includes(` ${n} `)));
  if (matches.length > 1) return null;
  return matches[0]?.[0] ?? (text || null);
}
export function merchantReview(store, identity, evidence = [], revision = '') {
  const merchant = identity?.merchant ?? null;
  const keys = [...new Set([merchant, ...evidence].filter(Boolean).map(merchantKey))];
  const expected = merchantKey(store), actual = merchantKey(merchant);
  const state = !actual || keys.includes(null) || keys.length > 1 ? 'unresolved'
    : !expected ? 'missing_store' : expected === actual ? 'matched' : 'mismatch';
  return { state, store: store || null, merchant,
    acknowledgment: JSON.stringify([revision, store ?? null, merchant, evidence, state]) };
}
