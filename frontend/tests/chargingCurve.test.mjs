import test from 'node:test';
import assert from 'node:assert/strict';
import {chargingCurveInputs,chargingCurveIssues} from '../src/utils/chargingCurve.js';
import {socPolicyInputs} from '../src/utils/socPolicy.js';

test('curve defaults off with the requested power bands and survives request serialization', () => {
  const curve=chargingCurveInputs();
  assert.equal(curve.enabled,false);
  assert.deepEqual(curve.bands.map(band => band.power_fraction),[.9,.65,.35,.15]);
  assert.equal(curve.power_basis,'site_charger_power');
  assert.equal('nominal_power_kw' in chargingCurveInputs({charging_curve:{nominal_power_kw:150}}),false);
  const saved={...curve,enabled:true};
  assert.deepEqual(JSON.parse(JSON.stringify(socPolicyInputs({charging_curve:saved}))).charging_curve,saved);
  curve.bands[0].power_fraction=.2;
  assert.equal(chargingCurveInputs().bands[0].power_fraction,.9);
});

test('curve validates editable boundaries and percentages before sending a run', () => {
  const curve={...chargingCurveInputs(),enabled:true};
  assert.deepEqual(chargingCurveIssues({charging_curve:curve}),[]);
  for (const invalid of [{...curve,bands:[]},
    {...curve,bands:[{end_soc_fraction:.8,power_fraction:.5}]},
    {...curve,bands:[{end_soc_fraction:1,power_fraction:0}]}]) {
    assert.equal(chargingCurveIssues({charging_curve:invalid})[0].code,'CHARGING_CURVE_CONFIGURATION');
  }
  assert.equal(chargingCurveInputs({charging_curve:{enabled:false,bands:[]}}).bands.length,4);
});
