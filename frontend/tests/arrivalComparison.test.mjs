import test from 'node:test';
import assert from 'node:assert/strict';
import {arrivalComparison} from '../src/utils/arrivalComparison.js';
import {socPolicyInputs,socPolicyIssues,mergeSocPolicies} from '../src/utils/socPolicy.js';

test('missing or invalid reference never creates a fictitious saving', () => {
  for (const result of [{total_cost_eur:100}, {total_cost_eur:100,baseline_feasible:false,baseline_cost_eur:200},
    {total_cost_eur:100,baseline_cost_eur:200}, {total_cost_eur:100,baseline_feasible:true,baseline_cost_eur:null},
    {total_cost_eur:100,baseline_feasible:true,baseline_cost_eur:NaN}]) {
    const comparison=arrivalComparison(result);
    assert.equal(comparison.comparable,false);
    assert.equal(comparison.savings,null);
    assert.equal(comparison.percent,null);
    assert.ok(comparison.reason);
  }
});

test('zero and negative reference costs are preserved without invented percentages', () => {
  const zero=arrivalComparison({total_cost_eur:-5,baseline_feasible:true,baseline_cost_eur:0});
  assert.equal(zero.cost,0); assert.equal(zero.savings,5); assert.equal(zero.percent,null);
  const negative=arrivalComparison({total_cost_eur:-10,baseline_feasible:true,baseline_cost_eur:-5});
  assert.equal(negative.cost,-5);assert.equal(negative.savings,5);assert.equal(negative.percent,null);
});

test('reference energy requires recorded time step and complete matching profiles', () => {
  const result={total_cost_eur:5,baseline_cost_eur:10,baseline_feasible:true,
    electricity_prices:[200,200],baseline_aggregated_load_profile:[100,100],run_metadata:{inputs:{time_step_minutes:30}}};
  assert.equal(arrivalComparison(result).energyMwh,.1);
  assert.equal(arrivalComparison(result).percent,50);
  assert.equal(arrivalComparison({...result,run_metadata:{}}).energyComparable,false);
  assert.equal(arrivalComparison({...result,baseline_aggregated_load_profile:[100]}).energyComparable,false);
});

test('SoC policy defaults preserve old projects and all active values are passed unchanged', () => {
  assert.equal(socPolicyInputs({}).operating_min_soc_mode,'off');
  assert.equal(socPolicyInputs({}).operating_max_soc_enabled,false);
  assert.equal(socPolicyInputs({operating_max_soc_enabled:true}).operating_max_soc_mode,'soft');
  const settings={use_cyclic_soc:false,operating_min_soc_mode:'soft',operating_min_soc_fraction:0,
    operating_max_soc_enabled:true,operating_max_soc_mode:'hard',operating_max_soc_fraction:1};
  const {charging_curve,...policy} = socPolicyInputs(settings);
  assert.equal(charging_curve.enabled,false);
  assert.deepEqual(policy,settings);
});

test('long-term SoC reports preserve global chunk times and separate local optimality', () => {
  const policies=[{min_mode:'soft',minimum_deviation_kwh_h:2,violations:[{minute:15}]},
    {min_mode:'soft',minimum_deviation_kwh_h:3,violations:[{minute:1455}]}];
  const result=mergeSocPolicies(policies);
  assert.equal(result.minimum_deviation_kwh_h,5);
  assert.deepEqual(result.violations.map(row=>row.minute),[15,1455]);
  assert.match(result.scope,/not a full-horizon optimum/);
  assert.deepEqual(mergeSocPolicies([]),{});
});

test('invalid operating bands are explained before any solver request', () => {
  assert.equal(socPolicyIssues({}).length,0);
  assert.equal(socPolicyIssues({operating_min_soc_fraction:-.1})[0].code,'OPERATING_SOC_CONFIGURATION');
  assert.match(socPolicyIssues({operating_min_soc_mode:'soft',operating_max_soc_enabled:true,
    operating_min_soc_fraction:.95,operating_max_soc_fraction:.9})[0].message,/must not exceed/);
  assert.ok(socPolicyIssues({operating_max_soc_fraction:NaN}).length);
});
