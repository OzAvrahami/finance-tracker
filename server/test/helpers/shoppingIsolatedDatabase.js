'use strict';

// TEST HARNESS ONLY. No dotenv, hosted URLs, credential discovery or fallback.
const { spawnSync } = require('node:child_process');
const { randomUUID, randomBytes, createHmac } = require('node:crypto');
const assert = require('node:assert/strict');

function docker(args, input, allowFailure = false) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 90000, maxBuffer: 32e6 });
  if (!allowFailure && result.status !== 0) throw Error(`Isolated Docker command failed: ${result.stderr || result.error?.message}`);
  return result;
}

async function createIsolatedDatabase() {
  assert.equal(process.env.SHOPPING_ISOLATED_TEST, 'issue-102-disposable', 'Explicit isolated-test guard required');
  const context = JSON.parse(docker(['context', 'inspect']).stdout)[0];
  assert.match(context.Endpoints.docker.Host, /^(npipe:\/\/|unix:\/\/)/, 'Remote Docker contexts are forbidden');
  const identity = `shopping102-${randomUUID()}`, network = identity, edge = `${identity}-loopback`, db = `${identity}-db`, rest = `${identity}-rest`, auth = `${identity}-auth`;
  const password = randomBytes(32).toString('hex'), secret = randomBytes(48).toString('hex');
  const label = `finance.shopping.disposable=${identity}`;
  docker(['network', 'create', '--internal', '--label', label, network]);
  let dbCreated = false, restCreated = false, edgeCreated = false, authCreated = false;
  const inspect = name => JSON.parse(docker(['inspect', name]).stdout)[0];
  function guard() {
    const info = inspect(db), net = JSON.parse(docker(['network', 'inspect', network]).stdout)[0];
    assert.equal(info.Config.Labels['finance.shopping.disposable'], identity);
    assert.equal(net.Internal, true); assert.equal(net.Labels['finance.shopping.disposable'], identity);
    assert.deepEqual(Object.keys(info.NetworkSettings.Networks), [network]);
    assert.deepEqual(info.HostConfig.PortBindings || {}, {});
    assert.equal(info.HostConfig.Privileged, false);
    assert.equal(info.Mounts.filter(m => m.Type === 'bind').length, 0);
    assert.ok(info.Config.Env.includes(`POSTGRES_PASSWORD=${password}`));
  }
  function sql(text, allowFailure = false, database = 'postgres') {
    guard(); assert.match(database, /^(postgres|restore_test)$/);
    return docker(['exec', '-i', db, 'psql', '-X', '-U', 'postgres', '-d', database,
      '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-Atq'], text, allowFailure);
  }
  const token = (role, sub = randomUUID(), expires = Math.floor(Date.now()/1000)+3600) => {
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role, sub, iss: identity, aud: 'authenticated', exp: expires })}`;
    return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
  };
  async function close() {
    if (authCreated) { assert.equal(inspect(auth).Config.Labels['finance.shopping.disposable'], identity); docker(['rm', '-f', auth]); }
    if (restCreated) { assert.equal(inspect(rest).Config.Labels['finance.shopping.disposable'], identity); docker(['rm', '-f', rest]); }
    if (dbCreated) { guard(); docker(['rm', '-fv', db]); }
    assert.equal(JSON.parse(docker(['network', 'inspect', network]).stdout)[0].Labels['finance.shopping.disposable'], identity);
    docker(['network', 'rm', network]);
    if(edgeCreated) {
      assert.equal(JSON.parse(docker(['network','inspect',edge]).stdout)[0].Labels['finance.shopping.disposable'],identity);
      docker(['network','rm',edge]);
    }
  }
  try {
    docker(['run', '-d', '--name', db, '--network', network, '--label', label,
      '-e', `POSTGRES_PASSWORD=${password}`, 'postgres:17-alpine']); dbCreated = true;
    guard();
    let ready = false;
    for (let i=0; i<80; i++) {
      if (docker(['exec', db, 'pg_isready', '-U', 'postgres'], undefined, true).status === 0) { ready=true; break; }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.ok(ready, 'Isolated PostgreSQL startup timed out');
    sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE ROLE authenticator LOGIN PASSWORD '${password}' NOINHERIT;
      GRANT anon,authenticated,service_role TO authenticator;
      COMMENT ON DATABASE postgres IS '${identity}';`);
    assert.equal(sql('SELECT shobj_description(oid,\'pg_database\') FROM pg_database WHERE datname=current_database();').stdout.trim(), identity);
    return { identity, db, sql, guard, close, token,
      expiredUserToken(value) {
        const [head,payload]=value.split('.'),claims=JSON.parse(Buffer.from(payload,'base64url'));
        const body=head+'.'+Buffer.from(JSON.stringify({...claims,exp:1})).toString('base64url');
        return body+'.'+createHmac('sha256',secret).update(body).digest('base64url');
      },
      async startApi() {
        guard();
        // Docker Desktop suppresses published ports on internal-only networks.
        // Only PostgREST joins this separate bridge; the database stays internal.
        docker(['network','create','--label',label,edge]); edgeCreated=true;
        docker(['create', '--name', rest, '--network', edge, '--label', label,
          '-p', '127.0.0.1::3000', '-e', `PGRST_DB_URI=postgres://authenticator:${password}@${db}:5432/postgres`,
          '-e', 'PGRST_DB_SCHEMAS=public', '-e', 'PGRST_DB_ANON_ROLE=anon', '-e', `PGRST_JWT_SECRET=${secret}`,
          '-e', 'PGRST_DB_HOISTED_TX_SETTINGS=statement_timeout,lock_timeout,default_transaction_isolation',
          'public.ecr.aws/supabase/postgrest:v16.5']); restCreated=true;
        docker(['network','connect',network,rest]);docker(['start',rest]);
        const info=inspect(rest), bindings=info.HostConfig.PortBindings['3000/tcp'];
        assert.deepEqual(Object.keys(info.NetworkSettings.Networks).sort(),[edge,network].sort());
        assert.equal(bindings.length,1); assert.equal(bindings[0].HostIp,'127.0.0.1');
        if (!info.NetworkSettings.Ports?.['3000/tcp']?.[0]) {
          const logs=docker(['logs',rest],undefined,true);
          throw Error(`PostgREST missing local binding (${info.State.Status}): ${`${logs.stdout} ${logs.stderr}`.replaceAll(password,'[local-password]').replaceAll(secret,'[local-jwt-secret]')}`);
        }
        const port=info.NetworkSettings.Ports['3000/tcp'][0].HostPort;
        const endpoint=`http://127.0.0.1:${port}`;
        for(let i=0;i<60;i++) { try { if((await fetch(endpoint)).ok)return endpoint; } catch {} await new Promise(r=>setTimeout(r,200)); }
        throw Error('Isolated PostgREST startup timed out');
      },
      backup() { guard(); return docker(['exec', db, 'pg_dump', '-U', 'postgres', 'postgres']).stdout; },
      async startAuth() {
        guard(); assert(edgeCreated, 'Start isolated PostgREST first');
        sql(`CREATE USER supabase_auth_admin PASSWORD '${password}'; CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin;
          GRANT USAGE ON SCHEMA public TO supabase_auth_admin;`);
        docker(['create','--name',auth,'--network',edge,'--label',label,'-p','127.0.0.1::9999',
          '-e','GOTRUE_API_HOST=0.0.0.0','-e','GOTRUE_API_PORT=9999','-e','API_EXTERNAL_URL=http://127.0.0.1:9999',
          '-e','GOTRUE_SITE_URL=http://127.0.0.1','-e','GOTRUE_DB_DRIVER=postgres',
          '-e',`GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:${password}@${db}:5432/postgres?search_path=auth`,
          '-e',`GOTRUE_JWT_SECRET=${secret}`,'-e','GOTRUE_JWT_AUD=authenticated','-e','GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated',
          '-e','GOTRUE_JWT_ADMIN_ROLES=service_role','-e','GOTRUE_JWT_EXP=3600','-e','GOTRUE_MAILER_AUTOCONFIRM=true',
          '-e','GOTRUE_EXTERNAL_EMAIL_ENABLED=true','-e','GOTRUE_DISABLE_SIGNUP=true',
          'public.ecr.aws/supabase/gotrue:v2.197.0']); authCreated=true;
        docker(['network','connect',network,auth]);docker(['start',auth]);
        const info=inspect(auth);assert.equal(info.HostConfig.PortBindings['9999/tcp'][0].HostIp,'127.0.0.1');
        assert.deepEqual(Object.keys(info.NetworkSettings.Networks).sort(),[edge,network].sort());
        const endpoint=`http://127.0.0.1:${info.NetworkSettings.Ports['9999/tcp'][0].HostPort}`;
        for(let i=0;i<80;i++){try{if((await fetch(endpoint+'/health')).ok)return endpoint;}catch{}await new Promise(r=>setTimeout(r,200));}
        const logs=docker(['logs',auth],undefined,true);
        throw Error(`Isolated Auth startup failed: ${logs.stderr.replaceAll(password,'[local-password]').replaceAll(secret,'[local-secret]')}`);
      },
      async restart() {
        guard(); docker(['restart', db]); guard();
        for (let i=0;i<80;i++) {
          if (docker(['exec', db, 'pg_isready', '-U', 'postgres'], undefined, true).status === 0) return;
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        throw Error('Isolated database restart timed out');
      },
    };
  } catch (error) { await close(); throw error; }
}

module.exports = { createIsolatedDatabase };
