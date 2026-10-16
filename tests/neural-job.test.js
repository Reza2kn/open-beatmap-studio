import test from 'node:test';
import assert from 'node:assert/strict';
import {runNeuralJob} from '../src/neural-job.js';

test('GPU failure discards the worker and uses a fresh CPU attempt with visible cause',async()=>{
 const original=globalThis.document;globalThis.document={baseURI:'https://studio.test/'};
 const modes=[],workers=[],progress=[];
 try{
  const factory=()=>{const index=workers.length;const worker={terminated:false,terminate(){this.terminated=true;},postMessage(payload){modes.push(payload.backend);queueMicrotask(()=>this.onmessage({data:index===0?{type:'error',error:'GPU device lost'}:{type:'result',result:{backend:'wasm',events:[1,2]}}}));}};workers.push(worker);return worker;};
  const result=await runNeuralJob(factory,()=>({payload:{},transfer:[]}),{onProgress:p=>progress.push(p)});
  assert.deepEqual(modes,['auto','wasm']);assert.ok(workers.every(w=>w.terminated));
  assert.deepEqual(result.events,[1,2]);assert.equal(result.runtimeFallback.reason,'GPU device lost');
  assert.ok(progress.some(p=>p.fallbackReason==='GPU device lost'));
 }finally{globalThis.document=original;}
});
test('cancellation terminates the current model and never starts a CPU retry',async()=>{
 const original=globalThis.document;globalThis.document={baseURI:'https://studio.test/'};
 const controller=new AbortController();let created=0,terminated=0;
 try{
  const promise=runNeuralJob(()=>{created++;return {terminate(){terminated++;},postMessage(){queueMicrotask(()=>controller.abort());}};},()=>({payload:{}}),{signal:controller.signal});
  await assert.rejects(promise,{name:'AbortError'});assert.equal(created,1);assert.equal(terminated,1);
 }finally{globalThis.document=original;}
});
