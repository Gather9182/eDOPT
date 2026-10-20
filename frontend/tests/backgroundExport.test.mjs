import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {backgroundExport} from '../src/utils/backgroundExport.js';
import {buildExport} from '../src/utils/exportPackage.js';
import {diagnosticZip} from '../src/utils/diagnosticExport.js';

function nodeWorker(database) {
 const worker=new Worker(new URL('./fixtures/exportWorker.mjs',import.meta.url),{workerData:{database}});
 const bridge={postMessage:value=>worker.postMessage(value),terminate:()=>worker.terminate()};
 worker.on('message',data=>bridge.onmessage?.({data}));
 worker.on('error',error=>bridge.onerror?.({message:error.message}));
 return bridge;
}

test('real export worker builds a larger ZIP while the main thread continues responding',async()=>{
 const periods=365*96;
 const profile=Array(periods).fill(12.5);
 const results={scenario:'baseline',total_cost_eur:15,total_energy_mwh:1,
  schedules:Object.fromEntries(Array.from({length:12},(_,i)=>[`bus${i}`,profile])),
  aggregated_load_profile:profile,grid_import_profile:profile,electricity_prices:Array(periods).fill(100),
  run_metadata:{run_id:'worker-test',inputs:{time_step_minutes:15,buses:[]}}};
 let ticks=0;const phases=[];const timer=setInterval(()=>ticks++,2);
 try {
  const result=await backgroundExport({format:'analysis',project:{},now:'2026-10-20T12:00:00Z'},
    {identity:'worker-test',createWorker:nodeWorker,getItem:async key=>key==='optimization_results' ? results : null,onProgress:value=>phases.push(value)});
  assert.ok(ticks>3,`main-thread heartbeat count: ${ticks}`);
  assert.ok(result.blob.size>1000000);
  assert.ok(result.fileCount>10);
  assert.ok(phases.some(phase=>phase.phase==='archive'));
  assert.equal(new DataView(await result.blob.slice(0,4).arrayBuffer()).getUint32(0,true),0x04034b50);
 } finally {clearInterval(timer);}
});

test('worker preserves JSON values and rejects a changed saved run',async()=>{
 const results={electricity_prices:[0,-12],run_metadata:{run_id:'test'}};
 const options={format:'json',now:new Date().toISOString()};
 const result=await backgroundExport(options,{identity:'test',createWorker:nodeWorker,getItem:async()=>results});
 assert.deepEqual(JSON.parse(await result.blob.text()),results);
 await assert.rejects(backgroundExport(options,{identity:'old',createWorker:nodeWorker,getItem:async()=>results}),/Saved results changed/);
});

test('worker reads its own database without transferring saved results through the UI',async()=>{
 const results={value:17,run_metadata:{run_id:'direct-db'}};
 const result=await backgroundExport({format:'json'},{identity:'direct-db',
  createWorker:()=>nodeWorker({optimization_results:results}),getItem:async()=>{throw new Error('UI database bridge must not be used');}});
 assert.deepEqual(JSON.parse(await result.blob.text()),results);
});

test('cancellation terminates a busy worker and permits a later export',async()=>{
 let terminated=false;
 const controller=new AbortController();
 const pending=backgroundExport({format:'analysis'},{signal:controller.signal,createWorker:()=>({postMessage(){},terminate(){terminated=true;}})});
 controller.abort();
 await assert.rejects(pending,{name:'AbortError'});assert.equal(terminated,true);
 const result=await backgroundExport({format:'json'},{createWorker:nodeWorker,getItem:async()=>({value:5})});
 assert.equal(JSON.parse(await result.blob.text()).value,5);
});

test('worker construction and storage errors are reported without a blocking UI fallback',async()=>{
 await assert.rejects(backgroundExport({}, {createWorker:()=>{throw new Error('Worker unavailable');}}),/Worker unavailable/);
 await assert.rejects(backgroundExport({format:'json'},{createWorker:nodeWorker,getItem:async()=>{throw new Error('Storage unavailable');}}),/Storage unavailable/);
});

test('CSV background exporter preserves zero, negative values and optional columns',async()=>{
 const result=await buildExport({format:'csv',results:{electricity_prices:[0,-5],aggregated_load_profile:[0,2],grid_import_profile:[0,1]}},async()=>null);
 assert.equal(await result.blob.text(),'Period_Index,Price_EUR_MWh,Optimized_Grid_Load_kW,Net_Grid_Import_kW\n1,0,0,0\n2,-5,2,1\n');
});

test('ZIP CRC matches the standard test vector and reports actual packed file counts',async()=>{
 const progress=[];
 const blob=diagnosticZip([{name:'test.txt',data:'123456789'}],new Date(),value=>progress.push(value));
 const header=new DataView(await blob.slice(0,30).arrayBuffer());
 assert.equal(header.getUint32(14,true),0xcbf43926);
 assert.equal(progress.at(-1).completed,1);assert.equal(progress.at(-1).total,1);
});
