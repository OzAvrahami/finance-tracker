// Runtime settings may lower these storage/protocol ceilings, never exceed them.
const ceilings = Object.freeze({ files: 24, fileBytes: 20 * 1024 ** 2, totalBytes: 80 * 1024 ** 2,
  pdfPages: 40, sources: 64, pixels: 40_000_000, rows: 1000, durationMs: 600000, batch: 4 });
const defaults = Object.freeze({ ...ceilings, files: 20, totalBytes: 64 * 1024 ** 2,
  pdfPages: 30, pixels: 25_000_000, durationMs: 480000, batch: 2 });
function receiptLimits(env = process.env) {
  const result = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = env[`SHOPPING_RECEIPT_${key.replace(/[A-Z]/g, c => `_${c}`).toUpperCase()}`];
    result[key] = value == null ? fallback : Number(value);
    if (!Number.isSafeInteger(result[key]) || result[key] < 1 || result[key] > ceilings[key])
      throw Error('receipt_limits_invalid');
  }
  return result;
}
module.exports = { receiptLimits, ceilings };
