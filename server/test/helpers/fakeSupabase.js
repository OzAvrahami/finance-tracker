/**
 * In-memory stand-in for the Supabase client, modelling the RPCs added in
 * migrations/003 closely enough to exercise the controllers.
 *
 * Scope of what this proves: the controller contract (validation, cursor
 * encoding/decoding, hasMore, page slicing, totals mapping, totals being
 * skipped when not requested) and the keyset pagination *protocol* — that a
 * full traversal under every supported sort visits every row exactly once.
 *
 * Scope of what it does NOT prove: that the SQL in the migration is itself
 * correct. This file is a second implementation of the same contract, so the
 * two can agree with each other and both be wrong about PostgreSQL. The SQL is
 * verified separately against the real database — see the read-only script in
 * docs/audit_003_readonly.sql.
 *
 * Two modelling rules are load-bearing and must not be "simplified":
 *   1. Description ordering compares UTF-8 BYTES, mirroring COLLATE "C".
 *      Not `<`/`>` on JS strings (UTF-16 code units) and never localeCompare().
 *   2. Amounts are decimal STRINGS compared and summed with BigInt.
 *      total_amount is NUMERIC; routing it through a double here would make the
 *      test agree with a bug the real database does not have.
 */

const Module = require('module');

// ---------------------------------------------------------------------------
// Exact decimal arithmetic (no floats anywhere near an amount)
// ---------------------------------------------------------------------------

const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

function splitDecimal(value) {
  const match = DECIMAL_PATTERN.exec(String(value));
  if (!match) throw new Error(`not a canonical decimal string: ${value}`);
  return { negative: match[1] === '-', int: match[2], frac: match[3] || '' };
}

/** Scales a decimal string to an integer BigInt at the given number of places. */
function toScaled(value, scale) {
  const { negative, int, frac } = splitDecimal(value);
  const padded = (frac + '0'.repeat(scale)).slice(0, scale);
  const magnitude = BigInt(int + (scale > 0 ? padded : ''));
  return negative ? -magnitude : magnitude;
}

function fractionDigits(value) {
  return splitDecimal(value).frac.length;
}

function compareDecimal(a, b) {
  const scale = Math.max(fractionDigits(a), fractionDigits(b));
  const left = toScaled(a, scale);
  const right = toScaled(b, scale);
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function negateDecimal(value) {
  const text = String(value);
  return text.startsWith('-') ? text.slice(1) : `-${text}`;
}

function sumDecimal(values) {
  if (values.length === 0) return '0';
  const scale = values.reduce((max, v) => Math.max(max, fractionDigits(v)), 0);
  const total = values.reduce((acc, v) => acc + toScaled(v, scale), 0n);
  if (scale === 0) return total.toString();

  const negative = total < 0n;
  const digits = (negative ? -total : total).toString().padStart(scale + 1, '0');
  const int = digits.slice(0, digits.length - scale);
  const frac = digits.slice(digits.length - scale);
  return `${negative ? '-' : ''}${int}.${frac}`;
}

// ---------------------------------------------------------------------------
// Comparators mirroring the SQL ORDER BY clauses
// ---------------------------------------------------------------------------

/** Mirrors PostgreSQL COLLATE "C" on UTF-8 text: byte order, not UTF-16 order. */
function compareBytes(a, b) {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function compareDateDesc(a, b) {
  if (a.transaction_date === b.transaction_date) return 0;
  return a.transaction_date < b.transaction_date ? 1 : -1;
}

/** The final tiebreaker in every branch: id DESC. */
function compareIdDesc(a, b) {
  return b.id - a.id;
}

/** `(description IS NULL) ASC` — NULL descriptions sort last in both directions. */
function compareNullRank(a, b) {
  return (a.description == null ? 1 : 0) - (b.description == null ? 1 : 0);
}

const SORTERS = {
  'transaction_date:desc': {
    compare: (a, b) => compareDateDesc(a, b) || compareIdDesc(a, b),
    after: (row, p) =>
      p.p_cursor_id == null ||
      row.transaction_date < p.p_cursor_date ||
      (row.transaction_date === p.p_cursor_date && row.id < p.p_cursor_id),
    key: (row) => ({ td: row.transaction_date, id: row.id }),
  },

  'transaction_date:asc': {
    compare: (a, b) => -compareDateDesc(a, b) || compareIdDesc(a, b),
    after: (row, p) =>
      p.p_cursor_id == null ||
      row.transaction_date > p.p_cursor_date ||
      (row.transaction_date === p.p_cursor_date && row.id < p.p_cursor_id),
    key: (row) => ({ td: row.transaction_date, id: row.id }),
  },

  'total_amount:desc': {
    compare: (a, b) =>
      -compareDecimal(a.total_amount, b.total_amount) ||
      compareDateDesc(a, b) ||
      compareIdDesc(a, b),
    after: (row, p) => {
      if (p.p_cursor_id == null) return true;
      const cmp = compareDecimal(row.total_amount, p.p_cursor_amount);
      if (cmp < 0) return true;
      if (cmp > 0) return false;
      return (
        row.transaction_date < p.p_cursor_date ||
        (row.transaction_date === p.p_cursor_date && row.id < p.p_cursor_id)
      );
    },
    key: (row) => ({ av: row.total_amount, td: row.transaction_date, id: row.id }),
  },

  'total_amount:asc': {
    compare: (a, b) =>
      compareDecimal(a.total_amount, b.total_amount) ||
      compareDateDesc(a, b) ||
      compareIdDesc(a, b),
    after: (row, p) => {
      if (p.p_cursor_id == null) return true;
      const cmp = compareDecimal(row.total_amount, p.p_cursor_amount);
      if (cmp > 0) return true;
      if (cmp < 0) return false;
      return (
        row.transaction_date < p.p_cursor_date ||
        (row.transaction_date === p.p_cursor_date && row.id < p.p_cursor_id)
      );
    },
    key: (row) => ({ av: row.total_amount, td: row.transaction_date, id: row.id }),
  },

  'description:asc': {
    compare: (a, b) =>
      compareNullRank(a, b) ||
      (a.description == null ? 0 : compareBytes(a.description, b.description)) ||
      compareDateDesc(a, b) ||
      compareIdDesc(a, b),
    after: (row, p) => {
      if (p.p_cursor_id == null) return true;
      if (p.p_cursor_description_is_null) {
        return (
          row.description == null &&
          (row.transaction_date < p.p_cursor_date ||
            (row.transaction_date === p.p_cursor_date && row.id < p.p_cursor_id))
        );
      }
      if (row.description == null) return true;
      const cmp = compareBytes(row.description, p.p_cursor_description);
      if (cmp > 0) return true;
      if (cmp < 0) return false;
      return (
        row.transaction_date < p.p_cursor_date ||
        (row.transaction_date === p.p_cursor_date && row.id < p.p_cursor_id)
      );
    },
    key: (row) => ({
      dn: row.description == null,
      dv: row.description == null ? null : row.description,
      td: row.transaction_date,
      id: row.id,
    }),
  },

  'description:desc': {
    compare: (a, b) =>
      compareNullRank(a, b) ||
      (a.description == null ? 0 : -compareBytes(a.description, b.description)) ||
      compareDateDesc(a, b) ||
      compareIdDesc(a, b),
    after: (row, p) => {
      if (p.p_cursor_id == null) return true;
      if (p.p_cursor_description_is_null) {
        return (
          row.description == null &&
          (row.transaction_date < p.p_cursor_date ||
            (row.transaction_date === p.p_cursor_date && row.id < p.p_cursor_id))
        );
      }
      if (row.description == null) return true;
      const cmp = compareBytes(row.description, p.p_cursor_description);
      if (cmp < 0) return true;
      if (cmp > 0) return false;
      return (
        row.transaction_date < p.p_cursor_date ||
        (row.transaction_date === p.p_cursor_date && row.id < p.p_cursor_id)
      );
    },
    key: (row) => ({
      dn: row.description == null,
      dv: row.description == null ? null : row.description,
      td: row.transaction_date,
      id: row.id,
    }),
  },
};

// ---------------------------------------------------------------------------
// Search: models transactions_search_pattern() + ILIKE ... ESCAPE '\'
// ---------------------------------------------------------------------------

/** Port of public.transactions_search_pattern(). Backslash is escaped first. */
function buildSearchPattern(search) {
  if (search == null || String(search).trim() === '') return null;
  const escaped = String(search)
    .trim()
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
  return `%${escaped}%`;
}

/** Evaluates `value ILIKE pattern ESCAPE '\'`. */
function ilikeMatch(value, pattern) {
  if (typeof value !== 'string' || pattern == null) return false;

  let regex = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') {
      i += 1;
      if (i < pattern.length) regex += pattern[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      continue;
    }
    if (ch === '%') { regex += '[\\s\\S]*'; continue; }
    if (ch === '_') { regex += '[\\s\\S]'; continue; }
    regex += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  return new RegExp(`^${regex}$`, 'iu').test(value);
}

function matchesFilters(row, p) {
  if (p.p_from && row.transaction_date < p.p_from) return false;
  if (p.p_to && row.transaction_date > p.p_to) return false;
  if (p.p_category_id != null && row.category_id !== p.p_category_id) return false;
  if (p.p_payment_source_id != null && row.payment_source_id !== p.p_payment_source_id) return false;
  if (p.p_uncategorized_only && row.category_id != null) return false;

  const pattern = buildSearchPattern(p.p_search);
  if (pattern) {
    // Mirrors the SQL: description, amount-as-text, category name, payment
    // source name. Notes are intentionally not searched, matching the behaviour
    // this replaced.
    const haystacks = [
      row.description,
      String(row.total_amount),
      row.categories?.name,
      row.payment_sources?.name,
    ];
    if (!haystacks.some((h) => ilikeMatch(h, pattern))) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------

function createFakeSupabase(rows, options = {}) {
  const calls = [];
  // Proves the aggregate is genuinely skipped rather than computed and dropped.
  const counters = { totalsComputed: 0 };

  return {
    calls,
    counters,
    rpc: async (fnName, params) => {
      calls.push({ fnName, params });

      if (options.failWith) {
        return { data: null, error: { message: options.failWith } };
      }

      if (fnName === 'transactions_page') {
        const sorter = SORTERS[`${params.p_sort_by}:${params.p_sort_direction}`];
        if (!sorter) {
          // Mirrors the RAISE EXCEPTION in the SQL: an unmapped sort is an
          // error, never a silent fallback to some other ordering.
          return {
            data: null,
            error: {
              message: `transactions_page: unsupported sort ${params.p_sort_by} ${params.p_sort_direction}`,
            },
          };
        }

        const filtered = rows.filter((r) => matchesFilters(r, params));

        // The +1 probe lives inside the function, exactly as in the SQL.
        const selected = filtered
          .filter((r) => sorter.after(r, params))
          .sort(sorter.compare)
          .slice(0, params.p_limit + 1);

        const hasMore = selected.length > params.p_limit;
        const page = hasMore ? selected.slice(0, params.p_limit) : selected;
        const nextKey = hasMore ? sorter.key(page[page.length - 1]) : null;

        let totals = null;
        if (params.p_include_totals) {
          counters.totalsComputed += 1;
          totals = {
            count: filtered.length,
            income: sumDecimal(
              filtered.filter((r) => r.movement_type === 'income').map((r) => r.total_amount)
            ),
            expense: sumDecimal(
              filtered.filter((r) => r.movement_type === 'expense').map((r) => r.total_amount)
            ),
          };
        }

        return {
          data: { data: page, has_more: hasMore, next_key: nextKey, totals },
          error: null,
        };
      }

      if (fnName === 'dashboard_summary') {
        const inRange = rows.filter(
          (r) =>
            (!params.p_from || r.transaction_date >= params.p_from) &&
            (!params.p_to || r.transaction_date <= params.p_to)
        );
        const income = sumDecimal(
          inRange.filter((r) => r.movement_type === 'income').map((r) => r.total_amount)
        );
        const expenses = sumDecimal(
          inRange.filter((r) => r.movement_type === 'expense').map((r) => r.total_amount)
        );
        return {
          data: {
            income,
            expenses,
            balance: sumDecimal([income, negateDecimal(expenses)]),
            count: inRange.length,
          },
          error: null,
        };
      }

      if (fnName === 'dashboard_monthly_series') {
        const months = params.p_months;
        const now = new Date();
        const series = [];
        for (let i = months - 1; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          const inMonth = rows.filter((r) => r.transaction_date.slice(0, 7) === key);
          series.push({
            month: key,
            income: sumDecimal(
              inMonth.filter((r) => r.movement_type === 'income').map((r) => r.total_amount)
            ),
            expenses: sumDecimal(
              inMonth.filter((r) => r.movement_type === 'expense').map((r) => r.total_amount)
            ),
          });
        }
        return { data: series, error: null };
      }

      return { data: null, error: { message: `unexpected rpc: ${fnName}` } };
    },
  };
}

/**
 * Loads a controller with `config/supabase` swapped for a fake.
 *
 * The controllers require the shared client at module load time, so the cache
 * entry has to be primed before the controller is required, and both must be
 * evicted afterwards to keep tests isolated.
 */
function loadControllerWithFake(controllerRelPath, fakeSupabase) {
  const supabasePath = require.resolve('../../config/supabase');
  const controllerPath = require.resolve(controllerRelPath);

  delete require.cache[supabasePath];
  delete require.cache[controllerPath];

  require.cache[supabasePath] = new Module(supabasePath, null);
  require.cache[supabasePath].filename = supabasePath;
  require.cache[supabasePath].loaded = true;
  require.cache[supabasePath].exports = fakeSupabase;

  const controller = require(controllerPath);

  delete require.cache[controllerPath];
  delete require.cache[supabasePath];

  return controller;
}

/** Minimal Express response double capturing status and JSON body. */
function createMockResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

module.exports = {
  createFakeSupabase,
  loadControllerWithFake,
  createMockResponse,
  SORTERS,
  compareBytes,
  compareDecimal,
  sumDecimal,
  buildSearchPattern,
  ilikeMatch,
};
