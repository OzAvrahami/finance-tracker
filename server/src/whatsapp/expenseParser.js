/**
 * Parse a WhatsApp message like "שופרסל 150" or "150 שופרסל" into { merchant, amount }.
 * Supports amount at the start or end of the string.
 * Returns null if the text doesn't match the pattern.
 *
 * Examples:
 *   "שופרסל 150"     → { merchant: "שופרסל", amount: 150 }
 *   "150 שופרסל"     → { merchant: "שופרסל", amount: 150 }
 *   "סופר פארם 89.9" → { merchant: "סופר פארם", amount: 89.9 }
 *   "עזרה"           → null
 *   "3"              → null (just a number, handled as pending reply)
 */
function parseExpenseMessage(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;

  // Pattern: amount at end — "שופרסל 150" or "סופר פארם 89.90"
  const endMatch = trimmed.match(/^(.+?)\s+([\d]+(?:\.[\d]+)?)$/);
  if (endMatch) {
    const merchant = endMatch[1].trim();
    const amount = parseFloat(endMatch[2]);
    if (merchant && amount > 0) return { merchant, amount };
  }

  // Pattern: amount at start — "150 שופרסל"
  const startMatch = trimmed.match(/^([\d]+(?:\.[\d]+)?)\s+(.+)$/);
  if (startMatch) {
    const amount = parseFloat(startMatch[1]);
    const merchant = startMatch[2].trim();
    if (merchant && amount > 0) return { merchant, amount };
  }

  return null;
}

module.exports = { parseExpenseMessage };
