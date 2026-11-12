'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createRequireAuth}=require('../middleware/requireUser');
const {createAdministrationRouter}=require('../modules/shopping/http/administrationRouter');
test('existing auth factory retains legacy success and failure envelopes',async()=>{
 const exercise=async(headers,result)=>{let code,body,next=false;await createRequireAuth({auth:{getUser:async()=>result}})({headers},{status(v){code=v;return this;},json(v){body=v;}},()=>{next=true;});return{code,body,next};};
 assert.deepEqual(await exercise({},{}),{code:401,body:{error:'Missing or invalid authorization header'},next:false});
 assert.deepEqual(await exercise({authorization:'Bearer invalid'},{data:{user:null},error:{}}),{code:401,body:{error:'Invalid or expired token'},next:false});
 assert.equal((await exercise({authorization:'Bearer valid'},{data:{user:{id:'test'}},error:null})).next,true);
});
test('production flags cannot activate admin router or normal application registration',()=>{
 assert.throws(()=>createAdministrationRouter({environment:{NODE_ENV:'production',VITE_SHOPPING_ADMIN_PREVIEW:'1',VITE_SHOPPING_ADMIN_INTEGRATION:'1'}}));
 const index=fs.readFileSync(path.join(__dirname,'../index.js'),'utf8');assert(!index.includes('administrationRouter'));assert(!index.includes('SHOPPING_ADMIN'));
 for(const legacy of ["app.use('/api/shopping', shoppingRoutes)","app.use('/api/settings', settingsRoutes)"])assert(index.includes(legacy));
});
test('local router requires an explicit nonempty server authorizer and isolation proof',()=>{
 assert.throws(()=>createAdministrationRouter({environment:{NODE_ENV:'test'},isolation:{identity:'hosted',endpoint:'https://hosted.invalid'}}));
 let checked=false;
 assert.throws(()=>createAdministrationRouter({environment:{NODE_ENV:'test'},isolation:{identity:'shopping102-test',endpoint:'http://127.0.0.1:1',assert(){checked=true;}},adminIds:[]}));assert(checked);
});
