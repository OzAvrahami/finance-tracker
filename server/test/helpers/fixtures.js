/**
 * Deterministic transaction fixtures for the pagination and sorting tests.
 *
 * Shaped to reproduce the conditions of the real bug and its edge cases:
 *  - history spanning well before AND after 2026-04-09, the date at which the
 *    old 1000-row PostgREST cap silently cut the list off;
 *  - many transactions sharing a single transaction_date, so page boundaries
 *    land in the middle of a same-date run;
 *  - rows with no category and no payment source, so the uncategorized filter
 *    and the LEFT JOIN behaviour are exercised;
 *  - repeated amounts, repeated descriptions and NULL descriptions, so every
 *    sort has to fall through to its tiebreakers;
 *  - amounts a JS double cannot hold exactly, so a cursor that silently went
 *    through a float would land on the wrong row.
 *
 * `total_amount` is always a canonical decimal STRING, matching what PostgreSQL
 * renders for NUMERIC. Nothing in the test path may turn it into a Number.
 */

const CATEGORIES = [
  { id: 1, name: 'מזון', icon: '🍎' },
  { id: 2, name: 'תחבורה', icon: '🚌' },
  { id: 3, name: 'Lego', icon: '🧱' },
];

const PAYMENT_SOURCES = [
  { id: 10, name: 'ויזה', method: 'credit_card', slug: 'visa', issuer: 'Cal', last4: '1234' },
  { id: 20, name: 'מזומן', method: 'cash', slug: 'cash', issuer: null, last4: null },
];

/**
 * Builds `count` transactions spread backwards from `endDate`, cycling through
 * categories and payment sources. Every `sameDateRun` consecutive rows share a
 * date so page boundaries reliably split a same-date group.
 */
function buildTransactions({ count = 250, endDate = '2026-08-02', sameDateRun = 7 } = {}) {
  const rows = [];
  const cursor = new Date(`${endDate}T00:00:00Z`);
  let id = 1000;

  for (let i = 0; i < count; i++) {
    if (i > 0 && i % sameDateRun === 0) {
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    const transactionDate = cursor.toISOString().slice(0, 10);

    // Every 5th row is uncategorized, and those also have no payment source.
    const uncategorized = i % 5 === 0;
    const category = uncategorized ? null : CATEGORIES[i % CATEGORIES.length];
    const paymentSource = uncategorized ? null : PAYMENT_SOURCES[i % PAYMENT_SOURCES.length];

    rows.push({
      id: id++,
      transaction_date: transactionDate,
      description: `תנועה ${i}`,
      movement_type: i % 4 === 0 ? 'income' : 'expense',
      total_amount: `${100 + i}.00`,
      category_id: category ? category.id : null,
      payment_source_id: paymentSource ? paymentSource.id : null,
      notes: null,
      categories: category ? { name: category.name, icon: category.icon } : null,
      payment_sources: paymentSource,
    });
  }

  return rows;
}

/**
 * A dataset that straddles the April 2026 cutoff, used to prove that history
 * older than the old truncation point is reachable.
 */
function buildHistorySpanningCutoff() {
  const recent = buildTransactions({ count: 120, endDate: '2026-08-02', sameDateRun: 7 });
  const old = buildTransactions({ count: 120, endDate: '2024-03-15', sameDateRun: 7 }).map((r) => ({
    ...r,
    id: r.id + 100000,
  }));
  return [...recent, ...old];
}

function makeRow(id, transactionDate, description, totalAmount, extra = {}) {
  return {
    id,
    transaction_date: transactionDate,
    description,
    movement_type: 'expense',
    total_amount: totalAmount,
    category_id: CATEGORIES[0].id,
    payment_source_id: PAYMENT_SOURCES[0].id,
    notes: null,
    categories: { name: CATEGORIES[0].name, icon: CATEGORIES[0].icon },
    payment_sources: PAYMENT_SOURCES[0],
    ...extra,
  };
}

/**
 * Rows built specifically to stress the sort tiebreakers.
 *
 * Deliberate properties:
 *  - '250.00' appears on six rows, across two dates, so an amount sort must
 *    fall through to transaction_date and then to id;
 *  - 'כפול' appears on four rows, so a description sort must do the same;
 *  - three rows have a NULL description, which must land at the bottom under
 *    both directions;
 *  - '0.10' / '0.20' / '0.30' and the 17-digit values cannot be represented
 *    exactly as JS doubles. 9007199254740993 is 2^53+1: as a double it is
 *    indistinguishable from 9007199254740992, so a cursor that round-tripped
 *    through a Number would place the page boundary on the wrong row.
 */
function buildSortFixtures() {
  return [
    makeRow(1, '2026-05-10', 'alpha', '250.00'),
    makeRow(2, '2026-05-10', 'כפול', '250.00'),
    makeRow(3, '2026-05-10', 'beta', '9007199254740992.01'),
    makeRow(4, '2026-05-09', 'כפול', '250.00'),
    makeRow(5, '2026-05-09', null, '0.10'),
    makeRow(6, '2026-05-09', 'alpha', '9007199254740993.01'),
    makeRow(7, '2026-05-08', 'כפול', '0.20'),
    makeRow(8, '2026-05-08', null, '250.00'),
    makeRow(9, '2026-05-08', 'gamma', '0.30'),
    makeRow(10, '2026-05-07', 'כפול', '250.00'),
    makeRow(11, '2026-05-07', 'delta', '250.00'),
    makeRow(12, '2026-05-07', null, '1000.55'),
  ];
}

/**
 * Descriptions whose ordering differs between a linguistic database collation
 * (en_US.UTF-8 and friends) and COLLATE "C".
 *
 * Under "C", comparison is UTF-8 byte order, so:
 *  - all uppercase ASCII (0x41-0x5A) sorts before all lowercase (0x61-0x7A):
 *    'Zebra' < 'apple';
 *  - '_' (0x5F) falls between them;
 *  - space (0x20) and '-' (0x2D) sort before every letter, so
 *    'apple pie' < 'applepie' and 'co-op' < 'coop';
 *  - non-ASCII sorts after all ASCII by lead byte: 'Éclair' (0xC3) then Hebrew
 *    (0xD7), regardless of what a linguistic collation would do with them.
 *
 * A linguistic collation folds case and ignores punctuation at the primary
 * level, producing a visibly different order for exactly these values — which
 * is the point: if the cursor predicate ever compared under the database
 * default while the ORDER BY used "C", the page boundary would land somewhere
 * the sort never put it, and the traversal would skip and repeat rows.
 *
 * Duplicate descriptions and NULLs are included so the date/id tiebreakers and
 * the NULL block are crossed by the same traversal.
 */
function buildCollationFixtures() {
  const values = [
    '100 shekel',
    'A',
    'Apple',
    'BANANA',
    'Zebra',
    'ZEBRA',
    '_underscore',
    'a',
    'apple',
    'apple pie',
    'applepie',
    'banana',
    'co-op',
    'coop',
    'zebra',
    'Éclair',
    'שלום',
    'אבא',
    // Repeats, to force the transaction_date/id tiebreakers mid-traversal.
    'apple',
    'Zebra',
    'coop',
    'שלום',
    // NULL descriptions must sit at the bottom in both directions.
    null,
    null,
    null,
  ];

  return values.map((description, i) =>
    makeRow(
      500 + i,
      // Two dates only, so equal descriptions genuinely collide on date too and
      // the id tiebreaker is the only thing left.
      i % 2 === 0 ? '2026-06-02' : '2026-06-01',
      description,
      `${(i + 1) * 10}.00`
    )
  );
}

module.exports = {
  CATEGORIES,
  PAYMENT_SOURCES,
  buildTransactions,
  buildHistorySpanningCutoff,
  buildSortFixtures,
  buildCollationFixtures,
  makeRow,
};
