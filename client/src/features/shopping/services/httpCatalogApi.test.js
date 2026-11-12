import {describe,it,expect,vi} from 'vitest';
vi.mock('../../../services/api',()=>({default:{defaults:{baseURL:'/api'}}}));
import {createHttpCatalogApi} from './httpCatalogApi';
const location={origin:'http://127.0.0.1:5123',hostname:'127.0.0.1'};
const response=(data=[],revision='1')=>({data,headers:{etag:'"scope"','x-shopping-catalog-revision':revision,'x-shopping-isolated':'shopping102-test'}});
const setup=()=>{const transport={defaults:{baseURL:'/api'},request:vi.fn().mockResolvedValue(response())};return{transport,api:createHttpCatalogApi({transport,enabled:true,location})};};
describe('isolated authenticated administration adapter',()=>{
 it('fails closed for hosted API or disabled integration',()=>{
  for(const baseURL of ['https://hosted.example/api','http://localhost:5050/api'])expect(()=>createHttpCatalogApi({transport:{defaults:{baseURL}},enabled:true,location})).toThrow();
  expect(()=>createHttpCatalogApi({transport:{defaults:{baseURL:'/api'}},enabled:false,location})).toThrow();
 });
 it('translates legacy category UI actions into one combined edit, preserving stable same-key retry',async()=>{
  const {transport,api}=setup();const request=await api.prepare('category.change','7',{type:'rename',name:'Edited'},'1');
  expect(request.path).toBe('/settings/shopping/catalog-categories/7');expect(request.body).toEqual({name:'Edited'});
  await api.send(request);await api.send(request);expect(transport.request.mock.calls[1]).toEqual(transport.request.mock.calls[2]);expect(transport.request.mock.calls[1][0].preserveAuthDraft).toBe(true);
 });
 it('does not silently use a fresh token to overwrite an older draft',async()=>{
  const {transport,api}=setup();transport.request.mockResolvedValue(response([],'2'));
  await expect(api.prepare('product.edit','8',{default_price:0},'1')).rejects.toMatchObject({code:'shopping_revision_stale'});expect(transport.request).toHaveBeenCalledTimes(1);
 });
 it('sorts selected identities for the server-issued bulk token',async()=>{
  const {transport,api}=setup();await api.prepare('product.bulk-category',null,{product_ids:['10','2'],category_id:'1'},'1');
  expect(transport.request.mock.calls[0][0].url).toContain('product_ids=2%2C10');
 });
 it.each([401,403,409,428,503])('preserves error status %s without retrying or redirecting drafts',async status=>{
  const {transport,api}=setup();transport.request.mockRejectedValue({response:{status,data:{code:status===401?'shopping_unauthenticated':'shopping_request_failed'}}});
  await expect(api.read()).rejects.toMatchObject({status});expect(transport.request.mock.calls.every(([c])=>c.preserveAuthDraft)).toBe(true);
 });
 it('rejects an unmarked response from a legacy server',async()=>{
  const {transport,api}=setup();transport.request.mockResolvedValue({data:[],headers:{}});await expect(api.read()).rejects.toMatchObject({code:'shopping_network_unknown'});
 });
});
