import test from 'node:test';
import assert from 'node:assert/strict';
import {priceSelection,withMarketPrices,marketPricesCurrent} from '../src/utils/priceSelection.js';
import {effectivePrices} from '../src/utils/solverInputs.js';

const project={meta:{price_assumptions:{pricing_mode:'effective',supplier_markup:7,variable_network_charge:3,use_vat:false}},buses:[{id:'keep'}],constraints:{keep:true}};
const data={selected_source:'smard',prices:[-10,0],timestamps:['2025-12-10T00:00:00+01:00','2025-12-10T12:00:00+01:00'],request_selection:{source:'smard',allowFallback:false},source_intervals:[{proof:true}],snapshot_hash:'hash'};

test('default SMARD selection preserves raw quotes, markup rules and nonprice configuration',()=>{
 assert.deepEqual(priceSelection(project),{source:'smard',allowFallback:false,priceWindowMinutes:15,flatRateEnabled:false,flatRateEurKwh:null});
 const next=withMarketPrices(project,data,'2025-12-10',24,720);
 assert.equal(next.buses,project.buses);assert.equal(next.constraints,project.constraints);
 assert.deepEqual(next.meta.price_assumptions,project.meta.price_assumptions);
 assert.deepEqual(effectivePrices(next.pricing,next.meta.price_assumptions),[0,10]);
 assert.equal(next.meta.price_evidence.snapshot_hash,'hash');
 assert.equal(marketPricesCurrent(next,'2025-12-10',24,720),true);
});

test('source/date/horizon/resolution changes invalidate loaded prices without relabelling them',()=>{
 const loaded=withMarketPrices(project,data,'2025-12-10',24,720);
 const changed={...loaded,meta:{...loaded.meta,price_provider:'awattar'}};
 assert.equal(marketPricesCurrent(changed,'2025-12-10',24,720),false);
 assert.equal(changed.meta.price_source,'smard');
 assert.equal(marketPricesCurrent(loaded,'2025-12-11',24,720),false);
 assert.equal(marketPricesCurrent(loaded,'2025-12-10',48,720),false);
 assert.equal(marketPricesCurrent(loaded,'2025-12-10',24,15),false);
 const lateResult=withMarketPrices(changed,data,'2025-12-10',24,720);
 assert.equal(marketPricesCurrent(lateResult,'2025-12-10',24,720),false);
});

 test('window selection invalidates prior prices and late responses preserve actual window evidence',()=>{
 const loaded=withMarketPrices(project,data,'2025-12-10',24,720);
 const changed={...loaded,meta:{...loaded.meta,price_window_minutes:60}};
 assert.equal(marketPricesCurrent(changed,'2025-12-10',24,720),false);
 const late=withMarketPrices(changed,data,'2025-12-10',24,720);
 assert.equal(marketPricesCurrent(late,'2025-12-10',24,720),false);
 const averaged=withMarketPrices(changed,{...data,price_aggregation:{window_minutes:60}},'2025-12-10',24,720);
 assert.equal(marketPricesCurrent(averaged,'2025-12-10',24,720),true);
 assert.deepEqual(averaged.meta.price_evidence.source_intervals,data.source_intervals);
 });
