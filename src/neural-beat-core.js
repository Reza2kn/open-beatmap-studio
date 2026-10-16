/** MIT Beat This! preprocessing/postprocessing port. Model uses the exact exported
 * torchaudio Slaney bank; this is not the app's independent DSP beat detector. */
import { fft } from './dsp.js';
export const BEAT_SAMPLE_RATE = 22050;
export const BEAT_FPS = 50;
export function logMelSpectrogram(samples, bank, {onProgress=()=>{}}={}) {
  if (!(samples instanceof Float32Array) || samples.length < 513 || !samples.every(Number.isFinite))
    throw new Error('Beat analysis needs finite mono PCM at 22050 Hz, at least 24 ms.');
  if (bank.length !== 513*128) throw new Error('Invalid Beat This! mel filter bank.');
  const frames=Math.floor(samples.length/441)+1, output=new Float32Array(frames*128);
  const window=Float32Array.from({length:1024},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/1024));
  const filters=Array.from({length:128},()=>[]);
  for(let f=0;f<513;f++)for(let m=0;m<128;m++)if(bank[f*128+m])filters[m].push([f,bank[f*128+m]]);
  const real=new Float64Array(1024),imag=new Float64Array(1024),magnitude=new Float64Array(513);
  for(let frame=0;frame<frames;frame++){
    const start=frame*441-512;
    for(let i=0;i<1024;i++){
      let at=start+i;
      // torch.stft(center=True,pad_mode='reflect'); no duplicated edge sample.
      if(at<0)at=-at;
      if(at>=samples.length)at=2*samples.length-2-at;
      real[i]=Math.fround(samples[at]*window[i]);imag[i]=0;
    }
    fft(real,imag);
    for(let f=0;f<513;f++)magnitude[f]=Math.hypot(real[f],imag[f])/32;
    for(let m=0;m<128;m++){
      let sum=0;for(const [f,weight]of filters[m])sum+=magnitude[f]*weight;
      output[frame*128+m]=Math.log1p(1000*sum);
    }
    if(frame%250===0)onProgress(frame/frames);
  }
  onProgress(1);return {data:output,frames,bins:128};
}
export function beatChunks(frames){
  const starts=[];for(let start=-6;start<frames-6;start+=1488)starts.push(start);
  if(frames>1488)starts[starts.length-1]=frames-1494;
  return starts.map(start=>({start,length:Math.min(start+1500,frames)-Math.max(start,0)+Math.max(0,-start)+Math.max(0,Math.min(6,start+1500-frames))}));
}
export function makeBeatChunk(spect,{start,length}){
  const data=new Float32Array(length*128);
  const first=Math.max(0,start),last=Math.min(spect.frames,start+length);
  data.set(spect.data.subarray(first*128,last*128),(first-start)*128);return data;
}
function peakTimes(logits){
  const peaks=[];
  for(let i=0;i<logits.length;i++){
    if(!(logits[i]>0))continue;
    let maximum=-Infinity;for(let j=Math.max(0,i-3);j<=Math.min(logits.length-1,i+3);j++)maximum=Math.max(maximum,logits[j]);
    if(logits[i]===maximum)peaks.push(i);
  }
  const result=[];let mean=null,count=0;
  // Match author's incremental-mean adjacency rule exactly, including plateaus.
  for(const p of peaks){if(mean!==null&&p-mean<=1){count++;mean+=(p-mean)/count;}else{if(mean!==null)result.push(mean/50);mean=p;count=1;}}
  if(mean!==null)result.push(mean/50);return result;
}
export function postprocessBeats(beatLogits,downbeatLogits){
  const beatTimes=peakTimes(beatLogits),downbeats=peakTimes(downbeatLogits);
  const downbeatTimes=[...new Set(downbeats.map(time=>{
    if(!beatTimes.length)return time;
    let nearest=beatTimes[0];for(const beat of beatTimes)if(Math.abs(beat-time)<Math.abs(nearest-time))nearest=beat;
    return nearest;
  }))].sort((a,b)=>a-b);
  return {beatTimes,downbeatTimes};
}
const median=values=>{const a=values.slice().sort((a,b)=>a-b);return a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2;};
const mod=(a,b)=>((a%b)+b)%b;
export function summarizeNeuralTiming(times,weights,downbeats){
  if(times.length<4)return {bpm:120,offset:times[0]||0,confidence:0,quality:{beatCount:times.length,downbeatCount:downbeats.length,meter:null,meterConfidence:0,irregularIntervalFraction:1,gridResidualMedianSeconds:null}};
  const intervals=times.slice(1).map((t,i)=>t-times[i]),valid=intervals.filter(t=>t>.25&&t<1.5);
  let period=median(valid.length?valid:intervals),rough=Math.max(40,Math.min(240,60/period));
  weights=weights.map(v=>Math.max(.01,Math.min(1,v)));const total=weights.reduce((a,b)=>a+b,0);
  let coherence=-1,bpm=rough,offset=0;
  const scan=(from,to,step)=>{for(let candidate=from;candidate<to;candidate+=step){let real=0,imag=0;for(let i=0;i<times.length;i++){const a=2*Math.PI*times[i]*candidate/60;real+=weights[i]*Math.cos(a);imag+=weights[i]*Math.sin(a);}const score=Math.hypot(real,imag)/total;if(score>coherence){coherence=score;bpm=candidate;offset=mod(Math.atan2(imag,real),2*Math.PI)/(2*Math.PI)*60/candidate;}}};
  scan(Math.max(40,rough*.96),Math.min(240,rough*1.04),.01);const center=bpm;scan(center-.015,center+.015,.001);period=60/bpm;
  const points=times.map((time,i)=>({time,index:Math.round((time-offset)/period),weight:weights[i]})).filter(p=>Math.abs(p.time-offset-p.index*period)<Math.min(.08,period*.15));
  if(points.length>=8){let sw=0,sx=0,sy=0,sxx=0,sxy=0;for(const p of points){sw+=p.weight;sx+=p.weight*p.index;sy+=p.weight*p.time;sxx+=p.weight*p.index*p.index;sxy+=p.weight*p.index*p.time;}const slope=(sw*sxy-sx*sy)/(sw*sxx-sx*sx);if(slope>0&&Math.abs(slope/period-1)<.02){period=slope;bpm=60/slope;offset=mod((sy-slope*sx)/sw,slope);}}
  const irregular=intervals.filter(t=>Math.abs(t/period-1)>.22).length/intervals.length;
  const indices=downbeats.map(t=>Math.round((t-offset)/period)),spans=indices.slice(1).map((n,i)=>n-indices[i]).filter(n=>n>0),counts=new Map();for(const span of spans)counts.set(span,(counts.get(span)||0)+1);
  let meter=null,meterConfidence=0;if(spans.length){const [proposed,count]=[...counts].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0];meterConfidence=count/spans.length;if([3,4].includes(proposed)&&meterConfidence>=.75)meter=proposed;}
  return {bpm:+bpm.toFixed(3),offset:+offset.toFixed(6),confidence:+(coherence*(total/weights.length)*(1-Math.min(.5,irregular))).toFixed(4),quality:{beatCount:times.length,downbeatCount:downbeats.length,meter,meterConfidence:+meterConfidence.toFixed(4),beatConfidenceMean:+(total/weights.length).toFixed(4),irregularIntervalFraction:+irregular.toFixed(4),gridResidualMedianSeconds:+median(times.map(t=>Math.abs(mod(t-offset+period/2,period)-period/2))).toFixed(6)}};
}
export function formatNeuralBeats(beatLogits,downbeatLogits,duration,manifest){
  const {beatTimes,downbeatTimes}=postprocessBeats(beatLogits,downbeatLogits),sigmoid=v=>1/(1+Math.exp(-v));
  const beatProbabilities=Array.from(beatLogits,sigmoid),downbeatProbabilities=Array.from(downbeatLogits,sigmoid);
  const confidences=beatTimes.map(t=>beatProbabilities[Math.min(beatProbabilities.length-1,Math.round(t*50))]);
  return {schemaVersion:1,duration,model:{id:'beat-this-small0',name:'Beat This! small0 (browser)',checkpointSha256:manifest.checkpointSha256,device:'wasm',frameRate:50,postprocessor:'official-minimal',license:'MIT',learned:true,browser:true},...summarizeNeuralTiming(beatTimes,confidences,downbeatTimes),beatTimes,downbeatTimes,beats:beatTimes.map((time,i)=>({time,confidence:confidences[i],downbeatProbability:downbeatProbabilities[Math.round(time*50)],isDownbeat:downbeatTimes.includes(time)})),activations:{frameDuration:.02,beatProbabilities,downbeatProbabilities},warnings:[]};
}
