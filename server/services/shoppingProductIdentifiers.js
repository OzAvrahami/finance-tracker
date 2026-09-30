// A checksum validates syntax, never the accuracy of OCR or a purchase identity.
function validGTIN(code) {
  if (typeof code !== 'string' || !/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false;
  const digits = [...code].map(Number);
  const check = digits.pop();
  const sum = digits.reverse().reduce((n, d, i) => n + d * (i % 2 ? 1 : 3), 0);
  return (10 - sum % 10) % 10 === check;
}
function identifier(code, kind = 'gtin', retailer = '') {
  if (typeof code !== 'string' || !/^[0-9]{3,20}$/.test(code)) return null;
  if (kind === 'gtin') return validGTIN(code) ? { kind, code, retailer_scope: '' } : null;
  if (kind !== 'retailer' || typeof retailer !== 'string' || !retailer.trim() || retailer.length > 120) return null;
  return { kind, code, retailer_scope: retailer.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ') };
}
module.exports = { validGTIN, identifier };
