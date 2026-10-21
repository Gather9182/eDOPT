import test from 'node:test';
import assert from 'node:assert/strict';
import {applyFlatRateInputs,flatRateQuotes,flatRateIssues,mergeFlatRateResults} from '../src/utils/flatRate.js';
import {buildSolverInputs} from '../src/utils/solverInputs.js';
import {marketPricesCurrent} from '../src/utils/priceSelection.js';

const request={planning_horizon_hours:1,time_step_minutes:15,electricity_prices:[10,20,30,40],market_prices:[1,2,3,4],
 buses:[{id:'B'}],charging_sites:[{id:'D',grid_limit_kw:40}],use_cyclic_soc:true,pv_config:{capacity_kw:10},bess_config:{capacity_kwh:20}};
const project={meta:{flat_rate_eur_kwh:.2,price_assumptions:{supplier_markup:10,variable_network_charge:20,use_vat:true,vat_rate:.2,pricing_mode:'spot'}}};

test('disabled options leave the request and loaded market prices unchanged',()=>{
 assert.equal(applyFlatRateInputs(project,request),request);
 const comparison=applyFlatRateInputs({...project,meta:{...project.meta,flat_rate_compare_arrival:true}},request);
 assert.deepEqual(comparison.electricity_prices,request.electricity_prices);
 assert.deepEqual(comparison.market_prices,request.market_prices);
 assert.equal(comparison.arrival_flat_rate_eur_mwh,276);
});

test('flat-only creates every price slot without market data and preserves all physical inputs',()=>{
 const configured={...project,meta:{...project.meta,flat_rate_enabled:true}};
 const result=applyFlatRateInputs(configured,request);
 assert.deepEqual(result.electricity_prices,[276,276,276,276]);
 assert.deepEqual(result.market_prices,[200,200,200,200]);
 for (const key of ['buses','charging_sites','use_cyclic_soc','pv_config','bess_config']) assert.equal(result[key],request[key]);
 assert.equal(marketPricesCurrent(configured,'2026-01-01',24,15),true);
 const built=buildSolverInputs({...configured,buses:[],constraints:{}},{planning_horizon:24,time_resolution:15},{prices:[],marketPrices:[]});
 assert.equal(built.electricity_prices.length,96);assert.equal(built.electricity_prices[95],276);
 const quote=flatRateQuotes('2026-01-01',48,15,.2);
 assert.equal(quote.prices.length,192);assert.equal(quote.prices[191],200);assert.deepEqual(quote.source_intervals,[]);
 assert.equal(flatRateIssues({...configured,meta:{...configured.meta,flat_rate_eur_kwh:''}}).length,1);
});

test('aggregate adds only provided completed results and refuses invalid arrival references',()=>{
 const good={total_cost_eur:3,price_assumption:{mode:'flat_rate',base_eur_kwh:.2},flat_rate_comparison:{enabled:true,comparable:true,baseline_cost_eur:5}};
 const aggregate=mergeFlatRateResults([good,{...good,total_cost_eur:2}]);
 assert.equal(aggregate.flat_rate_comparison.baseline_cost_eur,10);assert.equal(aggregate.flat_rate_comparison.savings_eur,5);
 const bad=mergeFlatRateResults([good,{...good,flat_rate_comparison:{enabled:true,comparable:false,baseline_cost_eur:null}}]);
 assert.equal(bad.flat_rate_comparison.baseline_cost_eur,null);assert.equal(bad.flat_rate_comparison.savings_eur,null);
});

test('saved conflicting toggles use flat-only and never send an extra arrival tariff',()=>{
 const saved={...project,meta:{...project.meta,flat_rate_enabled:true,flat_rate_compare_arrival:true}};
 const flat=applyFlatRateInputs(saved,request);
 assert.equal(flat.price_mode,'flat_rate');
 assert.equal(flat.arrival_flat_rate_eur_mwh,null);
 assert.deepEqual(flat.electricity_prices,[276,276,276,276]);
});
