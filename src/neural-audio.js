import {runNeuralJob} from './neural-job.js';
import {analyzeNeuralBeats} from './neural-beat.js';
export async function analyzeBrowserNeural(buffer,{onProgress=()=>{},signal,backend='auto',separateDrums=true}={}){
  const started=performance.now();
  // The two models run in separate, short-lived workers, sequentially to bound RAM.
  const beats=await analyzeNeuralBeats(buffer,{onProgress,signal,backend});
  signal?.throwIfAborted();
  if(!separateDrums)return {...beats,model:{...beats.model,profile:'neural-pulse+browser-dsp'},elapsedSeconds:(performance.now()-started)/1000};
  onProgress({stage:'Preparing stereo for neural drum separation',progress:0});
  const rate=44100,offline=new OfflineAudioContext(2,Math.ceil(buffer.duration*rate),rate);
  const source=offline.createBufferSource();source.buffer=buffer;source.connect(offline.destination);source.start();
  const rendered=await offline.startRendering(),channels=[rendered.getChannelData(0).slice(),rendered.getChannelData(1).slice()];
  signal?.throwIfAborted();
  const drums=await runNeuralJob(()=>new Worker(new URL('./neural-drums.worker.js',import.meta.url),{type:'module'}),()=>{
    const copies=channels.map(c=>c.slice());return {payload:{channels:copies.map(c=>c.buffer)},transfer:copies.map(c=>c.buffer)};
  },{onProgress,signal,backend,label:'Drum separator'});
  return {...beats,...drums,elapsedSeconds:(performance.now()-started)/1000,model:{...beats.model,drumModel:drums.drumModel}};
}
