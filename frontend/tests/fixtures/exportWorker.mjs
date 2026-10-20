import {parentPort,workerData} from 'node:worker_threads';
if(workerData?.database) {
 const request=value=>{
  const result={result:value};queueMicrotask(()=>result.onsuccess?.({target:result}));return result;
 };
 globalThis.indexedDB={open:()=>request({transaction:()=>({objectStore:()=>({get:key=>request(workerData.database[key])})})})};
}
globalThis.self={postMessage:message=>parentPort.postMessage(message)};
await import('../../src/workers/export.worker.js');
parentPort.on('message',data=>self.onmessage({data}));
