import {browserRuntime,checkedBytes} from './neural-runtime.js';
import {DRUM_SEGMENT,DRUM_STRIDE,addStemChunk} from './neural-drums-core.js';
import {extractNeuralStemFeatures} from './neural-stem-features.js';
import {reconstructNeuralStems} from './neural-istft.js';
async function modelBytes(assetBase,progress){
  const asset=file=>new URL('models/'+file,assetBase).href;
  const response=await fetch(asset('demucs-gpu-manifest.json'));if(!response.ok)throw new Error('Drum model manifest is unavailable.');
  const manifest=await response.json(),loaded=new Float64Array(manifest.shards.length);
  const parts=await Promise.all(manifest.shards.map((part,index)=>checkedBytes(asset(part.file),part,{onProgress:(size)=>{
    loaded[index]=size;const total=loaded.reduce((a,b)=>a+b,0);
    progress(`Loading drum model · ${Math.round(total/1e6)} /${Math.round(manifest.modelBytes/1e6)} MB`,total/manifest.modelBytes);
  }})));
  const bytes=new Uint8Array(manifest.modelBytes);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}parts.length=0;
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  if(hash!==manifest.modelSha256)throw new Error('Assembled drum model failed its integrity check.');
  return {bytes,manifest};
}
self.onmessage=async({data})=>{
  const progress=(stage,value)=>self.postMessage({type:'progress',stage,progress:value});
  const started=performance.now();
  try{
    const runtime=await browserRuntime({backend:data.backend,assetBase:data.assetBase,onProgress:progress});
    const {ort}=runtime,device=runtime.backend==='webgpu'?'WebGPU':'CPU';
    const {bytes,manifest}=await modelBytes(data.assetBase,progress);
    progress(`Opening neural drum model · ${device}`,0);
    const session=await ort.InferenceSession.create(bytes,runtime.options);
    const channels=data.channels.map(x=>new Float32Array(x)),total=channels[0].length;
    const count=Math.ceil(total/DRUM_STRIDE),length=Math.ceil(total/2);
    const outputs=Array.from({length:3},()=>new Float32Array(length)),weights=new Float32Array(length);
    const input=new Float32Array(2*DRUM_SEGMENT);
    for(let chunk=0;chunk<count;chunk++){
      const start=chunk*DRUM_STRIDE,end=Math.min(total,start+DRUM_SEGMENT);
      progress(`Separating drums & instruments · ${device} · ${chunk+1}/${count}`,chunk/count);
      input.fill(0);for(let c=0;c<2;c++)input.set(channels[c].subarray(start,end),c*DRUM_SEGMENT);
      const tensor=new ort.Tensor('float32',input,[1,2,DRUM_SEGMENT]);
      const result=await session.run({mix:tensor});
      const stems=reconstructNeuralStems(result[manifest.outputs.spectra.name],result[manifest.outputs.time.name]);
      if(!stems.every(Number.isFinite))throw new Error(`${device} produced invalid audio samples.`);
      addStemChunk(outputs,weights,stems,start,total);
      tensor.dispose();for(const item of Object.values(result))item.dispose();
    }
    await session.release();
    for(let i=0;i<length;i++)if(weights[i]>0)for(const output of outputs)output[i]/=weights[i];
    progress('Finding physical drum & instrument attacks',.98);
    const features=extractNeuralStemFeatures({drums:outputs[0],other:outputs[1],vocals:outputs[2]},22050);
    self.postMessage({type:'result',result:{...features,drumQuality:{...features.drumQuality,device:runtime.backend,inputMono:false,separatorSampleRate:44100},drumModel:{name:'HTDemucs v4',license:'MIT',bytes:manifest.modelBytes,sha256:manifest.modelSha256,device:runtime.backend,browser:true},elapsedSeconds:(performance.now()-started)/1000}});
  }catch(error){self.postMessage({type:'error',error:error?.message||String(error)});}
};
