const item = (changes = {}) => ({ client_id: 'row-1', key: 'synthetic-purchase-1', identity_basis: 'durable_delivery', merchant: 'Synthetic Shop',
  event: { kind: 'expense', status: 'completed', basis: 'single', purchase_key: null, installment: null },
  dates: { purchase: '2026-10-01', mapped: '2026-10-02', billing: '2026-11-02' },
  charged: { amount: '10.90', currency: 'ILS', scale: 2 }, original: null, ...changes });
const envelope = items => ({ contract: 'finance.transactions.v1', account: 'synthetic-account', ...(Array.isArray(items) ? { items } : { item: items }) });
// Offline adapter vectors: no credentials, source snapshots, filesystem or network.
// Each case starts from a fresh synthetic registration/database; `before` is
// ordered setup delivery, NOT permission to replay historical financial data.
function producerFixtures() {
  const pending=item({event:{...item().event,status:'pending'}});
  const observed=item({key:'synthetic-installment-2',event:{...item().event,basis:'installment',purchase_key:'synthetic-whole-purchase',installment:{current:2,total:3}},
    dates:{purchase:'2026-08-01',mapped:'2026-09-01',billing:'2026-10-10'}});
  const created={outcome:'created',accepted:true,financial_posted:true};
  const held=reason_code=>({outcome:'review_required',accepted:true,financial_posted:false,reason_code});
  const conflict={outcome:'conflict',accepted:false,financial_posted:null,reason_code:'identity_content_changed'};
  const vector=(id,items,validItems,expectedResults,before=[])=>({id,before,request:envelope(items),validItems,
    expectedResponse:{contract:'finance.transactions.v1',results:expectedResults.map((r,index)=>({index,client_id:(Array.isArray(items)?items[index]:items).client_id,
      key:(Array.isArray(items)?items[index]:items).key,...r}))}});
  return {
    contract:'finance.transactions.v1',
    preconditions:'Independent fresh synthetic account: enabled active CAL registration, one active payment source, history reviewed, billing installment policy; no prior cash except explicit before deliveries. Response objects are projections; generated IDs and current reconciliation fields are not fixed.',
    cases:[
      vector('single',item(),[true],[created]),
      vector('batch',[item(),item({client_id:'row-2',key:'synthetic-purchase-2'})],[true,true],[created,created]),
      vector('partial',[item(),item({client_id:'invalid-money',key:'invalid-money',charged:{amount:10.9,currency:'ILS',scale:2}})],[true,false],
        [created,{outcome:'rejected',accepted:false,financial_posted:false,reason_code:'invalid_evidence'}]),
      vector('pending',pending,[true],[held('source_not_completed')]),
      vector('completed-needs-owner-resolution',item(),[true],[conflict],[envelope(pending)]),
      vector('exact-replay',item(),[true],[{outcome:'replay',accepted:true,financial_posted:true}],[envelope(item())]),
      vector('changed-content',item({merchant:'Revised source wording'}),[true],[conflict],[envelope(item())]),
      vector('complete-installment',observed,[true],[created]),
      vector('producer-missing-original-date',{...observed,dates:{...observed.dates,purchase:null}},[true],[held('installment_purchase_date_required')]),
      vector('missing-confirmed-billing',{...observed,dates:{...observed.dates,billing:null}},[true],[held('accounting_date_evidence_required')]),
      vector('refund',item({event:{...item().event,kind:'refund'},charged:{amount:'-10.90',currency:'ILS',scale:2}}),[true],[held('unsupported_event_kind')]),
      vector('unresolved-fx',item({charged:{amount:'2.00',currency:'USD',scale:2}}),[true],[held('exact_ils_charge_required')]),
    ],
    transportFailure:{request:envelope(item()),expectedResponse:{contract:'finance.transactions.v1',results:[{index:0,client_id:'row-1',key:'synthetic-purchase-1',
      outcome:'retryable_failure',accepted:false,financial_posted:null,review_required:false,retryable:true,reason_code:'persistence_unavailable',commit_state:'unknown'}]},
    retryRule:'Inject an unavailable/unknown RPC result in an isolated test. Persist and retry the exact key/evidence; an unknown response may have committed.'},
    sourceGap:'complete-installment is prospective complete evidence, NOT current producer output. Preserve raw trnPurchaseDate separately; never derive it by subtracting months from mapped date.',
  };
}
module.exports = { item, envelope, producerFixtures };
if(require.main===module)process.stdout.write(`${JSON.stringify(producerFixtures(),null,2)}\n`);
