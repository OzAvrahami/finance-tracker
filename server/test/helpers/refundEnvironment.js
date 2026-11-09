// Disposable local Auth + PostgREST + PostgreSQL and the real application.
// No .env, hosted credentials, existing containers, or shared databases are used.
const { spawnSync, spawn } = require('node:child_process');
const { createHmac } = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..');
const pause = ms => new Promise(r => setTimeout(r, ms));

async function start({ baseline = false, browser = false } = {}) {
  const prefix = `finance-refund-${process.pid}`;
  const containers = [], children = [], servers = [];
  const docker = (args, input, allow = false) => {
    const r = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 90000, maxBuffer: 32e6 });
    if (!allow) assert.equal(r.status, 0, r.stderr || r.error?.message);
    return r;
  };
  const sql = input => docker(['exec', '-i', `${prefix}-db`, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'], input).stdout.trim();
  const sqlFailure = input => docker(['exec', '-i', `${prefix}-db`, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-Atq'], input, true);
  const listen = server => new Promise(r => server.listen(0, '127.0.0.1', () => { servers.push(server); r(server.address().port); }));
  const launch = (name, image, env, port) => {
    const fullName = `${prefix}-${name}`;
    docker(['run', '-d', '--name', fullName, '--network', prefix, '--label', 'finance.disposable=manual-refund',
      ...Object.entries(env).flatMap(([k,v]) => ['-e', `${k}=${v}`]), ...(port ? ['-p', `127.0.0.1::${port}`] : []), image]);
    containers.push(fullName);
    if (port) return Number(docker(['port', fullName, String(port)]).stdout.trim().split(':').at(-1));
  };
  const ready = async url => {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(url)).status < 500) return; } catch {} await pause(200); }
    throw new Error(`Local service did not start: ${url}`);
  };
  const stop = async () => {
    for (const child of children) if (child.exitCode == null) { child.kill(); await new Promise(r => child.once('exit', r)); }
    for (const server of servers) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
    for (const name of containers.reverse()) docker(['rm', '-f', name], undefined, true);
    docker(['network', 'rm', prefix], undefined, true);
  };
  try {
    docker(['network', 'create', prefix]);
    launch('db', 'postgres:16-alpine', { POSTGRES_PASSWORD: 'refund-test-only' });
    for (let i = 0; i < 100; i++) { if (!docker(['exec', `${prefix}-db`, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], undefined, true).status) break; await pause(200); }
    sql("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE authenticator LOGIN PASSWORD 'refund-test-only' NOINHERIT; GRANT anon,authenticated,service_role TO authenticator; CREATE ROLE supabase_auth_admin LOGIN SUPERUSER PASSWORD 'refund-test-only'; CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin;");
    const schema = fs.readFileSync(path.join(root, 'server/full_schema.sql'), 'utf8');
    sql(baseline ? schema.split('-- Migration 059:')[0] : schema);
    sql("GRANT USAGE ON SCHEMA public TO service_role; GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role; GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role; INSERT INTO payment_sources(id,name,slug,method) VALUES(6,'Synthetic debit','refund-debit','debit_card'),(7,'Synthetic credit','refund-credit','credit_card'),(14,'Synthetic bank','refund-bank','bank_account'),(15,'Synthetic cash','refund-cash','cash'),(16,'Synthetic transfer','refund-transfer','bank_transfer'),(17,'Synthetic check','refund-check','check'); INSERT INTO categories(id,name,type) VALUES(100,'Synthetic expense','expense'),(101,'Synthetic income','income'),(102,'Synthetic other expense','expense');");
    const secret = 'disposable-refund-jwt-secret-at-least-32-characters';
    const token = role => {
      const enc = x => Buffer.from(JSON.stringify(x)).toString('base64url');
      const body = `${enc({ alg:'HS256',typ:'JWT' })}.${enc({ role,iss:'supabase',exp:Math.floor(Date.now()/1000)+3600 })}`;
      return `${body}.${createHmac('sha256',secret).update(body).digest('base64url')}`;
    };
    const restPort = launch('rest', 'public.ecr.aws/supabase/postgrest:v14.15', {
      PGRST_DB_URI: `postgres://authenticator:refund-test-only@${prefix}-db:5432/postgres`, PGRST_DB_SCHEMAS:'public', PGRST_DB_ANON_ROLE:'anon', PGRST_JWT_SECRET:secret,
    }, 3000);
    const authPort = launch('auth', 'public.ecr.aws/supabase/gotrue:v2.195.0', {
      GOTRUE_API_HOST:'0.0.0.0', GOTRUE_API_PORT:'9999', API_EXTERNAL_URL:'http://127.0.0.1', GOTRUE_SITE_URL:'http://127.0.0.1',
      GOTRUE_DB_DRIVER:'postgres', GOTRUE_DB_DATABASE_URL:`postgres://supabase_auth_admin:refund-test-only@${prefix}-db:5432/postgres?search_path=auth`,
      GOTRUE_JWT_SECRET:secret, GOTRUE_JWT_EXP:'3600', GOTRUE_JWT_AUD:'authenticated', GOTRUE_JWT_DEFAULT_GROUP_NAME:'authenticated',
      GOTRUE_JWT_ADMIN_ROLES:'service_role', GOTRUE_EXTERNAL_EMAIL_ENABLED:'true', GOTRUE_MAILER_AUTOCONFIRM:'true',
    }, 9999);
    await ready(`http://127.0.0.1:${restPort}/`); await ready(`http://127.0.0.1:${authPort}/health`);
    let backendPort;
    const gateway = http.createServer((req,res) => {
      res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Headers','*');
      res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,PATCH,DELETE,OPTIONS');
      if (req.method === 'OPTIONS') { res.end(); return; }
      const auth = req.url.startsWith('/auth/v1'), backend = req.url.startsWith('/api/');
      const headers = {...req.headers}; delete headers.origin;
      const upstream = http.request({ hostname:'127.0.0.1',port:backend ? backendPort : auth ? authPort : restPort,
        path:backend ? req.url : req.url.replace(auth ? '/auth/v1' : '/rest/v1',''),method:req.method,headers }, r => { res.writeHead(r.statusCode,r.headers); r.pipe(res); });
      upstream.on('error', () => { res.statusCode=502; res.end(); }); req.pipe(upstream);
    });
    const gatewayPort = await listen(gateway), url = `http://127.0.0.1:${gatewayPort}`;
    const anon = token('anon'), service = token('service_role');
    const signup = await fetch(`${url}/auth/v1/signup`, { method:'POST',headers:{'Content-Type':'application/json',apikey:anon},body:JSON.stringify({email:'refund@example.test',password:'Synthetic-refund-123!'}) });
    const session = await signup.json(); assert.ok(session.access_token, JSON.stringify(session));
    const reserve = http.createServer(); const frontendPort = await listen(reserve); await new Promise(r=>reserve.close(r)); servers.splice(servers.indexOf(reserve),1);
    Object.assign(process.env, { SUPABASE_URL:url, SUPABASE_KEY:service, EXTERNAL_API_KEY:'synthetic-refund-external', LOAN_JOB_SECRET:'synthetic-refund-job', NODE_ENV:'test', CORS_ORIGIN:`http://127.0.0.1:${frontendPort}` });
    const app = require('../../index');
    const apiPort = await listen(http.createServer(app)), apiUrl = `http://127.0.0.1:${apiPort}/api`;
    backendPort = apiPort;
    const api = async (route, body, method = body ? 'POST' : 'GET') => {
      const r = await fetch(`${apiUrl}${route}`, { method,headers:{ Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json' },...(body ? {body:JSON.stringify(body)} : {}) });
      return { status:r.status,body:await r.json() };
    };
    let frontend;
    if (browser) {
      const child = spawn(process.execPath,[path.join(root,'client/node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',String(frontendPort),'--strictPort'],{
        cwd:path.join(root,'client'),env:{...process.env,VITE_API_URL:`${url}/api`,VITE_SUPABASE_URL:url,VITE_SUPABASE_ANON_KEY:anon},stdio:'ignore',windowsHide:true,
      }); children.push(child); frontend=`http://127.0.0.1:${frontendPort}`; await ready(frontend);
    }
    return { sql,sqlFailure,api,apiUrl,url,anon,session,frontend,stop,prefix,service,
      databaseLog: () => docker(['logs', `${prefix}-db`], undefined, true).stderr };
  } catch (error) { console.error(docker(['logs', `${prefix}-auth`], undefined, true).stderr.slice(-6000)); await stop(); throw error; }
}
module.exports = { start };
