import test from 'node:test';
import assert from 'node:assert/strict';
import {optimizationJob} from '../src/utils/optimizationProgress.js';

test('polling submits once, delivers live phases and returns the unchanged result',async () => {
  const states=[{status:'running',phase:'building_model'}, {status:'running',phase:'minimizing_soc',metrics:{incumbent:3}},
    {status:'completed',result:{scenario:'baseline',schedules:{B:[1,2]}}}];
  const observed=[];
  let starts=0;
  const result=await optimizationJob({buses:[]},{start:async()=>{starts++;return {job_id:'job'};},get:async()=>states.shift()},
    state=>observed.push(state),async()=>{});
  assert.equal(starts,1);
  assert.deepEqual(result.schedules.B,[1,2]);
  assert.equal(observed[2].phase,'minimizing_soc');
  assert.equal(observed.at(-1).result,undefined);
});

test('failed jobs keep full diagnostics for the existing export flow',async () => {
  const evidence={detail:'Infeasible',diagnostics:{model_lp:'exact model'}};
  await assert.rejects(optimizationJob({}, {start:async()=>({job_id:'job'}),get:async()=>({status:'failed',error:evidence})},()=>{},async()=>{}),
    error=>error.response.data.diagnostics.model_lp==='exact model');
});

test('a transient polling error does not submit the calculation twice',async () => {
  let polls=0,starts=0;
  const observed=[];
  const result=await optimizationJob({}, {start:async()=>{starts++;return {job_id:'job'};},get:async()=>{
    if (++polls===1) throw new Error('Temporary outage');
    return {status:'completed',result:{ok:true}};
  }},state=>observed.push(state),async()=>{});
  assert.equal(result.ok,true);
  assert.equal(starts,1);
  assert.ok(observed.some(state=>state.connection_warning));
});

test('backend restart or expiration ends polling explicitly without starting another job',async () => {
  await assert.rejects(optimizationJob({}, {start:async()=>({job_id:'lost'}),get:async()=>{
    const error=new Error('Not found');error.response={status:404,data:{detail:'Backend restarted'}};throw error;
  }},()=>{},async()=>{}), /lost.*Backend restarted/);
});
