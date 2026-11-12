'use strict';
// Normal React Shopping + Settings + administration, using disposable data only.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createWorkflowFixture } = require('./helpers/shoppingWorkflowFixture');
const { startIntegrationFrontend } = require('./helpers/shoppingIntegrationFrontend');

async function main() {
  assert(process.env.SHOPPING_OWNER_EVIDENCE, 'Set an external private evidence directory');
  const evidence = path.resolve(process.env.SHOPPING_OWNER_EVIDENCE);
  const root = path.resolve(__dirname, '../..');
  const relative = path.relative(root, evidence);
  assert(relative.startsWith('..' + path.sep) || path.isAbsolute(relative), 'Evidence must be outside the worktree');
  const fixture = await createWorkflowFixture({
    extract: async () => { throw Error('Owner rehearsal: external receipt extraction is disabled'); },
    lookupOptions: { fetchProduct: async () => ({ status: 'missing' }) },
  });let frontend, stopped = false;
  async function close() { if (stopped) return;stopped = true;if (frontend) await frontend.close();await fixture.close(); }
  try {
    frontend = await startIntegrationFrontend({ ...fixture, endpoint: fixture.workflowOrigin });
    fs.mkdirSync(evidence, { recursive: true });
    const file = path.join(evidence, fixture.env.identity + '-owner-login.json');
    fs.writeFileSync(file, JSON.stringify({ origin: frontend.origin, shopping: frontend.origin + '/shopping',
      administration: frontend.origin + '/__shopping-integration', email: fixture.users[0].email,
      password: fixture.users[0].password }, null, 2), { flag: 'wx', mode: 0o600 });
    console.log(`Normal isolated application: ${frontend.origin}/shopping\nAdministration: ${frontend.origin}/__shopping-integration\nSynthetic login file: ${file}\nNo hosted services. Receipt OCR/provider connectivity is not configured. Ctrl+C cleans up this disposable instance.`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => close().then(() => process.exit(0), e => { console.error(e.message);process.exit(1); }));
    return { origin: frontend.origin, close };
  } catch (error) { await close();throw error; }
}
if (require.main === module) main().catch(error => { console.error(error.message);process.exitCode = 1; });
module.exports = { main };
