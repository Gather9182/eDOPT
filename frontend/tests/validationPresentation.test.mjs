import test from 'node:test';
import assert from 'node:assert/strict';
import { groupValidationIssues, validationCategory, validationCounts } from '../src/utils/validationPresentation.js';

const issues = [
  {type:'WARNING',code:'NO_CHARGING_AVAILABILITY',bus_id:'R1',message:'Route R1 has no charging availability.'},
  {type:'ERROR',code:'BUS_FINAL_TARGET_EXCEEDS_CAPACITY',bus_id:'R2',message:'Route R2: Required energy exceeds capacity.',details:{required_energy_kwh:500}},
  {type:'ERROR',code:'BUS_ENERGY_INFEASIBLE',bus_id:'R2',message:'Route R2: Energy is missing before departure.'},
  {type:'ERROR',category:'data',code:'PRICE_PROFILE_LENGTH',message:'Price profile length is invalid.'},
];

test('categories separate severity, count each affected route once and retain every original issue', () => {
  const groups = groupValidationIssues(issues);
  assert.deepEqual(validationCounts(issues),{errors:3,warnings:1,routes:2,total:4});
  assert.deepEqual(groups.map(group => group.id),['data','energy','charging']);
  const energy = groups.find(group => group.id === 'energy');
  assert.equal(energy.counts.errors,2);
  assert.equal(energy.counts.routes,1);
  assert.equal(energy.issues[0],issues[1]);
  assert.equal(groups.reduce((n,group) => n+group.issues.length,0),issues.length);
});

test('filtering by route, code, category or text never changes the complete validation result', () => {
  const before = JSON.stringify(issues);
  assert.equal(groupValidationIssues(issues,'r2')[0].issues.length,2);
  assert.equal(groupValidationIssues(issues,'CAPACITY')[0].issues[0],issues[1]);
  assert.equal(groupValidationIssues(issues,'charging availability')[0].id,'charging');
  assert.equal(groupValidationIssues(issues,'price profile')[0].id,'data');
  assert.deepEqual(groupValidationIssues(issues,'unknown route'),[]);
  assert.equal(JSON.stringify(issues),before);
});

test('legacy and unknown issues retain a visible category instead of disappearing', () => {
  assert.equal(validationCategory({type:'ERROR',message:'BESS: Invalid capacity.'}),'storage');
  assert.equal(validationCategory({code:'VALIDATION_REQUEST_FAILED'}),'request');
  assert.equal(validationCategory({code:'TIMETABLE_REPROCESS_REQUIRED'}),'infrastructure');
  assert.equal(validationCategory({category:'new category',code:'NEW_CHECK',message:'New error.'}),'general');
  assert.equal(groupValidationIssues([{type:'ERROR',message:'New error.'}])[0].issues.length,1);
});
