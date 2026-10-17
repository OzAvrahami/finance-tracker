// Optional read-only producer inspection. Pure mapper only: no collector, config,
// snapshots, browser, credentials or network requests. Synthetic inputs exclusively.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const root=process.env.GENERAL_PRODUCER_REPO;
test('actual pinned CAL mapper and snapshot allowlist expose billing but lose installment purchase date',{skip:!root},async()=>{
 const {convertParsedDataToTransactions:map}=require(path.join(root,'node_modules/israeli-bank-scrapers/lib/scrapers/visa-cal.js'));
 const {account}=await import(pathToFileURL(path.join(root,'src/shared/snapshot.js')));
 const raw={trnPurchaseDate:'2026-08-01T00:00:00.000Z',debCrdDate:'2026-10-10T00:00:00.000Z',
  numOfPayments:3,curPaymentNum:2,trnTypeCode:'8',trnIntId:'synthetic-completed-id',
  trnAmt:32.7,amtBeforeConvAndIndex:10.9,trnCurrencySymbol:'ILS',debCrdCurrencySymbol:'ILS',
  merchantName:'Synthetic Shop',transTypeCommentDetails:'Synthetic installment',branchCodeDesc:'Synthetic'};
 const rows=map([{result:{bankAccounts:[{debitDates:[{transactions:[raw]}],immidiateDebits:{debitDays:[]}}]}}],null,{includeRawTransaction:false});
 assert.equal(rows.length,1);assert.equal(rows[0].date,'2026-09-01T00:00:00.000Z');
 assert.equal(rows[0].processedDate,'2026-10-10T00:00:00.000Z');
 assert.equal(rows[0].rawTransaction,undefined);assert.equal(rows[0].purchaseDate,undefined);
 assert.equal(typeof rows[0].chargedAmount,'number');assert.equal(rows[0].chargedAmount,-10.9);
 assert.ok(account({accountNumber:'synthetic-account',txns:rows}));
 assert.equal(account({accountNumber:'synthetic-account',txns:[{...rows[0],originalPurchaseDate:raw.trnPurchaseDate}]}),null);
 const pending={...raw,numberOfPayments:3};delete pending.debCrdDate;
 const p=map([],{result:{cardsList:[{authDetalisList:[pending]}]}},{includeRawTransaction:false})[0];
 assert.equal(p.status,'pending');assert.equal(p.identifier,undefined);assert.equal(p.chargedCurrency,undefined);
 assert.equal(p.processedDate,p.date); // No confirmed billing evidence here.
});
