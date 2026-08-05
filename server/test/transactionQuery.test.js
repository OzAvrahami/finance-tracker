const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_TRANSACTION_PAGE_SIZE,
  MAX_TRANSACTION_PAGE_SIZE,
  MAX_SEARCH_LENGTH,
  MAX_CURSOR_LENGTH,
  CURSOR_VERSION,
  parseTransactionListQuery,
  encodeCursor,
  decodeCursor,
} = require('../utils/transactionQuery');

const ok = (query) => {
  const parsed = parseTransactionListQuery(query);
  assert.equal(parsed.ok, true, `expected ok, got: ${parsed.error}`);
  return parsed.value;
};

const rejected = (query) => {
  const parsed = parseTransactionListQuery(query);
  assert.equal(parsed.ok, false, `expected a validation error for ${JSON.stringify(query)}`);
  assert.equal(typeof parsed.error, 'string');
  return parsed.error;
};

/** Raw token builder, so malformed payloads can be constructed on purpose. */
const token = (payload) => Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

// ---------------------------------------------------------------------------

test('defaults: no query yields a bounded, newest-first page', () => {
  const value = ok({});
  assert.equal(value.limit, DEFAULT_TRANSACTION_PAGE_SIZE);
  assert.equal(value.sortBy, 'transaction_date');
  assert.equal(value.sortDirection, 'desc');
  assert.equal(value.cursor, null);
  assert.equal(value.includeTotals, false);
  assert.equal(value.from, null);
  assert.equal(value.to, null);
});

test('the UI "all" sentinel means no filter, not an id', () => {
  const value = ok({ categoryId: 'all', paymentSourceId: 'all' });
  assert.equal(value.categoryId, null);
  assert.equal(value.paymentSourceId, null);
});

test('dates: valid ISO accepted, impossible and malformed dates rejected', () => {
  assert.equal(ok({ from: '2024-02-29' }).from, '2024-02-29');
  rejected({ from: '2026-02-31' });
  rejected({ from: '2026-13-01' });
  rejected({ from: '01/01/2026' });
  rejected({ from: '2026-1-1' });
  rejected({ from: '2026-01-01T00:00:00Z' });
});

test('an inverted range is rejected rather than silently returning nothing', () => {
  rejected({ from: '2026-05-02', to: '2026-05-01' });
  assert.ok(ok({ from: '2026-05-01', to: '2026-05-01' }));
});

test('limit: unparseable is an error, over-max is clamped', () => {
  rejected({ limit: '0' });
  rejected({ limit: '-5' });
  rejected({ limit: '2.5' });
  rejected({ limit: 'abc' });
  assert.equal(
    ok({ limit: String(MAX_TRANSACTION_PAGE_SIZE + 1000) }).limit,
    MAX_TRANSACTION_PAGE_SIZE
  );
});

test('booleans are strict: only "true"/"false"', () => {
  assert.equal(ok({ includeTotals: 'true' }).includeTotals, true);
  assert.equal(ok({ uncategorizedOnly: 'false' }).uncategorizedOnly, false);
  for (const bad of ['1', 'yes', 'TRUE', 'on']) {
    rejected({ includeTotals: bad });
  }
});

test('search is trimmed and length-capped', () => {
  assert.equal(ok({ search: '  קפה  ' }).search, 'קפה');
  assert.equal(ok({ search: '   ' }).search, null);
  rejected({ search: 'x'.repeat(MAX_SEARCH_LENGTH + 1) });
});

// --- sort allowlist -------------------------------------------------------

test('sortBy accepts exactly the three previously sortable columns', () => {
  for (const field of ['transaction_date', 'description', 'total_amount']) {
    assert.equal(ok({ sortBy: field }).sortBy, field);
  }
});

test('sortDirection accepts exactly asc and desc', () => {
  assert.equal(ok({ sortDirection: 'asc' }).sortDirection, 'asc');
  assert.equal(ok({ sortDirection: 'desc' }).sortDirection, 'desc');
  for (const bad of ['ASC', 'ascending', 'up', '1', 'desc ']) {
    rejected({ sortDirection: bad });
  }
});

test('an unknown sortBy is rejected, never silently defaulted', () => {
  // Silently falling back would reorder someone's financial history without
  // saying so, which is worse than an error.
  for (const bad of ['notes', 'category_id', 'TRANSACTION_DATE', 'transaction_date ']) {
    rejected({ sortBy: bad });
  }
});

test('inherited Object properties cannot be used as a sort field', () => {
  // The allowlist is a null-prototype object read with Object.hasOwn. A plain
  // object literal would answer to these with an inherited value and pass a
  // naive `in` / truthiness check.
  for (const bad of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
    rejected({ sortBy: bad });
  }
});

test('SQL fragments are rejected as sort values, not interpolated', () => {
  const injections = [
    'transaction_date; DROP TABLE transactions',
    'transaction_date--',
    'total_amount DESC',
    'transaction_date, id',
    '1;--',
    '(SELECT 1)',
    'transaction_date/**/',
  ];
  for (const bad of injections) {
    rejected({ sortBy: bad });
    rejected({ sortDirection: bad });
  }
});

// --- cursor round-trip ----------------------------------------------------

test('cursor round-trips for the date sort', () => {
  const cursor = encodeCursor({ td: '2026-04-09', id: 8123 }, 'transaction_date', 'desc');
  const value = ok({ cursor });
  assert.deepEqual(value.cursor, {
    id: 8123,
    date: '2026-04-09',
    amount: null,
    description: null,
    descriptionIsNull: null,
  });
});

test('cursor round-trips for the amount sort, preserving the decimal exactly', () => {
  // 2^53 + 1: as a double this is indistinguishable from 9007199254740992, so a
  // cursor that went through a Number would seek to the wrong boundary row.
  const exact = '9007199254740993.01';
  const cursor = encodeCursor({ av: exact, td: '2026-04-09', id: 8123 }, 'total_amount', 'desc');
  const value = ok({ cursor, sortBy: 'total_amount' });
  assert.equal(value.cursor.amount, exact, 'amount must survive byte-for-byte');
  assert.equal(typeof value.cursor.amount, 'string', 'amount must stay a string');
  assert.notEqual(value.cursor.amount, String(Number(exact)));
});

test('cursor round-trips for the description sort, including the NULL block', () => {
  const withValue = encodeCursor(
    { dn: false, dv: 'סופר', td: '2026-04-09', id: 8123 },
    'description',
    'asc'
  );
  const parsedValue = ok({ cursor: withValue, sortBy: 'description', sortDirection: 'asc' });
  assert.equal(parsedValue.cursor.description, 'סופר');
  assert.equal(parsedValue.cursor.descriptionIsNull, false);

  const inNullBlock = encodeCursor(
    { dn: true, dv: null, td: '2026-04-09', id: 8123 },
    'description',
    'asc'
  );
  const parsedNull = ok({ cursor: inNullBlock, sortBy: 'description', sortDirection: 'asc' });
  assert.equal(parsedNull.cursor.description, null);
  assert.equal(parsedNull.cursor.descriptionIsNull, true);
});

// --- cursor rejection -----------------------------------------------------

test('a cursor issued for a different sort is rejected', () => {
  const dateCursor = encodeCursor({ td: '2026-04-09', id: 1 }, 'transaction_date', 'desc');
  rejected({ cursor: dateCursor, sortBy: 'total_amount' });
  rejected({ cursor: dateCursor, sortDirection: 'asc' });

  const amountCursor = encodeCursor({ av: '10.00', td: '2026-04-09', id: 1 }, 'total_amount', 'asc');
  rejected({ cursor: amountCursor, sortBy: 'total_amount', sortDirection: 'desc' });
  rejected({ cursor: amountCursor, sortBy: 'description', sortDirection: 'asc' });
});

test('a missing or unsupported cursor version is rejected', () => {
  rejected({ cursor: token({ s: 'transaction_date', d: 'desc', td: '2026-04-09', id: 1 }) });
  rejected({ cursor: token({ v: 0, s: 'transaction_date', d: 'desc', td: '2026-04-09', id: 1 }) });
  rejected({
    cursor: token({
      v: CURSOR_VERSION + 1,
      s: 'transaction_date',
      d: 'desc',
      td: '2026-04-09',
      id: 1,
    }),
  });
  rejected({ cursor: token({ v: '1', s: 'transaction_date', d: 'desc', td: '2026-04-09', id: 1 }) });
});

test('a cursor missing a field its sort needs is rejected', () => {
  // An amount cursor without `av` cannot express a position in an amount sort.
  rejected({
    cursor: token({ v: CURSOR_VERSION, s: 'total_amount', d: 'desc', td: '2026-04-09', id: 1 }),
    sortBy: 'total_amount',
  });
  // A description cursor without the NULL-rank flag re-enters the NULL block.
  rejected({
    cursor: token({
      v: CURSOR_VERSION,
      s: 'description',
      d: 'asc',
      dv: 'x',
      td: '2026-04-09',
      id: 1,
    }),
    sortBy: 'description',
    sortDirection: 'asc',
  });
});

test('a cursor carrying a field foreign to its sort is rejected', () => {
  rejected({
    cursor: token({
      v: CURSOR_VERSION,
      s: 'transaction_date',
      d: 'desc',
      td: '2026-04-09',
      id: 1,
      av: '10.00',
    }),
  });
});

test('wrongly typed cursor fields are rejected', () => {
  const base = { v: CURSOR_VERSION, s: 'transaction_date', d: 'desc' };
  rejected({ cursor: token({ ...base, td: '2026-04-09', id: '8123abc' }) });
  rejected({ cursor: token({ ...base, td: '2026-04-09', id: 0 }) });
  rejected({ cursor: token({ ...base, td: '2026-04-09', id: -1 }) });
  rejected({ cursor: token({ ...base, td: '2026-02-31', id: 1 }) });
  rejected({ cursor: token({ ...base, td: 20260409, id: 1 }) });

  rejected({
    cursor: token({
      v: CURSOR_VERSION,
      s: 'description',
      d: 'asc',
      dn: 'false',
      dv: 'x',
      td: '2026-04-09',
      id: 1,
    }),
    sortBy: 'description',
    sortDirection: 'asc',
  });
  // dn=true means "in the NULL block"; a value alongside it is contradictory.
  rejected({
    cursor: token({
      v: CURSOR_VERSION,
      s: 'description',
      d: 'asc',
      dn: true,
      dv: 'x',
      td: '2026-04-09',
      id: 1,
    }),
    sortBy: 'description',
    sortDirection: 'asc',
  });
});

test('a non-canonical decimal amount is rejected rather than coerced', () => {
  const bad = ['1e3', 'NaN', 'Infinity', '1.2.3', ' 1 ', '+1', '.5', '1.', '0x10'];
  for (const av of bad) {
    rejected({
      cursor: token({ v: CURSOR_VERSION, s: 'total_amount', d: 'desc', av, td: '2026-04-09', id: 1 }),
      sortBy: 'total_amount',
    });
  }
  // A JSON number is not accepted either: it has already lost precision.
  rejected({
    cursor: token({
      v: CURSOR_VERSION,
      s: 'total_amount',
      d: 'desc',
      av: 1234.56,
      td: '2026-04-09',
      id: 1,
    }),
    sortBy: 'total_amount',
  });
});

test('non-canonical base64url encodings are rejected', () => {
  const payload = { v: CURSOR_VERSION, s: 'transaction_date', d: 'desc', td: '2026-04-09', id: 1 };
  const good = token(payload);
  assert.ok(ok({ cursor: good }));

  const padded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64'); // '+', '/', '='
  const variants = [`${good}=`, `${good}==`, ` ${good}`, `${good} `, `${good}!`, 'not base64url!!'];
  for (const variant of variants) {
    rejected({ cursor: variant });
  }
  if (padded !== good) rejected({ cursor: padded });
});

test('a cursor that is not JSON, or not an object, is rejected', () => {
  rejected({ cursor: Buffer.from('not json', 'utf8').toString('base64url') });
  rejected({ cursor: Buffer.from('[1,2,3]', 'utf8').toString('base64url') });
  rejected({ cursor: Buffer.from('null', 'utf8').toString('base64url') });
  rejected({ cursor: Buffer.from('"a string"', 'utf8').toString('base64url') });
});

test('an over-length cursor is rejected before it is decoded', () => {
  rejected({ cursor: 'A'.repeat(MAX_CURSOR_LENGTH + 1) });
});

test('decodeCursor never throws, whatever it is handed', () => {
  const inputs = [null, undefined, 42, {}, [], '', '!!!!', 'A'.repeat(MAX_CURSOR_LENGTH + 1)];
  for (const input of inputs) {
    const result = decodeCursor(input, 'transaction_date', 'desc');
    assert.equal(result.ok, false);
    assert.equal(typeof result.error, 'string');
  }
});

test('encodeCursor stamps the version and the sort it belongs to', () => {
  const encoded = encodeCursor({ td: '2026-04-09', id: 7 }, 'transaction_date', 'asc');
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  assert.equal(payload.v, CURSOR_VERSION);
  assert.equal(payload.s, 'transaction_date');
  assert.equal(payload.d, 'asc');
  assert.equal(payload.td, '2026-04-09');
  assert.equal(payload.id, 7);
});
