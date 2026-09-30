// Closed aliases for existing Shopping display units. No scale or pack conversion.
const token = (value) =>
  typeof value === "string"
    ? value
        .normalize("NFKC")
        .trim()
        .toLowerCase()
        .replace(/[\s\u200e\u200f]/g, "")
        .replace(/["'״׳‘’“”`]/g, "")
    : null;
const groups = [
  ["יח׳", ["יח", "יחידה", "יחידות", "unit", "units"]],
  ["ק״ג", ["קג", "קילוגרם", "kg", "kilogram", "kilograms"]],
  ["גרם", ["גרם", "גרמים", "g", "gram", "grams"]],
  ["ליטר", ["ליטר", "ליטרים", "l", "liter", "litre"]],
  ["מ״ל", ["מל", "מיליליטר", "ml"]],
  ["חבילה", ["חבילה", "חבילות", "package", "packages"]],
  ["מארז", ["מארז", "מארזים"]],
];
const aliases = new Map(
  groups.flatMap(([unit, values]) => values.map((v) => [token(v), unit])),
);
function canonicalReceiptUnit(value) {
  return aliases.get(token(value)) ?? value;
}
function equivalentReceiptUnits(a, b) {
  const ca = aliases.get(token(a)),
    cb = aliases.get(token(b));
  return ca != null && ca === cb;
}
module.exports = { canonicalReceiptUnit, equivalentReceiptUnits };
