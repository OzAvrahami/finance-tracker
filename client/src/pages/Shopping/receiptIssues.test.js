import { expect, it } from 'vitest';
import { receiptIssues } from './receiptIssues';
import { changeReceiptLink, confirmReceiptLink } from './receiptReviewLinks';

const item = {list_item_id:'20', name:'מלפפון', status:'full'};
const row = {name:'מלפפון', quantity:'2', unit:'יחידה', price:'10.00'};

it('offers an exact evidence-based correction only when gross and discount are unambiguous', () => {
  const source = {...row, line_total:'20.00',discount:'5.65'};
  expect(receiptIssues([source],[])[0].expected).toBe('14.35');
  expect(receiptIssues([{...source,field_conflicts:[{field:'discount',values:['5.65','0.00']}]}],[])[0].expected).toBeUndefined();
  expect(receiptIssues([{...source,discount:null,price:null}],[])[0].expected).toBeUndefined();
  expect(receiptIssues([{...row,match_requires_review:true}],[])).toEqual([]);
});

it('approves only an identified line and protects its assignment during later edits', () => {
  const rows = [{...row,planned_item_id:'20'}, {...row,name:'מלפפון נוסף'}];
  const append = changeReceiptLink(rows,[item],1,'20','1',true);
  expect(append[0]).toBe(rows[0]);
  expect(append[1].review_link.list_item_id).toBe('20');
  expect(confirmReceiptLink(append,item,true,'1')).toEqual(append);
  const replace = changeReceiptLink(rows,[item],1,'20','1');
  const confirmed = confirmReceiptLink(replace,item,true,'1',1);
  expect(confirmed[0].review_link.list_item_id).toBeNull();
  expect(confirmed[1].review_link.confirmed).toBe(true);
  expect(changeReceiptLink(confirmed,[item],0,'20','1',true)[1]).toBe(confirmed[1]);
  expect(changeReceiptLink(confirmed,[item],1,null,'1')).toBe(confirmed);
});


it('only offers a quantity acknowledgement for a single identified match with no known conversion', () => {
  const plan = [{...item,status:'unresolved',quantity:'1',unit:'kg'}];
  const purchased = {...row,unit:'unit',planned_item_id:'20'};
  expect(receiptIssues([purchased], plan)[0].unitReview).toBe(true);
  expect(receiptIssues([purchased,{...purchased}], plan).every(issue => !issue.unitReview)).toBe(true);
  const confirmed = confirmReceiptLink([purchased],plan[0],true,'1',0);
  expect(receiptIssues(confirmed, plan)).toHaveLength(0);
  expect(confirmed[0].quantity).toBe('2');
});
