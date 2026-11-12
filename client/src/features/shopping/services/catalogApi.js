// These routes match Gate 1. Only the isolated preview transport is enabled.
export function commandRoute(operation, id) {
  const target = encodeURIComponent(String(id));
  const categories = '/settings/shopping/catalog-categories';
  const products = '/settings/shopping/catalog-items';
  const routes = {
    'category.create': ['POST', categories],
    'category.change': ['PUT', `${categories}/${target}`],
    'product.create': ['POST', products],
    'product.edit': ['PUT', `${products}/${target}`],
    'product.deactivate': ['DELETE', `${products}/${target}`],
    'product.bulk-category': ['POST', `${products}/bulk-category`],
    'branches.replace': ['PUT', `/settings/shopping/list-types/${target}/categories`],
  };
  if (!routes[operation]) throw new Error('Unsupported Shopping command');
  return routes[operation];
}

const messages = {
  shopping_unauthenticated: 'יש להתחבר מחדש. הטיוטה נשמרה במסך.',
  shopping_forbidden: 'אין הרשאה לפעולה זו. הטיוטה נשמרה במסך.',
  shopping_revision_stale: 'הקטלוג השתנה. רעננו את הנתונים, בדקו את הטיוטה ואשרו שמירה מחדש.',
  shopping_key_conflict: 'מפתח הבקשה כבר שימש לפעולה אחרת. יש לבדוק את הנתונים לפני ניסיון חדש.',
  shopping_category_sibling_duplicate: 'כבר קיימת קטגוריה בשם זה תחת אותו הורה, גם אם היא לא פעילה.',
  shopping_category_cycle: 'לא ניתן להעביר קטגוריה לתוך אחד מצאצאיה.',
  shopping_category_self_parent: 'קטגוריה אינה יכולה להיות הורה של עצמה.',
  shopping_neutral_protected: 'הקטגוריה הניטרלית מוגנת ואינה ניתנת לשינוי.',
  shopping_neutral_parent: 'לא ניתן ליצור ילדים לקטגוריה הניטרלית.',
  shopping_category_unavailable: 'הקטגוריה או אחד מאבותיה אינם פעילים.',
  shopping_product_collision: 'מוצר בשם זה כבר קיים בקטגוריית היעד.',
  shopping_bulk_size_invalid: 'יש לבחור בין מוצר אחד ל־100 מוצרים.',
  shopping_precondition_required: 'חסר מידע על גרסת הקטלוג. רעננו לפני שמירה.',
  shopping_product_input_invalid: 'בדקו את שם המוצר, הקטגוריה והמחיר.',
  shopping_network_unknown: 'תוצאת הבקשה אינה ידועה. נסו שוב את אותה בקשה לפני שינוי הטיוטה.',
  shopping_refresh_failed: 'השינוי התקבל, אך הרענון נכשל. ניסיון חוזר עם אותו מפתח ישחזר את התוצאה ללא פעולה נוספת.',
  shopping_legacy_result_unavailable: 'לבקשה ישנה זו אין תשובה מלאה שמורה. יש לרענן ולבדוק את המצב לפני פעולה חדשה.',
};
export class CatalogError extends Error {
  constructor(code, status = 0) {
    super(messages[code] || (status === 404 ? 'הרשומה אינה זמינה. רעננו את הקטלוג.' : 'הפעולה לא הושלמה. בדקו את הנתונים ונסו שוב.'));
    this.code = code;
    this.status = status;
    this.uncertain = status === 0 || status >= 500;
  }
}

export function createPreviewApi({ enabled, location = globalThis.location, transport = globalThis.fetch } = {}) {
  if (!enabled || !['localhost', '127.0.0.1', '[::1]'].includes(location?.hostname)) {
    throw new Error('Shopping preview requires an explicitly enabled loopback development server');
  }
  async function request(path, { method = 'GET', body, headers = {}, signal } = {}) {
    let response;
    try {
      response = await transport(`/__shopping-preview/api${path}`, {
        method, credentials: 'omit', redirect: 'error', signal,
        headers: { 'Content-Type': 'application/json', 'X-Shopping-Preview': 'synthetic-only', ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      throw new CatalogError('shopping_network_unknown');
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new CatalogError(data?.code || 'shopping_request_failed', response.status);
    if (response.headers.get('X-Shopping-Preview') !== 'synthetic-only' || !data) throw new CatalogError('shopping_network_unknown');
    return data;
  }
  return Object.freeze({
    mode: 'preview',
    read: signal => request('/snapshot', { signal }),
    previewBranches: (id, categoryIds, signal) => request(`/visibility-preview/${encodeURIComponent(id)}`, { method: 'POST', body: { categoryIds }, signal }),
    prepare(operation, id, body, etag) {
      const [method, path] = commandRoute(operation, id);
      // Keep exact request bytes/key/revision on an unknown-outcome retry.
      return Object.freeze({ method, path, body: structuredClone(body), headers: Object.freeze({ 'If-Match': etag, 'Idempotency-Key': crypto.randomUUID() }) });
    },
    send: command => request(command.path, command),
  });
}
