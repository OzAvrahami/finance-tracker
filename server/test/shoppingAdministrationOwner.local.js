'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createShoppingHttpFixture } = require('./helpers/shoppingHttpFixture');
const { startIntegrationFrontend } = require('./helpers/shoppingIntegrationFrontend');

async function main() {
  assert(process.env.SHOPPING_OWNER_EVIDENCE, 'Set an external private evidence directory');
  const evidence = path.resolve(process.env.SHOPPING_OWNER_EVIDENCE);
  const root = path.resolve(__dirname, '../..');
  assert(!evidence.toLowerCase().startsWith(root.toLowerCase()), 'Credentials must stay outside the worktree');
  const fixture = await createShoppingHttpFixture();let frontend, stopped = false;
  async function close() { if(stopped) return;stopped = true;if(frontend) await frontend.close();await fixture.close(); }
  try {
    frontend = await startIntegrationFrontend(fixture);
    fs.mkdirSync(evidence,{recursive:true});
    const file = path.join(evidence,fixture.env.identity+'-owner-login.json');
    fs.writeFileSync(file,JSON.stringify({url:frontend.origin+'/__shopping-integration',email:fixture.users[0].email,password:fixture.users[0].password},null,2),{flag:'wx',mode:0o600});
    console.log(`Disposable local integration: ${frontend.origin}/__shopping-integration\nSynthetic login: ${file}\nCtrl+C removes only this launcher's isolated containers. Data is disposable.`);
    for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>close().then(()=>process.exit(0),e=>{console.error(e.message);process.exit(1);}));
  } catch(error) { await close();throw error; }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
