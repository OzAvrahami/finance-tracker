const test = require('node:test');
const assert = require('node:assert/strict');
const { planningUnits, planningUnit, planningUnitLabel, stepPlanningQuantity, categoryDisplayName, categoryNameKey } = require('../../shared/shoppingEntryOptions.mjs');

test('planning units reuse supported aliases, keep package distinct and preserve custom values',()=>{
 assert.deepEqual(planningUnits.map(o=>o.value),['unit','kg','g','l','ml','pack','pair']);
 assert.equal(planningUnit(null),'unit');assert.equal(planningUnit('ק״ג'),'kg');
 assert.equal(planningUnit('זוגות'),'pair');assert.equal(planningUnitLabel('ml'),'מ״ל');
 assert.equal(planningUnit('package'),'package');assert.equal(planningUnit('custom box'),'custom box');
 assert.equal(planningUnit('  אריזה מיוחדת  '),'  אריזה מיוחדת  ');
});
test('quantity steps preserve thousandths, reject excess precision and never infer package contents',()=>{
 assert.equal(stepPlanningQuantity('0.125',1),'1.125');assert.equal(stepPlanningQuantity('1.125',-1),'0.125');
 assert.equal(stepPlanningQuantity('0.5',-1),null);assert.equal(stepPlanningQuantity('0.1234',1),null);
 assert.equal(stepPlanningQuantity('10000',1),null);assert.equal(stepPlanningQuantity('500 g',1),null);
});
test('category normalization preserves readable names, does not fuzzy-complete prefixes',()=>{
 assert.equal(categoryDisplayName('  ציוד\t לטיולים  '),'ציוד לטיולים');
 assert.equal(categoryNameKey(' Ｃamping\u00a0 GEAR '),'camping gear');
 assert.notEqual(categoryNameKey('ירק'),categoryNameKey('ירקות ופירות'));
});
