const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createFakeSupabase,
  loadControllerWithFake,
  createMockResponse,
  SORTERS,
  compareBytes,
  compareDecimal,
} = require('./helpers/fakeSupabase');
const {
  buildTransactions,
  buildHistorySpanningCutoff,
  buildSortFixtures,
  buildCollationFixtures,
} = require('./helpers/fixtures');

const SORTS = [
  { sortBy: 'transaction_date', sortDirection: 'desc' },
  { sortBy: 'transaction_date', sortDirection: 'asc' },
  { sortBy: 'total_amount', sortDirection: 'desc' },
  { sortBy: 'total_amount', sortDirection: 'asc' },
  { sortBy: 'description', sortDirection: 'desc' },
  { sortBy: 'description', sortDirection: 'asc' },
];

function callGetTransactions(rows, query, options) {
  const fake = createFakeSupabase(rows, options);
  const controller = loadControllerWithFake('../../controllers/transactionController', fake);
  const res = createMockResponse();
  return controller.getTransactions({ query }, res).then(() => ({ res, fake }));
}

/**
 * Walks every page of a filtered result set.
 *
 * The cursor is echoed back exactly as received — the test never builds one,
 * which is the same contract the browser has.
 */
async function traverseAll(rows, baseQuery = {}, limit = 25) {
  const collected = [];
  const pageSizes = [];
  let cursor = null;
  let guard = 0;
  let totalsSeen = 0;

  for (;;) {
    if (++guard > 1000) throw new Error('pagination did not terminate');

    const query = { ...baseQuery, limit: String(limit) };
    if (cursor) query.cursor = cursor;

    const { res } = await callGetTransactions(rows, query);
    assert.equal(res.statusCode, 200, `page ${guard} failed: ${JSON.stringify(res.body)}`);
    if (res.body.totals) totalsSeen += 1;

    collected.push(...res.body.data);
    pageSizes.push(res.body.data.length);

    if (!res.body.pagination.hasMore) {
      assert.equal(res.body.pagination.nextCursor, null, 'final page must not carry a cursor');
      break;
    }
    cursor = res.body.pagination.nextCursor;
    assert.equal(typeof cursor, 'string', 'cursor must be an opaque string');
  }

  return { collected, pageSizes, pageCount: guard, totalsSeen };
}

/**
 * The core pagination invariant: a full traversal visits every matching row
 * exactly once, in the order the sort defines. Any keyset bug shows up here as
 * a skipped id, a duplicated id, or an out-of-order pair.
 */
function assertCompleteTraversal(collected, expectedRows, sorter, label) {
  const collectedIds = collected.map((r) => r.id);
  const expectedIds = expectedRows.map((r) => r.id);

  const duplicates = collectedIds.filter((id, i) => collectedIds.indexOf(id) !== i);
  assert.deepEqual(duplicates, [], `${label}: duplicate ids returned`);

  const missing = expectedIds.filter((id) => !collectedIds.includes(id));
  assert.deepEqual(missing, [], `${label}: skipped ids`);

  assert.equal(collectedIds.length, expectedIds.length, `${label}: wrong row count`);

  const expectedOrder = [...expectedRows].sort(sorter.compare).map((r) => r.id);
  assert.deepEqual(collectedIds, expectedOrder, `${label}: rows out of order`);
}

// ---------------------------------------------------------------------------

test('page shape', async (t) => {
  const rows = buildTransactions({ count: 250 });

  await t.test('returns at most the requested limit', async () => {
    const { res } = await callGetTransactions(rows, { limit: '25' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.length, 25);
    assert.equal(res.body.pagination.limit, 25);
  });

  await t.test('the probe row is requested by SQL, not by the controller', async () => {
    // p_limit is the true page size now: the +1 probe lives inside the SQL
    // function, so it cannot leak into the response by way of a missed slice.
    const { res, fake } = await callGetTransactions(rows, { limit: '25' });
    assert.equal(fake.calls[0].params.p_limit, 25);
    assert.equal(res.body.data.length, 25);
  });

  await t.test('echoes the sort it applied', async () => {
    const { res } = await callGetTransactions(rows, { sortBy: 'total_amount', sortDirection: 'asc' });
    assert.equal(res.body.pagination.sortBy, 'total_amount');
    assert.equal(res.body.pagination.sortDirection, 'asc');
  });

  await t.test('a full-but-final page reports hasMore false and no cursor', async () => {
    const exact = buildTransactions({ count: 25 });
    const { res } = await callGetTransactions(exact, { limit: '25' });
    assert.equal(res.body.data.length, 25);
    assert.equal(res.body.pagination.hasMore, false);
    assert.equal(res.body.pagination.nextCursor, null);
  });

  await t.test('an empty result is an empty page, not an error', async () => {
    const { res } = await callGetTransactions(rows, { from: '2030-01-01', to: '2030-01-02' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data, []);
    assert.equal(res.body.pagination.hasMore, false);
    assert.equal(res.body.pagination.nextCursor, null);
  });
});

test('default sort traverses the whole history without gaps or duplicates', async (t) => {
  const rows = buildHistorySpanningCutoff();

  await t.test('every row is reachable exactly once', async () => {
    const { collected } = await traverseAll(rows, {}, 25);
    assertCompleteTraversal(collected, rows, SORTERS['transaction_date:desc'], 'default sort');
  });

  await t.test('history older than the old 1000-row cutoff is reachable', async () => {
    const { collected } = await traverseAll(rows, {}, 25);
    assert.ok(
      collected.some((r) => r.transaction_date < '2026-04-09'),
      'rows older than the truncation point must be reachable'
    );
    assert.ok(collected.some((r) => r.transaction_date.startsWith('2024-')));
  });

  await t.test('page boundaries that split a same-date run lose nothing', async () => {
    // sameDateRun = 7 against limit 5 guarantees boundaries land mid-run.
    const sameDate = buildTransactions({ count: 60, sameDateRun: 7 });
    const { collected } = await traverseAll(sameDate, {}, 5);
    assertCompleteTraversal(collected, sameDate, SORTERS['transaction_date:desc'], 'same-date run');
  });
});

test('every supported sort paginates correctly', async (t) => {
  const rows = buildSortFixtures();

  for (const sort of SORTS) {
    const label = `${sort.sortBy} ${sort.sortDirection}`;
    const sorter = SORTERS[`${sort.sortBy}:${sort.sortDirection}`];

    await t.test(`${label}: full traversal, no skipped or duplicate ids`, async () => {
      // limit 3 against 12 rows forces four pages and puts boundaries inside
      // the repeated-amount and repeated-description runs.
      const { collected, pageCount } = await traverseAll(rows, sort, 3);
      assert.ok(pageCount >= 4, `${label}: expected multiple pages, got ${pageCount}`);
      assertCompleteTraversal(collected, rows, sorter, label);
    });

    await t.test(`${label}: single page matches the multi-page order`, async () => {
      const { res } = await callGetTransactions(rows, { ...sort, limit: '100' });
      const { collected } = await traverseAll(rows, sort, 3);
      assert.deepEqual(
        res.body.data.map((r) => r.id),
        collected.map((r) => r.id),
        `${label}: page size must not change the order`
      );
    });
  }
});

test('sort direction actually reverses the result', async (t) => {
  const rows = buildSortFixtures();

  await t.test('amount asc is the reverse ordering of amount desc', async () => {
    const asc = await traverseAll(rows, { sortBy: 'total_amount', sortDirection: 'asc' }, 5);
    const desc = await traverseAll(rows, { sortBy: 'total_amount', sortDirection: 'desc' }, 5);

    const ascAmounts = asc.collected.map((r) => r.total_amount);
    for (let i = 1; i < ascAmounts.length; i++) {
      assert.ok(
        compareDecimal(ascAmounts[i - 1], ascAmounts[i]) <= 0,
        'ascending amounts must not decrease'
      );
    }
    const descAmounts = desc.collected.map((r) => r.total_amount);
    for (let i = 1; i < descAmounts.length; i++) {
      assert.ok(
        compareDecimal(descAmounts[i - 1], descAmounts[i]) >= 0,
        'descending amounts must not increase'
      );
    }
    assert.notDeepEqual(
      asc.collected.map((r) => r.id),
      desc.collected.map((r) => r.id)
    );
  });

  await t.test('date asc starts at the oldest row, date desc at the newest', async () => {
    const asc = await traverseAll(rows, { sortBy: 'transaction_date', sortDirection: 'asc' }, 5);
    const desc = await traverseAll(rows, { sortBy: 'transaction_date', sortDirection: 'desc' }, 5);
    assert.equal(asc.collected[0].transaction_date, '2026-05-07');
    assert.equal(desc.collected[0].transaction_date, '2026-05-10');
  });
});

test('same-value boundaries fall through to the tiebreakers', async (t) => {
  const rows = buildSortFixtures();

  await t.test('rows sharing an amount are ordered by date then id, never repeated', async () => {
    const { collected } = await traverseAll(rows, { sortBy: 'total_amount', sortDirection: 'desc' }, 2);
    const shared = collected.filter((r) => r.total_amount === '250.00');
    assert.equal(shared.length, 6, 'all six rows sharing the amount must appear');
    assert.equal(new Set(shared.map((r) => r.id)).size, 6, 'and each exactly once');

    for (let i = 1; i < shared.length; i++) {
      const prev = shared[i - 1];
      const curr = shared[i];
      if (prev.transaction_date === curr.transaction_date) {
        assert.ok(prev.id > curr.id, 'equal date must fall through to id DESC');
      } else {
        assert.ok(prev.transaction_date > curr.transaction_date, 'equal amount falls to date DESC');
      }
    }
  });

  await t.test('rows sharing a description are ordered by date then id', async () => {
    const { collected } = await traverseAll(rows, { sortBy: 'description', sortDirection: 'asc' }, 2);
    const shared = collected.filter((r) => r.description === 'כפול');
    assert.equal(shared.length, 4);
    assert.equal(new Set(shared.map((r) => r.id)).size, 4);
  });
});

test('NULL descriptions sort last in both directions', async (t) => {
  const rows = buildSortFixtures();

  for (const direction of ['asc', 'desc']) {
    await t.test(`description ${direction}: NULLs are at the bottom`, async () => {
      const { collected } = await traverseAll(rows, { sortBy: 'description', sortDirection: direction }, 3);
      const firstNull = collected.findIndex((r) => r.description == null);
      const lastNamed = collected.map((r) => r.description == null).lastIndexOf(false);

      assert.ok(firstNull > -1, 'the fixture has NULL descriptions');
      assert.ok(firstNull > lastNamed, `${direction}: a NULL appeared before a named row`);
      assert.equal(collected.filter((r) => r.description == null).length, 3);
    });
  }

  await t.test('the NULL block is crossed without skipping or repeating rows', async () => {
    // limit 2 puts a page boundary inside the NULL block itself, which is where
    // a cursor that forgot the null-rank flag would restart the block.
    const { collected } = await traverseAll(rows, { sortBy: 'description', sortDirection: 'asc' }, 2);
    assertCompleteTraversal(collected, rows, SORTERS['description:asc'], 'NULL block crossing');
  });
});

test('description ordering is COLLATE "C", and the cursor agrees with it', async (t) => {
  // Regression test for the specific failure mode where the ORDER BY used
  // COLLATE "C" but the cursor predicate compared under the database default
  // collation. The fixture is built from values whose relative order differs
  // between the two: 'Zebra' < 'apple' by byte, but after it linguistically;
  // 'apple pie' < 'applepie' by byte, the reverse when punctuation is ignored.
  // Under a mismatch the traversal skips and repeats rows at the boundary.
  const rows = buildCollationFixtures();

  for (const direction of ['asc', 'desc']) {
    const sorter = SORTERS[`description:${direction}`];

    await t.test(`description ${direction}: multi-page traversal is exact`, async () => {
      const { collected, pageCount } = await traverseAll(
        rows,
        { sortBy: 'description', sortDirection: direction },
        4
      );
      assert.ok(pageCount >= 6, `expected several pages, got ${pageCount}`);
      assertCompleteTraversal(collected, rows, sorter, `collation ${direction}`);
    });

    await t.test(`description ${direction}: order is byte order, not linguistic`, async () => {
      const { collected } = await traverseAll(
        rows,
        { sortBy: 'description', sortDirection: direction },
        4
      );
      const named = collected.filter((r) => r.description != null);

      for (let i = 1; i < named.length; i++) {
        const cmp = compareBytes(named[i - 1].description, named[i].description);
        if (direction === 'asc') {
          assert.ok(cmp <= 0, `${named[i - 1].description} must not follow ${named[i].description}`);
        } else {
          assert.ok(cmp >= 0, `${named[i - 1].description} must not precede ${named[i].description}`);
        }
      }
    });
  }

  await t.test('uppercase sorts before lowercase, as COLLATE "C" requires', async () => {
    const { collected } = await traverseAll(rows, { sortBy: 'description', sortDirection: 'asc' }, 4);
    const order = collected.filter((r) => r.description != null).map((r) => r.description);
    // A linguistic collation would fold case and interleave these.
    assert.ok(order.indexOf('Zebra') < order.indexOf('apple'), '"Zebra" must precede "apple"');
    assert.ok(order.indexOf('BANANA') < order.indexOf('a'), '"BANANA" must precede "a"');
    assert.ok(order.indexOf('apple pie') < order.indexOf('applepie'), 'space sorts before letters');
    assert.ok(order.indexOf('co-op') < order.indexOf('coop'), 'hyphen sorts before letters');
    assert.ok(order.indexOf('zebra') < order.indexOf('Éclair'), 'ASCII sorts before non-ASCII');
    assert.ok(order.indexOf('Éclair') < order.indexOf('שלום'), 'by UTF-8 lead byte');
  });

  await t.test('every page boundary lands where the sort put it', async () => {
    // Page-size sweep: with a collation mismatch, only some page sizes place a
    // boundary on an affected pair, so a single size can pass by luck.
    for (const limit of [1, 2, 3, 4, 5, 7, 11]) {
      const { collected } = await traverseAll(
        rows,
        { sortBy: 'description', sortDirection: 'asc' },
        limit
      );
      assertCompleteTraversal(
        collected,
        rows,
        SORTERS['description:asc'],
        `collation asc, limit ${limit}`
      );
    }
  });
});

test('amounts a double cannot represent still paginate correctly', async () => {
  const rows = buildSortFixtures();
  const { collected } = await traverseAll(rows, { sortBy: 'total_amount', sortDirection: 'desc' }, 2);

  assertCompleteTraversal(collected, rows, SORTERS['total_amount:desc'], 'exact decimals');

  // 9007199254740993.01 and 9007199254740992.01 collapse to the same double.
  // They must still be ordered, and both must appear exactly once.
  const big = collected.filter((r) => r.total_amount.startsWith('900719925474099'));
  assert.equal(big.length, 2);
  assert.equal(big[0].total_amount, '9007199254740993.01');
  assert.equal(big[1].total_amount, '9007199254740992.01');
});

test('filters combine with sorting', async (t) => {
  const rows = buildTransactions({ count: 120 });

  for (const sort of SORTS) {
    const label = `${sort.sortBy} ${sort.sortDirection}`;

    await t.test(`${label}: a category filter still traverses completely`, async () => {
      const expected = rows.filter((r) => r.category_id === 1);
      assert.ok(expected.length > 5, 'fixture must exercise the filter');

      const { collected } = await traverseAll(rows, { ...sort, categoryId: '1' }, 4);
      assert.ok(collected.every((r) => r.category_id === 1), `${label}: filter leaked`);
      assertCompleteTraversal(
        collected,
        expected,
        SORTERS[`${sort.sortBy}:${sort.sortDirection}`],
        `${label} + category`
      );
    });
  }

  await t.test('a date range plus a sort returns only rows in range', async () => {
    const { collected } = await traverseAll(
      rows,
      { sortBy: 'total_amount', sortDirection: 'asc', from: '2026-07-20', to: '2026-07-31' },
      5
    );
    assert.ok(collected.length > 0);
    assert.ok(collected.every((r) => r.transaction_date >= '2026-07-20'));
    assert.ok(collected.every((r) => r.transaction_date <= '2026-07-31'));
  });

  await t.test('uncategorizedOnly plus a sort returns only uncategorized rows', async () => {
    const { collected } = await traverseAll(
      rows,
      { sortBy: 'description', sortDirection: 'asc', uncategorizedOnly: 'true' },
      5
    );
    assert.ok(collected.length > 0);
    assert.ok(collected.every((r) => r.category_id == null));
  });
});

test('search escaping treats wildcards literally', async (t) => {
  const { makeRow } = require('./helpers/fixtures');
  const rows = [
    makeRow(1, '2026-05-01', 'הנחה 50% ברשת', '10.00'),
    makeRow(2, '2026-05-01', 'סכום 500 שקל', '20.00'),
    makeRow(3, '2026-05-01', 'a_b קוד', '30.00'),
    makeRow(4, '2026-05-01', 'axb קוד', '40.00'),
    makeRow(5, '2026-05-01', 'נתיב C:\\temp', '50.00'),
  ];

  await t.test('% is a literal percent, not a wildcard', async () => {
    const { res } = await callGetTransactions(rows, { search: '50%' });
    assert.deepEqual(res.body.data.map((r) => r.id), [1]);
  });

  await t.test('_ is a literal underscore, not a single-character wildcard', async () => {
    const { res } = await callGetTransactions(rows, { search: 'a_b' });
    assert.deepEqual(res.body.data.map((r) => r.id), [3]);
  });

  await t.test('a backslash is a literal backslash', async () => {
    const { res } = await callGetTransactions(rows, { search: 'C:\\temp' });
    assert.deepEqual(res.body.data.map((r) => r.id), [5]);
  });

  await t.test('a bare % does not match everything', async () => {
    const { res } = await callGetTransactions(rows, { search: '%' });
    assert.deepEqual(res.body.data.map((r) => r.id), [1]);
  });
});

test('totals', async (t) => {
  const rows = buildTransactions({ count: 120 });

  await t.test('cover the whole filtered set, not the returned page', async () => {
    const { res } = await callGetTransactions(rows, { limit: '10', includeTotals: 'true' });
    assert.equal(res.body.data.length, 10);
    assert.equal(res.body.totals.count, 120);
  });

  await t.test('are identical under every sort', async () => {
    const reference = (await callGetTransactions(rows, { includeTotals: 'true' })).res.body.totals;
    for (const sort of SORTS) {
      const { res } = await callGetTransactions(rows, { ...sort, includeTotals: 'true' });
      assert.deepEqual(res.body.totals, reference, `${sort.sortBy} ${sort.sortDirection}`);
    }
  });

  await t.test('are omitted when not requested', async () => {
    const { res, fake } = await callGetTransactions(rows, { limit: '10' });
    assert.equal(res.body.totals, undefined);
    assert.equal(fake.calls[0].params.p_include_totals, false);
    assert.equal(fake.counters.totalsComputed, 0, 'the aggregate must not run');
  });

  await t.test('are computed on the first page only during a traversal', async () => {
    // Re-aggregating the whole filtered set on every "load more" would be a
    // silent performance regression; the SQL guards it behind a real IF.
    const fake = createFakeSupabase(rows);
    const controller = loadControllerWithFake('../../controllers/transactionController', fake);

    let cursor = null;
    let first = true;
    for (let page = 0; page < 4; page++) {
      const query = { limit: '25' };
      if (first) query.includeTotals = 'true';
      if (cursor) query.cursor = cursor;

      const res = createMockResponse();
      await controller.getTransactions({ query }, res);
      assert.equal(res.statusCode, 200);

      cursor = res.body.pagination.nextCursor;
      first = false;
      if (!cursor) break;
    }

    assert.equal(fake.counters.totalsComputed, 1, 'totals must be aggregated exactly once');
    assert.equal(fake.calls.length > 1, true, 'the traversal must have made several calls');
    assert.deepEqual(
      fake.calls.slice(1).map((c) => c.params.p_include_totals),
      fake.calls.slice(1).map(() => false)
    );
  });
});

test('validation rejects bad input before any database call', async (t) => {
  const rows = buildTransactions({ count: 10 });

  const badQueries = [
    { from: 'yesterday' },
    { to: '2026-02-31' },
    { from: '2026-05-02', to: '2026-05-01' },
    { categoryId: 'abc' },
    { paymentSourceId: '-1' },
    { limit: '0' },
    { includeTotals: 'yes' },
    { uncategorizedOnly: '1' },
    { sortBy: 'notes' },
    { sortBy: 'total_amount; DROP TABLE transactions' },
    { sortBy: 'constructor' },
    { sortBy: '__proto__' },
    { sortDirection: 'ASC' },
    { cursor: 'not-a-real-cursor!!' },
    { cursor: Buffer.from('{}', 'utf8').toString('base64url') },
  ];

  for (const query of badQueries) {
    await t.test(`400 for ${JSON.stringify(query)}`, async () => {
      const { res, fake } = await callGetTransactions(rows, query);
      assert.equal(res.statusCode, 400);
      assert.equal(typeof res.body.error, 'string');
      assert.equal(fake.calls.length, 0, 'no RPC may be issued for an invalid request');
    });
  }
});

test('a cursor cannot be carried across a sort change', async () => {
  const rows = buildSortFixtures();

  const { res: first } = await callGetTransactions(rows, {
    limit: '3',
    sortBy: 'total_amount',
    sortDirection: 'desc',
  });
  const cursor = first.body.pagination.nextCursor;
  assert.equal(typeof cursor, 'string');

  // Same cursor, different sort: rejected, and no RPC issued. Reusing it would
  // seek on a key the new ordering does not use, silently skipping rows.
  for (const sort of [
    { sortBy: 'total_amount', sortDirection: 'asc' },
    { sortBy: 'description', sortDirection: 'desc' },
    { sortBy: 'transaction_date', sortDirection: 'desc' },
  ]) {
    const { res, fake } = await callGetTransactions(rows, { limit: '3', cursor, ...sort });
    assert.equal(res.statusCode, 400, `${JSON.stringify(sort)} must reject the stale cursor`);
    assert.equal(fake.calls.length, 0);
  }
});

test('an unsupported sort never reaches an unordered result', async () => {
  // Belt and braces: if the allowlist were ever bypassed, the SQL raises rather
  // than returning rows in whatever order the planner chose.
  const rows = buildSortFixtures();
  const fake = createFakeSupabase(rows);
  const result = await fake.rpc('transactions_page', {
    p_sort_by: 'notes',
    p_sort_direction: 'desc',
    p_limit: 10,
  });
  assert.equal(result.data, null);
  assert.match(result.error.message, /unsupported sort/);
});

test('a database error is surfaced, not swallowed', async () => {
  const rows = buildTransactions({ count: 10 });
  const { res } = await callGetTransactions(rows, {}, { failWith: 'connection reset' });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /connection reset/);
});
