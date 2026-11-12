// Revisions are captured with the displayed/draft row, never refreshed on save.
// Unknown outcomes retain exact body, token and key. There is no automatic retry.
export function workflowErrorMessage(error, fallback) {
  const code = error?.code || error?.response?.data?.code;
  if (code === 'shopping_revision_stale') return 'הרשימה השתנתה. הטיוטה נשמרה; רעננו ובדקו את השינוי לפני ניסיון נוסף.';
  if (!error?.response || code === 'shopping_commit_unknown') return 'תוצאת השמירה אינה ידועה. נסו שוב את אותה פעולה לפני שינוי הטיוטה.';
  return fallback;
}
export function createWorkflowTransport(api, key = () => crypto.randomUUID()) {
  const pending = new Map();
  return async function write(method, url, data, token) {
    const body = data ?? {}, identity = JSON.stringify(body), slot = method + ':' + url;
    let attempt = pending.get(slot);
    if (attempt && (attempt.identity !== identity || attempt.token !== token)) {
      throw Object.assign(new Error('Resolve the previous request before changing this draft'), { code: 'shopping_commit_unknown' });
    }
    if (!attempt) { attempt = { identity, token, key: key() };pending.set(slot, attempt); }
    try {
      const response = await api.request({ method, url, data: body, preserveAuthDraft: true,
        headers: { 'Idempotency-Key': attempt.key, ...(token ? { 'If-Match': token } : {}) } });
      pending.delete(slot);return response;
    } catch (error) {
      const status = error.response?.status, code = error.response?.data?.code;
      if (status && status < 500 || code === 'shopping_busy') pending.delete(slot);
      throw error;
    }
  };
}
