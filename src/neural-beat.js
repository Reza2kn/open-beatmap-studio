import {runNeuralJob} from './neural-job.js';
/** Actual Beat This! inference in a same-origin WASM worker. No companion, keys,
 * audio upload, or remote inference. Fetches only static model/runtime files. */
export async function analyzeNeuralBeats(buffer,{onProgress=()=>{},signal,backend='auto'}={}){
 if(signal?.aborted)throw new DOMException('Beat analysis cancelled.','AbortError');
 if(!(buffer?.duration>=.1&&buffer.duration<=600))throw new Error('Choose audio between 0.1 seconds and ten minutes.');
 onProgress({stage:'Preparing audio for learned beat tracking',progress:0});
 const sampleRate=22050;
 let pcm;
 if(buffer.sampleRate===sampleRate){
   pcm=new Float32Array(buffer.length);
   for(let channel=0;channel<buffer.numberOfChannels;channel++){
     const data=buffer.getChannelData(channel);for(let i=0;i<pcm.length;i++)pcm[i]+=data[i]/buffer.numberOfChannels;
   }
 }else{
   const context=new OfflineAudioContext(1,Math.ceil(buffer.duration*sampleRate),sampleRate);
   const source=context.createBufferSource();source.buffer=buffer;source.connect(context.destination);source.start();
   pcm=(await context.startRendering()).getChannelData(0).slice();
 }
 if(signal?.aborted)throw new DOMException('Beat analysis cancelled.','AbortError');
 return runNeuralJob(()=>new Worker(new URL('./neural-beat.worker.js',import.meta.url),{type:'module'}),()=>{
   const copy=pcm.slice();return {payload:{id:1,pcm:copy.buffer,duration:buffer.duration},transfer:[copy.buffer]};
 },{onProgress,signal,backend,label:'Beat tracker'});
}
