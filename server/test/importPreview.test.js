const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const xlsx = require('xlsx');
const profiles = require('../config/importProfiles');
const { importDate } = require('../utils/importDate');
const { loadControllerWithFake, createMockResponse } = require('./helpers/fakeSupabase');

const preview = async (buffer, profile = 'cal') => {
  const db = { from(table) {
    assert.equal(table, 'categories', 'Preview must not write financial records');
    return { select: async () => ({ data: [{ id: 1, name: 'General', keywords: [] }], error: null }) };
  } };
  const controller = loadControllerWithFake('../../controllers/importController', db);
  const res = createMockResponse();
  await controller.previewImport({ body: { profile }, file: { buffer } }, res);
  return res;
};

// Exact original UTF-8/BOM/CRLF acceptance input; no spreadsheet resave.
const acceptance = Buffer.from('\uFEFFSynthetic acceptance only\r\nNo bank connection\r\nLocal test\r\nתאריך עסקה,שם בית העסק,סכום חיוב,סכום עסקה,הערות\r\n08/11/2026,AC99 CSV coffee,20,20,');
test('original CAL acceptance CSV previews one November 8 expense and retains byte-based identity', async () => {
  const res = await preview(acceptance);
  assert.equal(res.statusCode, null, JSON.stringify(res.body));
  assert.equal(res.body.totalRows, 1);
  assert.deepEqual(res.body.previewData, [{
    id: `csv:${createHash('sha256').update('cal').update(acceptance).digest('hex')}:0`,
    transaction_date: '2026-11-08', charge_date: undefined, description: 'AC99 CSV coffee',
    total_amount: 20, movement_type: 'expense', original_amount: '20', currency: 'ILS',
    exchange_rate: null, installments_info: undefined, suggested_category: null, notes: null,
  }]);
  assert.deepEqual((await preview(acceptance)).body, res.body);
});

for (const [key, profile] of Object.entries(profiles)) {
  for (const format of ['csv', 'xlsx']) test(`${key} ${format} preserves profile offsets, purchase/charge dates and monetary evidence`, async () => {
    const m = profile.columnsMapping;
    const values = { [m.date]: format === 'csv' ? '08/11/2026' : 46334,
      [m.description]: 'Synthetic FX purchase', [m.amount]: 70.25, [m.originalAmount]: 20.15,
      [m.installments]: '2/3' };
    if (m.charge_date) values[m.charge_date] = format === 'csv' ? '02/12/2026' : 46358;
    if (m.currency) values[m.currency] = 'USD';
    if (m.exchangeRate) values[m.exchangeRate] = 3.486352;
    const headers = Object.keys(values);
    const data = [...Array.from({ length: profile.startRow }, () => ['Intro']), headers, Object.values(values)];
    let buffer;
    if (format === 'csv') buffer = Buffer.from('\uFEFF' + data.map(r => r.join(',')).join('\r\n'));
    else {
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(data), 'Synthetic');
      buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    }
    const res = await preview(buffer, key);
    assert.equal(res.statusCode, null, JSON.stringify(res.body));
    assert.equal(res.body.totalRows, 1);
    const row = res.body.previewData[0];
    assert.equal(row.transaction_date, '2026-11-08');
    assert.equal(row.charge_date, m.charge_date ? '2026-12-02' : undefined);
    assert.equal(row.total_amount, 70.25);
    assert.equal(String(row.original_amount), '20.15');
    assert.equal(row.currency, m.currency ? 'USD' : 'ILS');
    if (m.exchangeRate) assert.equal(String(row.exchange_rate), '3.486352');
    assert.equal(row.installments_info, '2/3');
  });
}

test('typed spreadsheet dates respect the 1904 workbook epoch', async () => {
  const wb = xlsx.utils.book_new();
  wb.Workbook = { WBProps: { date1904: true } };
  xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet([
    ['Intro'], ['Intro'], ['Intro'], ['תאריך עסקה', 'שם בית העסק', 'סכום חיוב'],
    [44872, 'Synthetic 1904 epoch', 20],
  ]), 'Synthetic');
  const res = await preview(xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  assert.equal(res.statusCode, null, JSON.stringify(res.body));
  assert.equal(res.body.previewData[0].transaction_date, '2026-11-08');
});

test('date normalization supports typed Date and explicit valid dates, rejecting invalid dates without rollover', () => {
  assert.equal(importDate(new Date('2026-11-08T00:00:00Z')), '2026-11-08');
  assert.equal(importDate('8/11/26'), '2026-11-08');
  assert.equal(importDate('2026-11-08'), '2026-11-08');
  assert.equal(importDate('31/12/1999'), '1999-12-31');
  assert.equal(importDate(46334.5), '2026-11-08');
  for (const value of ['########', '31/02/2026', '2026-02-31', '46334', 60, NaN, new Date('invalid')]) {
    assert.throws(() => importDate(value), /Invalid transaction_date/);
  }
});

test('literal hash marks and impossible CSV dates are rejected, not disguised as valid preview rows', async t => {
  t.mock.method(console, 'error', () => {});
  for (const value of ['########', '31/02/2026']) {
    const res = await preview(Buffer.from(acceptance.toString().replace('08/11/2026', value)));
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { error: 'Invalid transaction_date' });
  }
});
