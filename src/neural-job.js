/** A failed GPU attempt is discarded and retried in a fresh CPU worker. */
export async function runNeuralJob(createWorker,makePayload,{onProgress=()=>{},signal,backend='auto',label='Neural model'}={}){
  const assetBase=new URL(import.meta.env?.BASE_URL||'./',document.baseURI).href;
  const attempt=mode=>new Promise((resolve,reject)=>{
    signal?.throwIfAborted();
    const worker=createWorker();
    const cleanup=()=>{worker.terminate();signal?.removeEventListener('abort',abort);};
    const abort=()=>{cleanup();reject(new DOMException('Analysis cancelled.','AbortError'));};
    signal?.addEventListener('abort',abort,{once:true});
    worker.onerror=event=>{cleanup();reject(new Error(event.message||`${label} could not start.`));};
    worker.onmessage=({data})=>{
      if(data.type==='progress')onProgress(data);
      else if(data.type==='result'){cleanup();resolve(data.result);}
      else if(data.type==='error'){cleanup();reject(new Error(data.error));}
    };
    const {payload,transfer=[]}=makePayload();
    worker.postMessage({...payload,assetBase,backend:mode},transfer);
  });
  try{return await attempt(backend);}
  catch(error){
    if(error.name==='AbortError'||backend==='wasm')throw error;
    onProgress({stage:`${label}: GPU attempt failed · retrying on CPU`,progress:0,fallbackReason:error.message});
    const result=await attempt('wasm');
    return {...result,runtimeFallback:{from:'webgpu',to:'wasm',reason:error.message}};
  }
}
