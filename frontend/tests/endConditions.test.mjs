import test from 'node:test';
import assert from 'node:assert/strict';
import {socPolicyInputs,endConditionPatch,endConditionIssues} from '../src/utils/socPolicy.js';

test('cyclic SoC defaults off and survives settings/request serialization', () => {
  assert.equal(socPolicyInputs({}).use_cyclic_soc,false);
  const saved=JSON.parse(JSON.stringify(socPolicyInputs({use_cyclic_soc:true})));
  assert.equal(saved.use_cyclic_soc,true);
});

test('end-condition switches are mutually exclusive without re-enabling readiness on disable', () => {
  assert.deepEqual(endConditionPatch({use_cyclic_soc:true}),{use_cyclic_soc:true,use_next_day_readiness:false});
  assert.deepEqual(endConditionPatch({use_next_day_readiness:true}),{use_next_day_readiness:true,use_cyclic_soc:false});
  assert.deepEqual(endConditionPatch({use_cyclic_soc:false}),{use_cyclic_soc:false});
});

test('cyclic mode cannot silently run in long-term or a non-24-hour horizon', () => {
  const settings={use_cyclic_soc:true,planning_horizon:24,use_next_day_readiness:false};
  assert.deepEqual(endConditionIssues(settings,'single'),[]);
  assert.ok(endConditionIssues(settings,'long_term').length);
  assert.ok(endConditionIssues({...settings,planning_horizon:48},'single').length);
  assert.match(endConditionIssues({...settings,use_next_day_readiness:true},'single')[0].message,/cannot both/);
  assert.deepEqual(endConditionIssues({...settings,use_cyclic_soc:false},'long_term'),[]);
});
