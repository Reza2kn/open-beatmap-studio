import cpuWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import cpuModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import gpuModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
const hex=bytes=>Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
export async function checkedBytes(url,info,{onProgress=()=>{},cacheName='open-beatmap-models-v2'}={}){
  let cache;try{cache=await caches.open(cacheName);}catch{/* optional disk cache */}
  let response=await cache?.match(url),cached=!!response;
  if(!response){response=await fetch(url,{credentials:'same-origin'});if(!response.ok)throw new Error(`Model asset download failed (${response.status}). Check your connection and retry.`);}
  const reader=response.body.getReader(),parts=[];let size=0,last=0;
  while(true){const {done,value}=await reader.read();if(done)break;parts.push(value);size+=value.byteLength;if(performance.now()-last>100||size===info.bytes){onProgress(size,info.bytes,cached);last=performance.now();}}
  if(size!==info.bytes)throw new Error('Incomplete model asset download. Please retry.');
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}parts.length=0;
  if(hex(await crypto.subtle.digest('SHA-256',bytes))!==info.sha256){await cache?.delete(url);throw new Error('Model asset checksum mismatch. Please retry.');}
  if(!cached)try{await cache?.put(url,new Response(bytes));}catch{/* usable without persistent storage */}
  return bytes;
}
export async function browserRuntime({backend='auto',assetBase,onProgress=()=>{}}={}){
  let gpu=false;
  if(backend!=='wasm'){
    try{gpu=!!(await navigator.gpu?.requestAdapter());}catch{/* unavailable GPU */}
    if(!gpu&&backend==='webgpu')throw new Error('WebGPU is unavailable in this browser.');
  }
  const actual=gpu?'webgpu':'wasm';
  const ort=gpu?await import('onnxruntime-web/webgpu'):await import('onnxruntime-web/wasm');
  ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;
  if(gpu){
    onProgress('Loading WebGPU runtime',0);
    const response=await fetch(new URL('runtime/manifest.json',assetBase));if(!response.ok)throw new Error('GPU runtime manifest is unavailable.');const manifest=await response.json();
    const compressed=await checkedBytes(new URL('runtime/'+manifest.file,assetBase).href,manifest,{onProgress:(size,total)=>onProgress('Loading WebGPU runtime',size/total)});
    const bytes=await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    if(bytes.byteLength!==manifest.uncompressedBytes||hex(await crypto.subtle.digest('SHA-256',bytes))!==manifest.uncompressedSha256)throw new Error('GPU runtime integrity check failed.');
    ort.env.wasm.wasmBinary=bytes;
    ort.env.wasm.wasmPaths={mjs:gpuModuleUrl};
  }else ort.env.wasm.wasmPaths={wasm:cpuWasmUrl,mjs:cpuModuleUrl};
  return {ort,backend:actual,options:{executionProviders:[actual],graphOptimizationLevel:'all',enableCpuMemArena:false,enableMemPattern:false}};
}
