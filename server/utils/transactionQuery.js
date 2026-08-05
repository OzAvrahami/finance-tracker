/**
 * Single source of truth for parsing, validating and clamping the query
 * parameters of the paginated transactions endpoint, and for encoding and
 * decoding the keyset cursor.
 *
 * Kept free of Express and Supabase so it can be unit tested directly and so
 * the same rules can be reused by any future consumer (export, reports, v1 API)
 * without the validation drifting between callers.
 */

const DEFAULT_TRANSACTION_PAGE_SIZE = 100;
const MAX_TRANSACTION_PAGE_SIZE = 250;

// Guards against pathological ILIKE patterns; well above any realistic search.
const MAX_SEARCH_LENGTH = 200;

// A cursor holds a date, an id and at most one description. Anything much
// larger than a long description is not a cursor this server produced.
const MAX_CURSOR_LENGTH = 2048;

// Bumped only if the payload shape changes incompatibly. An old client holding
// an old cursor then gets a clean validation error instead of a wrong page.
const CURSOR_VERSION = 1;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Canonical decimal, as PostgreSQL renders NUMERIC::text. Deliberately rejects
 * exponent notation, leading '+', whitespace and bare '.' — this value is a
 * sort boundary, and anything we cannot round-trip byte-for-byte is not one.
 */
const DECIMAL_PATTERN = /^-?\d{1,20}(\.\d{1,10})?$/;

/**
 * Sortable columns, as an allowlist keyed by the field name the UI uses.
 *
 * Null-prototype on purpose: a plain object literal would answer to
 * `sortBy=constructor` / `__proto__` / `toString` with an inherited value and
 * pass the membership check. `Object.hasOwn` plus a null prototype makes the
 * only reachable keys the three below.
 *
 * `cursorFields` is the exact set of payload keys the cursor for that sort must
 * carry — no more, no fewer. It is what makes a cursor from a different sort
 * structurally impossible to reuse.
 */
const SORT_FIELDS = Object.assign(Object.create(null), {
  transaction_date: { cursorFields: ['td', 'id'] },
  total_amount: { cursorFields: ['av', 'td', 'id'] },
  description: { cursorFields: ['dn', 'dv', 'td', 'id'] },
});

const SORT_DIRECTIONS = Object.assign(Object.create(null), {
  asc: true,
  desc: true,
});

const DEFAULT_SORT_BY = 'transaction_date';
const DEFAULT_SORT_DIRECTION = 'desc';

/**
 * Strict YYYY-MM-DD validation.
 *
 * Deliberately avoids `new Date(value)` normalisation: JS silently rolls
 * 2026-02-31 over to March 3rd, which would let an impossible date through and
 * silently shift a financial date range. Round-tripping through UTC catches it.
 */
function isValidDateString(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

/** Positive integer ids only. Rejects "1.5", "1e3", "abc", "-1", "0". */
function parsePositiveInt(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Accepts only the explicit strings "true"/"false" (and real booleans). */
function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function fail(message) {
  return { ok: false, error: message };
}

/**
 * Encodes a keyset position produced by the database into an opaque token.
 *
 * `key` comes straight from transactions_page().next_key, which builds it in
 * SQL with `total_amount::text` and `to_char(transaction_date,'YYYY-MM-DD')`.
 * That is deliberate: total_amount is NUMERIC, and reading it back off a JSON
 * row would already have put it through a double. Nothing here reformats,
 * re-parses or does arithmetic on those values — they are carried as strings.
 *
 * The token is NOT a security token. It is not signed and carries no privilege;
 * tampering can only change which page of already-authorised data comes back.
 * Do not add an HMAC believing it is one.
 */
function encodeCursor(key, sortBy, sortDirection) {
  if (!key || typeof key !== 'object') return null;
  const payload = { v: CURSOR_VERSION, s: sortBy, d: sortDirection, ...key };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Decodes and fully validates a cursor token against the sort it is being used
 * with. Never throws: every failure path returns { ok: false, error }.
 *
 * A cursor that does not match the requested sort is rejected rather than
 * ignored. Silently dropping it would restart pagination from the first row and
 * duplicate records; silently honouring it would seek on a key the current
 * ordering does not use, and skip records.
 */
function decodeCursor(token, sortBy, sortDirection) {
  if (typeof token !== 'string' || token === '') {
    return fail('cursor must be a non-empty string');
  }
  if (token.length > MAX_CURSOR_LENGTH) {
    return fail('cursor is not a valid pagination cursor');
  }
  // Buffer.from(..., 'base64url') is permissive: it accepts padding, standard
  // base64 '+'/'/', and silently discards trailing garbage. Check the alphabet
  // first, then require the decode to round-trip exactly, so only the canonical
  // encoding of a payload is accepted.
  if (!BASE64URL_PATTERN.test(token)) {
    return fail('cursor is not a valid pagination cursor');
  }

  const decoded = Buffer.from(token, 'base64url');
  if (decoded.toString('base64url') !== token) {
    return fail('cursor is not a valid pagination cursor');
  }

  let payload;
  try {
    payload = JSON.parse(decoded.toString('utf8'));
  } catch {
    return fail('cursor is not a valid pagination cursor');
  }

  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return fail('cursor is not a valid pagination cursor');
  }

  if (payload.v !== CURSOR_VERSION) {
    return fail('cursor is not a valid pagination cursor');
  }
  if (payload.s !== sortBy || payload.d !== sortDirection) {
    return fail('cursor does not match the requested sort');
  }

  const spec = Object.hasOwn(SORT_FIELDS, sortBy) ? SORT_FIELDS[sortBy] : null;
  if (!spec) return fail('cursor is not a valid pagination cursor');

  // Exact shape: every required field present, and no field that does not
  // belong to this sort. An extra key means the token was not produced for this
  // ordering, whatever else it may look like.
  const expected = new Set(['v', 's', 'd', ...spec.cursorFields]);
  const actual = Object.keys(payload);
  if (actual.length !== expected.size || actual.some((k) => !expected.has(k))) {
    return fail('cursor is not a valid pagination cursor');
  }

  const cursor = {
    id: null,
    date: null,
    amount: null,
    description: null,
    descriptionIsNull: null,
  };

  const id = parsePositiveInt(payload.id);
  if (id === null) return fail('cursor is not a valid pagination cursor');
  cursor.id = id;

  if (!isValidDateString(payload.td)) {
    return fail('cursor is not a valid pagination cursor');
  }
  cursor.date = payload.td;

  if (sortBy === 'total_amount') {
    // Validated as a string and passed on as a string. No Number(), no
    // Number.isFinite(), no arithmetic: total_amount is NUMERIC and a double
    // cannot represent every value it can hold, so coercing here could move the
    // page boundary. PostgreSQL casts it to numeric on the far side.
    if (typeof payload.av !== 'string' || !DECIMAL_PATTERN.test(payload.av)) {
      return fail('cursor is not a valid pagination cursor');
    }
    cursor.amount = payload.av;
  }

  if (sortBy === 'description') {
    if (typeof payload.dn !== 'boolean') {
      return fail('cursor is not a valid pagination cursor');
    }
    if (payload.dn) {
      // Inside the trailing NULL block the description value is meaningless and
      // must be absent, or the SQL predicate would compare against it.
      if (payload.dv !== null) return fail('cursor is not a valid pagination cursor');
    } else if (typeof payload.dv !== 'string') {
      return fail('cursor is not a valid pagination cursor');
    }
    cursor.descriptionIsNull = payload.dn;
    cursor.description = payload.dn ? null : payload.dv;
  }

  return { ok: true, value: cursor };
}

/**
 * Parses the request query for GET /api/transactions.
 *
 * Contract choices, made explicit because they are easy to get wrong:
 *  - An unparseable `limit` (non-integer, zero, negative) is a client error -> 400.
 *  - A `limit` above the maximum is NOT an error; it is clamped to
 *    MAX_TRANSACTION_PAGE_SIZE, so a caller asking for "everything" still gets a
 *    bounded, well-formed page instead of a failure.
 *  - `sortBy`/`sortDirection` are validated against a strict allowlist and are
 *    rejected outright rather than falling back to the default. A typo silently
 *    reordering someone's financial history is worse than an error.
 *  - The cursor is opaque and is validated against the sort it arrives with.
 *
 * @returns {{ok: true, value: object} | {ok: false, error: string}}
 */
function parseTransactionListQuery(query = {}) {
  const {
    from,
    to,
    categoryId,
    paymentSourceId,
    uncategorizedOnly,
    search,
    limit,
    sortBy,
    sortDirection,
    cursor,
    includeTotals,
  } = query;

  const result = {
    from: null,
    to: null,
    categoryId: null,
    paymentSourceId: null,
    uncategorizedOnly: false,
    search: null,
    limit: DEFAULT_TRANSACTION_PAGE_SIZE,
    sortBy: DEFAULT_SORT_BY,
    sortDirection: DEFAULT_SORT_DIRECTION,
    cursor: null,
    includeTotals: false,
  };

  if (from !== undefined && from !== '') {
    if (!isValidDateString(from)) return fail('from must be a valid date in YYYY-MM-DD format');
    result.from = from;
  }

  if (to !== undefined && to !== '') {
    if (!isValidDateString(to)) return fail('to must be a valid date in YYYY-MM-DD format');
    result.to = to;
  }

  if (result.from && result.to && result.from > result.to) {
    // Lexicographic comparison is safe for zero-padded ISO dates.
    return fail('from must be earlier than or equal to to');
  }

  if (categoryId !== undefined && categoryId !== '' && categoryId !== 'all') {
    const parsed = parsePositiveInt(categoryId);
    if (parsed === null) return fail('categoryId must be a positive integer');
    result.categoryId = parsed;
  }

  if (paymentSourceId !== undefined && paymentSourceId !== '' && paymentSourceId !== 'all') {
    const parsed = parsePositiveInt(paymentSourceId);
    if (parsed === null) return fail('paymentSourceId must be a positive integer');
    result.paymentSourceId = parsed;
  }

  if (uncategorizedOnly !== undefined && uncategorizedOnly !== '') {
    const parsed = parseBoolean(uncategorizedOnly);
    if (parsed === null) return fail('uncategorizedOnly must be "true" or "false"');
    result.uncategorizedOnly = parsed;
  }

  if (includeTotals !== undefined && includeTotals !== '') {
    const parsed = parseBoolean(includeTotals);
    if (parsed === null) return fail('includeTotals must be "true" or "false"');
    result.includeTotals = parsed;
  }

  if (search !== undefined && search !== null && String(search).trim() !== '') {
    const trimmed = String(search).trim();
    if (trimmed.length > MAX_SEARCH_LENGTH) {
      return fail(`search must be at most ${MAX_SEARCH_LENGTH} characters`);
    }
    result.search = trimmed;
  }

  if (limit !== undefined && limit !== '') {
    const parsed = parsePositiveInt(limit);
    if (parsed === null) return fail('limit must be a positive integer');
    result.limit = Math.min(parsed, MAX_TRANSACTION_PAGE_SIZE);
  }

  if (sortBy !== undefined && sortBy !== '') {
    if (typeof sortBy !== 'string' || !Object.hasOwn(SORT_FIELDS, sortBy)) {
      return fail(`sortBy must be one of: ${Object.keys(SORT_FIELDS).join(', ')}`);
    }
    result.sortBy = sortBy;
  }

  if (sortDirection !== undefined && sortDirection !== '') {
    if (typeof sortDirection !== 'string' || !Object.hasOwn(SORT_DIRECTIONS, sortDirection)) {
      return fail('sortDirection must be one of: asc, desc');
    }
    result.sortDirection = sortDirection;
  }

  if (cursor !== undefined && cursor !== '') {
    const decoded = decodeCursor(cursor, result.sortBy, result.sortDirection);
    if (!decoded.ok) return fail(decoded.error);
    result.cursor = decoded.value;
  }

  return { ok: true, value: result };
}

module.exports = {
  DEFAULT_TRANSACTION_PAGE_SIZE,
  MAX_TRANSACTION_PAGE_SIZE,
  MAX_SEARCH_LENGTH,
  MAX_CURSOR_LENGTH,
  CURSOR_VERSION,
  DEFAULT_SORT_BY,
  DEFAULT_SORT_DIRECTION,
  SORT_FIELDS,
  SORT_DIRECTIONS,
  isValidDateString,
  parsePositiveInt,
  parseBoolean,
  parseTransactionListQuery,
  encodeCursor,
  decodeCursor,
};
