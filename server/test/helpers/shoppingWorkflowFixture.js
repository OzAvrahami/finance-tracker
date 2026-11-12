'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const express = require('express');
const { createShoppingHttpFixture } = require('./shoppingHttpFixture');
const { createWorkflowRouter } = require('../../modules/shopping/http/workflowRouter');

async function createWorkflowFixture(options = {}) {
  const base = await createShoppingHttpFixture();let server;
  try {
    base.env.guard();
    assert.equal(base.sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"), base.env.identity);
    base.sql(`SET shopping.isolated_migration='${base.env.identity}';` + fs.readFileSync(path.join(__dirname, '../../migrations/063_shopping_workflow_persistence.sql'), 'utf8'));
    base.sql("SELECT setval(pg_get_serial_sequence('shopping_list_types','id'),(SELECT max(id) FROM shopping_list_types)); SELECT setval(pg_get_serial_sequence('shopping_lists','id'),(SELECT max(id) FROM shopping_lists)); SELECT setval(pg_get_serial_sequence('shopping_list_items','id'),(SELECT max(id) FROM shopping_list_items));");
    // The minimal full_schema fixture lacks the hosted default privileges on
    // unrelated finance reference tables. Only these authenticated read helpers
    // need them; no browser receives this service-role credential.
    base.sql('GRANT SELECT ON public.categories,public.payment_sources TO service_role;');
    // Authenticated household scope: current schema is shared and has no owner
    // column. No fabricated per-row tenancy. The application authorizer is mandatory.
    const authorize = ({ actor }) => base.users.slice(0, 2).some(u => u.id === actor);
    const app = express();
    const rpcCalls = [];
    const observed = Object.create(base.client);
    observed.rpc = async (...args) => { rpcCalls.push(args[0]);const response = await base.client.rpc(...args);if (response.error) console.error('Isolated workflow RPC failure', args[0], response.error.code, response.error.message);return response; };
    app.use('/api/shopping', createWorkflowRouter({ supabase: observed, authorize,
      isolation: { identity: base.env.identity, endpoint: base.rest, assert: base.env.guard }, environment: { NODE_ENV: 'test' }, ...options }));
    app.use('/api/settings/shopping', createWorkflowRouter({supabase:observed,authorize,isolation:{identity:base.env.identity,endpoint:base.rest,assert:base.env.guard},environment:{NODE_ENV:'test'},settingsOnly:true}));
    app.use('/api',require('../../modules/shopping/http/administrationRouter').createAdministrationRouter({supabase:observed,isolation:{identity:base.env.identity,endpoint:base.rest,assert:base.env.guard},adminIds:base.users.slice(0,2).map(u=>u.id),historicalCategoryIds:base.historical,environment:{NODE_ENV:'test'}}));
    app.use('/auth/v1',async(req,res)=>{let body='';for await(const part of req){body+=part;if(body.length>65536)return res.status(413).end();}const headers={'Content-Type':'application/json'};if(req.headers.authorization)headers.Authorization=req.headers.authorization;const r=await fetch(base.endpoint+'/auth/v1'+req.url,{method:req.method,headers,...(body?{body}:{}),redirect:'error'});res.status(r.status).type('json').send(await r.text());});
    app.get(['/api/transactions/categories','/api/transactions/payment-sources'],require('../../middleware/requireUser').createRequireAuth(base.client),async(req,res)=>{const {data,error}=await base.client.from(req.path.endsWith('categories')?'categories':'payment_sources').select('*');res.status(error?500:200).json(error?{error:'fixture_read_failed'}:data);});
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    // Wait only for the isolated PostgREST cache, with a bounded readiness probe.
    let ready = false;
    for (let i = 0; i < 60; i++) {
      const r = await base.client.rpc('shopping_state', { p_scope: 'list', p_ids: { actor: base.users[0].id, operation: 'list.read', id: null, item_id: null } });
      if (!r.error) { ready = true;break; }
      if (i === 59) throw Error(r.error.message);
      await new Promise(r => setTimeout(r, 100));
    }
    assert(ready);
    return { ...base, rpcCalls, workflowOrigin: `http://127.0.0.1:${server.address().port}`, legacyEndpoint: `http://127.0.0.1:${server.address().port}/api/shopping`,
      async close() { await new Promise(r => server.close(r));await base.close(); } };
  } catch (e) { if (server) await new Promise(r => server.close(r));await base.close();throw e; }
}
module.exports = { createWorkflowFixture };
