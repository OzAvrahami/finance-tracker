import api from '../../../services/api';
import { CatalogError, commandRoute } from './catalogApi';

export function createHttpCatalogApi({ transport = api, enabled = import.meta.env.DEV, location = globalThis.location } = {}) {
  const base = new URL(transport.defaults.baseURL, location.origin);
  if (!enabled || !['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname) || base.origin !== location.origin || base.pathname !== '/api') {
    throw new Error('Shopping HTTP integration requires the isolated same-origin development gateway');
  }
  async function request(path, options = {}) {
    try {
      const r = await transport.request({ url: path, ...options, preserveAuthDraft: true });
      if (!r.headers['x-shopping-isolated']?.startsWith('shopping102-')) throw new CatalogError('shopping_network_unknown');
      return { body: r.data, etag: r.headers.etag, revision: r.headers['x-shopping-catalog-revision'] };
    } catch (error) {
      if (error.name === 'CanceledError' || error.name === 'AbortError') throw error;
      if (error instanceof CatalogError) throw error;
      throw new CatalogError(error.response?.data?.code || 'shopping_network_unknown', error.response?.status || 0);
    }
  }
  const categories = '/settings/shopping/catalog-categories', products = '/settings/shopping/catalog-items', types = '/settings/shopping/list-types';
  return Object.freeze({
    mode: 'isolated',
    async read(signal) {
      // These approved endpoints preserve array response shapes. Do not combine
      // responses from different revisions into a seemingly coherent edit draft.
      for (let attempt = 0; attempt < 3; attempt++) {
        const [c, p, t, d] = await Promise.all([
          request('/shopping/category-tree?include_inactive=true', { signal }), request(products+'?activity=all', { signal }),
          request(types, { signal }), request(products+'/duplicate-candidates', { signal }),
        ]);
        const details = await Promise.all(t.body.map(async type => ({ type,
          links: await request(`${types}/${type.id}/categories`, { signal }), visible: await request(`${types}/${type.id}/visibility`, { signal }),
        })));
        if ([p,t,d,...details.flatMap(v=>[v.links,v.visible])].some(r=>r.revision !== c.revision)) continue;
        return { mode:'isolated', etag:c.revision, categories:c.body, products:p.body, listTypes:t.body,
          duplicateCandidates:d.body, links:details.flatMap(v=>v.links.body.filter(c=>c.linked).map(c=>({list_type_id:v.type.id,category_id:c.id}))),
          visibility:Object.fromEntries(details.map(v=>[v.type.id,v.visible.body])) };
      }
      throw new CatalogError('shopping_revision_stale',409);
    },
    async previewBranches(id, categoryIds, signal) {
      return (await request(`${types}/${encodeURIComponent(id)}/visibility?${new URLSearchParams({categoryIds:categoryIds.join(',')})}`, { signal })).body;
    },
    async prepare(operation, id, body, revision) {
      let op=operation, values=structuredClone(body);
      if (op==='category.change') {
        op='category.edit';
        const {type,...fields}=values;
        values=['activate','deactivate'].includes(type)?{is_active:type==='activate'}:fields;
      }
      const query=new URLSearchParams({operation:op});let readPath;
      if(op==='category.create')readPath=categories+'?'+query;
      else if(op==='category.edit')readPath=`${categories}/${encodeURIComponent(id)}?${query}`;
      else if(op==='branches.replace')readPath=`${types}/${encodeURIComponent(id)}/categories`;
      else {
        if(['product.edit','product.deactivate'].includes(op))query.set('id',id);
        if(op==='product.bulk-category')query.set('product_ids',[...values.product_ids].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1).join(','));
        readPath=products+'?'+query;
      }
      const current=await request(readPath);
      if(current.revision!==revision)throw new CatalogError('shopping_revision_stale',409);
      const [method,path]=op==='category.edit'?['PUT',`${categories}/${encodeURIComponent(id)}`]:commandRoute(op,id);
      return Object.freeze({method,path,body:values,headers:Object.freeze({'If-Match':current.etag,'Idempotency-Key':crypto.randomUUID()})});
    },
    async send(command) { return (await request(command.path,{method:command.method,data:command.body,headers:command.headers})).body; },
  });
}
