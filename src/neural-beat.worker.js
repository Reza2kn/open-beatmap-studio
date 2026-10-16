import {browserRuntime} from './neural-runtime.js';
import {logMelSpectrogram,beatChunks,makeBeatChunk,formatNeuralBeats} from './neural-beat-core.js';
let sessionPromise;
async function fetchChecked(url,info){
  const response=await fetch(url);if(!response.ok)throw new Error(`Could not download beat model (${response.status}).`);
  const bytes=await response.arrayBuffer();
  if(bytes.byteLength!==info.bytes)throw new Error('Incomplete beat model download.');
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  if(digest!==info.sha256)throw new Error('Beat model checksum mismatch.');return bytes;
}
self.onmessage=async({data:{id,pcm,duration,assetBase,backend}})=>{
 const asset=filename=>new URL(`models/${filename}`,assetBase).href;
 const progress=(stage,value)=>self.postMessage({id,type:'progress',stage,progress:value});
 const started=performance.now();
 try{
  const runtime=await browserRuntime({backend,assetBase,onProgress:progress});
  const {ort}=runtime;
  const device=runtime.backend==='webgpu'?'WebGPU':'CPU';
  progress(`Loading neural beat model · ${device}`,0);
  const response=await fetch(asset('beat-this-manifest.json'));if(!response.ok)throw new Error('Beat model manifest is unavailable.');const manifest=await response.json();
  const bank=await fetchChecked(asset(manifest.melFile),manifest.files[manifest.melFile]);
  sessionPromise ||= fetchChecked(asset('beat-this-small0.onnx'),manifest.files['beat-this-small0.onnx'])
    .then(bytes=>ort.InferenceSession.create(bytes,runtime.options)).catch(error=>{sessionPromise=null;throw error;});
  const session=await sessionPromise;
  progress('Computing model spectrogram',0);
  const spect=logMelSpectrogram(new Float32Array(pcm),new Float32Array(bank),{onProgress:value=>progress('Computing model spectrogram',value)});
  const chunks=beatChunks(spect.frames),beat=new Float32Array(spect.frames).fill(-1000),downbeat=beat.slice();
  // Reverse order implements the author's keep_first overlapping-chunk policy.
  for(let i=chunks.length-1;i>=0;i--){
    progress(`Tracking learned beats · ${device}`,(chunks.length-1-i)/chunks.length);
    const chunk=chunks[i],input=new ort.Tensor('float32',makeBeatChunk(spect,chunk),[1,chunk.length,128]);
    const predictions=await session.run({spectrogram:input});
    const first=chunk.start+6,count=chunk.length-12;
    beat.set(predictions.beat_logits.data.subarray(6,6+count),first);
    downbeat.set(predictions.downbeat_logits.data.subarray(6,6+count),first);
    input.dispose();for(const tensor of Object.values(predictions))tensor.dispose();
  }
  const result=formatNeuralBeats(beat,downbeat,duration,manifest);
  result.model.device=runtime.backend;
  result.elapsedSeconds=+( (performance.now()-started)/1000 ).toFixed(3);
  progress('Learned beat tracking complete',1);self.postMessage({id,type:'result',result});
 }catch(error){self.postMessage({id,type:'error',error:error?.message||String(error)});}
};
