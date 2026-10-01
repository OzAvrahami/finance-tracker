const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config/flowlink');
const ingestion = require('../services/transactionIngestionService');
const { safeResult } = require('../services/applePayIngestionService');
const id = value => typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value)<=9223372036854775807n;
const invalid = () => { throw Object.assign(new Error('invalid_input'), { status: 400 }); };
function createReconciliationRouter({ db, env = () => process.env }) {
 const router = express.Router();
 router.use((req,res,next) => {
  res.set('Cache-Control','no-store');
  if (!req.user?.id) return res.status(401).json({error:'unauthorized'});
  try { if (!config.owners(env()).has(req.user.id)) return res.status(403).json({error:'owner_required'}); }
  catch { return res.status(503).json({error:'owner_configuration_invalid'}); }
  next();
 });
 router.use(rateLimit({windowMs:60000,limit:120,standardHeaders:true,legacyHeaders:false}));
 const handle = fn => async (req,res) => { try { await fn(req,res); } catch(e) {
  res.status(e.status || 503).json({error:e.status===400?'invalid_input':'reconciliation_unavailable'});
 }};
 router.get('/summary',handle(async(req,res)=>{
  if (!config.object(req.query,['ids']) || (req.query.ids !== undefined && typeof req.query.ids !== 'string')) invalid();
  const ids=req.query.ids ? req.query.ids.split(',') : [];
  if(ids.length>100 || ids.some(v=>!id(v)||BigInt(v)>2147483647n) || new Set(ids).size!==ids.length) invalid();
  res.json(await ingestion.readReconciliation(db,'summary',ids.map(Number)));
 }));
 router.get('/pending',handle(async(req,res)=>{
  if(!config.object(req.query,['before']) || (req.query.before!==undefined && !id(req.query.before))) invalid();
  res.json(await ingestion.readReconciliation(db,'pending',[],req.query.before||null));
 }));
 for(const mode of ['transaction','observation']) router.get(`/${mode}/:id`,handle(async(req,res)=>{
  if(!id(req.params.id)||Object.keys(req.query).length||(mode==='transaction' && BigInt(req.params.id)>2147483647n)) invalid();
  const result=await ingestion.readReconciliation(db,mode,[],req.params.id);
  if(!result)return res.status(404).json({error:'not_found'});
  res.json(result);
 }));
 router.post('/observation/:id/resolve',handle(async(req,res)=>{
  const b=req.body;
  if(!req.is('application/json')) return res.status(415).json({error:'json_required'});
  if(!id(req.params.id)||Object.keys(req.query).length||!config.object(b,['request_key','expected_revision','action','transaction_id','expected_transaction_fingerprint','expected_candidate_fingerprints'])) invalid();
  if(Buffer.byteLength(JSON.stringify(b))>16384)return res.status(413).json({error:'payload_too_large'});
  if(!config.UUID.test(b.request_key||'')||!id(b.expected_revision)||!['link','separate'].includes(b.action)) invalid();
  const fingerprints=b.expected_candidate_fingerprints;
  if(!config.object(fingerprints,Object.keys(fingerprints||{}))||Object.keys(fingerprints).length>100
    ||Object.entries(fingerprints).some(([k,v])=>!id(k)||typeof v!=='string'||!/^[a-f0-9]{32}$/.test(v))) invalid();
  if(b.action==='link' && (!id(b.transaction_id)||typeof b.expected_transaction_fingerprint!=='string'||!/^[a-f0-9]{32}$/.test(b.expected_transaction_fingerprint))) invalid();
  if(b.action==='separate' && (b.transaction_id!==undefined||b.expected_transaction_fingerprint!==undefined)) invalid();
  const {request_key,...command}=b;
  const result=await ingestion.reviewReconciliation(db,request_key,{...command,observation_id:req.params.id,
   actor:`owner:${req.user.id}`,reason:b.action==='link'?'Owner explicitly linked source evidence':'Owner explicitly confirmed separate purchase'});
  if(['stale_review','review_target_conflict','command_key_conflict'].includes(result.reason_code)) return res.status(409).json({error:'stale_review'});
  if(result.outcome==='rejected'||result.outcome==='conflict')return res.status(422).json({error:'review_not_permitted'});
  res.json(safeResult(result).body);
 }));
 return router;
}
module.exports={createReconciliationRouter};
