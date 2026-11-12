'use strict';
const path = require('node:path');
const net = require('node:net');
const { pathToFileURL } = require('node:url');

// Test/owner launcher only. Never loads .env or accepts a hosted endpoint/key.
async function startIntegrationFrontend(fixture) {
  fixture.env.guard();
  const root = path.resolve(__dirname, '../../..');
  const port = await new Promise((resolve, reject) => {
    const socket = net.createServer();socket.on('error', reject);
    socket.listen(0, '127.0.0.1', () => { const p = socket.address().port;socket.close(() => resolve(p)); });
  });
  const origin = `http://127.0.0.1:${port}`;
  const values = { VITE_SHOPPING_ADMIN_INTEGRATION:'1', VITE_SHOPPING_ADMIN_PREVIEW:'1',
    SHOPPING_ADMIN_ISOLATED_PROXY:fixture.endpoint, VITE_SUPABASE_URL:origin,
    VITE_SUPABASE_ANON_KEY:fixture.anon, VITE_API_URL:'/api' };
  const previous = Object.fromEntries(Object.keys(values).map(k => [k,process.env[k]]));
  const restore = () => { for(const k of Object.keys(values)) { if(previous[k] === undefined) delete process.env[k];else process.env[k] = previous[k]; } };
  Object.assign(process.env, values);
  let vite;
  try {
    const { createServer } = await import(pathToFileURL(path.join(root,'client/node_modules/vite/dist/node/index.js')).href);
    vite = await createServer({root:path.join(root,'client'),configFile:path.join(root,'client/vite.config.js'),server:{host:'127.0.0.1',port,strictPort:true}});
    await vite.listen();
    if(!vite.resolvedUrls.local.some(url => url.startsWith(origin))) throw Error('Unexpected frontend binding');
    return { origin, async close() { await vite.close();restore(); } };
  } catch(error) { if(vite) await vite.close();restore();throw error; }
}
module.exports = { startIntegrationFrontend };
