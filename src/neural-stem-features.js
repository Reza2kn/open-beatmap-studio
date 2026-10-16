/** Physical attacks in neural source estimates. No synthetic grid events.
 * Browser port of server/beat-model.py; confidence scores are heuristic.
 * JS FFT uses power-of-two padding; zero-phase browser filters differ slightly
 * from scipy's third-order Butterworth. Model/source errors remain possible. */
import {fft,zeroPhaseBandpass} from './dsp.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),round=x=>+x.toFixed(6);
function quantile(values,q){if(!values.length)return 0;const v=Array.from(values).sort((a,b)=>a-b),at=(v.length-1)*q,lo=Math.floor(at);return v[lo]+(v[Math.ceil(at)]-v[lo])*(at-lo);}
function rms(signal,first=0,last=signal.length){let sum=0;first=Math.max(0,first);last=Math.min(signal.length,last);for(let i=first;i<last;i++)sum+=signal[i]*signal[i];return Math.sqrt(sum/Math.max(1,last-first));}
function peaks(values,distance,prominence,height=()=>-Infinity){
 const candidates=[];
 for(let i=1;i<values.length-1;i++)if(values[i]>values[i-1]&&values[i]>=values[i+1])candidates.push(i);
 // scipy's distance suppression prioritizes the tallest peaks before prominence.
 const picked=[],blocked=new Uint8Array(values.length);
 for(const i of candidates.sort((a,b)=>values[b]-values[a]||b-a)){
  if(blocked[i])continue;for(let j=Math.max(0,i-distance+1);j<Math.min(values.length,i+distance);j++)blocked[j]=1;
  if(values[i]<height(i))continue;
  let left=values[i],right=values[i];
  for(let j=i-1;j>=0&&values[j]<=values[i];j--)left=Math.min(left,values[j]);
  for(let j=i+1;j<values.length&&values[j]<=values[i];j++)right=Math.min(right,values[j]);
  if(values[i]-Math.max(left,right)>=prominence)picked.push(i);
 }
 return picked.sort((a,b)=>a-b);
}
function riseEnvelope(signal,sr){
 const step=Math.max(1,Math.round(sr*.002)),width=Math.max(2,Math.round(sr*.005)),delay=Math.max(1,Math.round(.012*sr/step));
 const prefix=new Float64Array(signal.length+1);for(let i=0;i<signal.length;i++)prefix[i+1]=prefix[i]+signal[i]**2;
 const energy=new Float64Array(Math.ceil(signal.length/step)),rise=new Float64Array(energy.length);
 for(let i=0;i<energy.length;i++){const center=i*step;energy[i]=(prefix[Math.min(signal.length,center+Math.ceil(width/2))]-prefix[Math.max(0,center-Math.floor(width/2))])/width;rise[i]=Math.max(0,energy[i]-(i>=delay?energy[i-delay]:0));}
 return {rise,step};
}
function spectrum(signal,start,end,sr,{size=null}={}){
 start=clamp(Math.round(start*sr),0,signal.length);end=clamp(Math.round(end*sr),0,signal.length);const length=end-start;
 size ||=2**Math.ceil(Math.log2(Math.max(2,length)));
 const re=new Float64Array(size),im=new Float64Array(size);
 for(let i=0;i<Math.min(length,size);i++)re[i]=signal[start+i]*(.5-.5*Math.cos(2*Math.PI*i/Math.max(1,length-1)));
 fft(re,im);return Float64Array.from({length:size/2+1},(_,i)=>Math.hypot(re[i],im[i]));
}
export function stemAttackEvents(signal,sr=22050,{details=true}={}){
 const {rise,step}=riseEnvelope(signal,sr);let maximum=0;for(const value of rise)maximum=Math.max(maximum,value);if(maximum<1e-12)return {events:[],activeRanges:[]};
 const events=[];
 for(const peak of peaks(rise,Math.max(1,Math.round(.085*sr/step)),maximum*.015)){
  let edge=peak;while(edge>0&&rise[edge-1]>rise[peak]*.18)edge--;
  const time=edge*step/sr,mag=spectrum(signal,time-.005,time+.05,sr),size=(mag.length-1)*2,bands=[0,0,0];
  for(let f=0;f<mag.length;f++){const hz=f*sr/size;if(hz>=30)bands[hz<250?0:hz<2000?1:2]+=mag[f]**2;}
  const total=bands.reduce((a,b)=>a+b,0)||1,[low,mid,high]=bands.map(v=>v/total),strength=rise[peak]/maximum;
  events.push({time:round(time),strength:round(strength),kind:low>.6?'kick':high>.45?'hat':'snare',confidence:round(.55+.4*Math.sqrt(strength)),low:round(low),mid:round(mid),high:round(high),percussiveRatio:1,source:'demucs-htdemucs'});
 }
 const windows=[];for(let i=0;i<signal.length;i+=sr)windows.push(rms(signal,i,i+sr));const max=Math.max(...windows),activeRanges=[];
 windows.forEach((value,i)=>{if(value<Math.max(1e-6,max*.025))return;const end=Math.min(signal.length/sr,i+1);if(activeRanges.at(-1)?.end===i)activeRanges.at(-1).end=end;else activeRanges.push({start:i,end});});
 if(details)events.push(...stemDetailEvents(signal,sr,events));
 return {events:events.sort((a,b)=>a.time-b.time),activeRanges};
}
export function stemDetailEvents(signal,sr,core){
 if(signal.length<2048)return [];
 const n=1024,hop=128,count=Math.ceil(signal.length/hop)+1,bands=[{low:350,high:2000,kind:'snare'},{low:2000,high:Math.min(10000,sr*.47),kind:'hat'}];
 const flux=bands.map(()=>new Float64Array(count)),previous=bands.map(()=>new Float64Array(513)),re=new Float64Array(n),im=re.slice();
 const bins=bands.map(b=>Array.from({length:513},(_,i)=>i).filter(i=>i*sr/n>=b.low&&i*sr/n<b.high));
 for(let frame=0;frame<count;frame++){
  for(let i=0;i<n;i++){const at=frame*hop+i-n/2;re[i]=(at>=0&&at<signal.length?signal[at]:0)*(.5-.5*Math.cos(2*Math.PI*i/n));im[i]=0;}
  fft(re,im);
  bands.forEach((_,b)=>{let sum=0;for(const bin of bins[b]){const value=Math.log1p(Math.hypot(re[bin],im[bin])/512*100);sum+=Math.max(0,value-previous[b][bin]);previous[b][bin]=value;}flux[b][frame]=sum/bins[b].length;});
 }
 const details=[],global=rms(signal);
 bands.forEach((band,b)=>{
  if(band.high<=band.low)return;
  const filtered=zeroPhaseBandpass(signal,sr,band.low,band.high);if(rms(filtered)<Math.max(1e-7,global*.015))return;
  const scale=quantile(flux[b],.985);if(scale<1e-9)return;
  const width=Math.max(3,Math.round(.24*sr/hop)),prefix=new Float64Array(count+1);for(let i=0;i<count;i++)prefix[i+1]=prefix[i]+flux[b][i];
  const local=i=>{const a=i-Math.floor(width/2),z=a+width;return (prefix[Math.min(count,z)]-prefix[Math.max(0,a)]+Math.max(0,-a)*flux[b][0]+Math.max(0,z-count)*flux[b][count-1])/width;};
  const {rise,step}=riseEnvelope(filtered,sr);
  for(const peak of peaks(flux[b],Math.max(1,Math.round(.06*sr/hop)),scale*.1,i=>Math.max(scale*.16,local(i)*1.35))){
   const first=Math.max(0,Math.round((peak*hop/sr-.035)*sr/step)),last=Math.min(rise.length,Math.round((peak*hop/sr+.04)*sr/step)+1);if(last<=first)continue;
   let maximum=first;for(let j=first+1;j<last;j++)if(rise[j]>rise[maximum])maximum=j;if(rise[maximum]<1e-12)continue;
   let edge=maximum;while(edge>first&&rise[edge-1]>rise[maximum]*.18)edge--;
   const time=edge*step/sr;if(core.some(e=>Math.abs(e.time-time)<.055))continue;
   const strength=Math.min(1,flux[b][peak]/scale);
   details.push({time:round(time),strength:round(strength),confidence:round(.55+.3*Math.sqrt(strength)),kind:band.kind,detail:true,low:0,mid:+(band.kind==='snare'),high:+(band.kind==='hat'),percussiveRatio:1,source:'demucs-htdemucs-band'});
  }
 });
 const output=[];for(const event of details.sort((a,b)=>b.strength-a.strength||a.time-b.time))if(!output.some(e=>Math.abs(e.time-event.time)<.055))output.push(event);return output;
}
export function instrumentAttackEvents(signal,vocals,sr=22050){
 const {events:candidates}=stemAttackEvents(signal,sr,{details:false}),windows=[];for(let i=0;i<signal.length;i+=sr)windows.push(rms(signal,i,i+sr));const floor=Math.max(1e-6,quantile(windows,.95)*.025),events=[];
 for(const raw of candidates){
  const t=raw.time,before=rms(signal,Math.round((t-.05)*sr),Math.round((t-.015)*sr)),after=rms(signal,Math.round((t+.005)*sr),Math.round((t+.04)*sr)),contrast=after/Math.max(1e-7,before);if(after<floor)continue;
  const size=2**Math.ceil(Math.log2(Math.max(1024,Math.round(.035*sr)))),old=spectrum(signal,t-.05,t-.015,sr,{size}),next=spectrum(signal,t+.005,t+.04,sr,{size});
  let dot=0,aa=0,bb=0,sum=0,logs=0,count=0;
  for(let f=0;f<next.length;f++){const hz=f*sr/size;if(hz<90||hz>Math.min(6000,sr*.45))continue;dot+=old[f]*next[f];aa+=old[f]**2;bb+=next[f]**2;sum+=next[f];logs+=Math.log(next[f]+1e-10);count++;}
  const change=1-dot/Math.max(1e-12,Math.sqrt(aa*bb)),tonality=clamp(1-Math.exp(logs/count)/Math.max(1e-10,sum/count),0,1);
  if(tonality<.65||!(contrast>=1.3||(change>=.18&&contrast>=.85)))continue;
  let normI=0,normV=0,cross=0;for(let i=Math.max(0,Math.round((t-.025)*sr));i<Math.min(signal.length,vocals.length,Math.round((t+.075)*sr));i++){normI+=signal[i]**2;normV+=vocals[i]**2;cross+=signal[i]*vocals[i];}
  const dominance=Math.sqrt(normV)/Math.max(1e-9,Math.sqrt(normI)),coherence=Math.abs(cross)/Math.max(1e-12,Math.sqrt(normI*normV));if(dominance>15||(dominance>4&&coherence>.18))continue;
  events.push({...raw,kind:'melodic',source:'demucs-htdemucs-other',tonalConfidence:round(tonality),attackContrast:round(contrast),spectralChange:round(Math.max(0,change)),vocalDominance:round(dominance),vocalCoherence:round(coherence),instrumentMethod:'tonal-attacks-vocal-veto'});
 }
 return events;
}
export function extractNeuralStemFeatures({drums,other,vocals},sampleRate=22050){
 if(![drums,other,vocals].every(s=>s instanceof Float32Array&&s.length===drums.length&&s.every(Number.isFinite)))throw new Error('Neural stem features need equally sized finite mono float32 stems.');
 if(!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>48000)throw new Error('Invalid stem sample rate.');
 const started=performance.now(),{events:percussionEvents,activeRanges}=stemAttackEvents(drums,sampleRate),melodicEvents=instrumentAttackEvents(other,vocals,sampleRate);
 return {percussionEvents,percussionSource:'demucs-htdemucs',percussionMethod:'learned-drum-stem',melodicEvents,melodicSource:'demucs-htdemucs-other',melodicMethod:'tonal-attacks-vocal-veto',drumQuality:{model:'htdemucs',device:'wasm',inputSampleRate:sampleRate,inputMono:true,eventCount:percussionEvents.length,activeRanges,onsetMethod:'waveform-energy-rise+band-balanced-flux',confidenceIsHeuristic:true,elapsedSeconds:round((performance.now()-started)/1000)}};
}
