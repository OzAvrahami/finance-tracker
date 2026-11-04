const assert = require('node:assert/strict');

// Git's Windows checkout can use CRLF. Load the canonical LF SQL into disposable
// databases so strict function fingerprints test SQL changes, not checkout EOLs.
const normalizeSql = sql => sql.replace(/\r\n/g, '\n');

// Historical migration parity must compare the same schema boundary on both
// sides. Fail closed if the append-only snapshot no longer has that boundary.
const schemaThrough = (sql, migration) => {
  assert.ok(Number.isInteger(migration) && migration > 0);
  const marker = `-- Migration ${String(migration + 1).padStart(3, '0')}:`;
  const normalized = normalizeSql(sql);
  const offset = normalized.indexOf(`\n${marker}`);
  assert.ok(offset >= 0, `Missing historical schema boundary: ${marker}`);
  return normalized.slice(0, offset + 1);
};

module.exports = { normalizeSql, schemaThrough };
