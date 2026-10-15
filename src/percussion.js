import { fft, pickOnsets, refineOnsetTimes } from './dsp.js';
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
const clamp = x => Math.max(0, Math.min(1, x));

/** Exact sliding median with replicated edges, O(window) updates. */
export function medianFilter(values, radius) {
  const count = radius * 2 + 1, sorted = new Float32Array(count), out = new Float32Array(values.length);
  const at = i => values[Math.max(0, Math.min(values.length - 1, i))] || 0;
  for (let i = 0; i < count; i++) sorted[i] = at(i - radius);
  sorted.sort();
  for (let i = 0; i < values.length; i++) {
    out[i] = sorted[radius];
    if (i + 1 === values.length) break;
    const old = at(i - radius), next = at(i + radius + 1);
    let a = 0; while (a < count && sorted[a] !== old) a++;
    if (a < count) sorted.copyWithin(a, a + 1);
    let b = count - 1; while (b > 0 && sorted[b - 1] > next) { sorted[b] = sorted[b - 1]; b--; }
    sorted[b] = next;
  }
  return out;
}

/** Harmonic/percussive median filtering separates sustained tones from transients.
 * This is DSP separation, not semantic drum recognition. Confidence is heuristic.
 * Physical attack times are refined on the reconstructed transient signal.
 */
export async function extractPercussion(samples, rate, spectra, n, hop) {
  const bins = n / 2, frames = spectra.length / bins, dt = hop / rate;
  const harmonic = new Float32Array(spectra.length), column = new Float32Array(frames);
  for (let k = 0; k < bins; k++) {
    for (let f = 0; f < frames; f++) column[f] = spectra[f * bins + k];
    const filtered = medianFilter(column, 15);
    for (let f = 0; f < frames; f++) harmonic[f * bins + k] = filtered[f];
    if (k % 32 === 0) await pause();
  }
  const re = new Float64Array(n), im = new Float64Array(n);
  const window = Float32Array.from({length:n}, (_,i)=>.5-.5*Math.cos(2*Math.PI*i/(n-1)));
  const transient = new Float32Array(samples.length), norm = new Float32Array(samples.length);
  const novelty = Array.from({length:3}, ()=>new Float32Array(frames));
  const melodicFlux = new Float32Array(frames), flatness = new Float32Array(frames), ratio = new Float32Array(frames);
  const prev = new Float32Array(bins), prevH = new Float32Array(bins);
  for (let f = 0; f < frames; f++) {
    const mag = spectra.subarray(f*bins,(f+1)*bins), across = medianFilter(mag, 8);
    const center = f * hop; im.fill(0);
    for (let j=0;j<n;j++) re[j]=(samples[center+j-n/2]||0)*window[j];
    fft(re, im);
    let percEnergy=0, fullEnergy=0, arithmetic=0, geometric=0, count=0;
    for (let k=0;k<bins;k++) {
      const h = harmonic[f*bins+k], p = across[k];
      const mask = p*p / (p*p + h*h + 1e-16);
      const v = mag[k]*mask, sustained = mag[k]*(1-mask), hz=k*rate/n;
      if(k>=3) {
        const log=Math.log1p(40*v/n), logH=Math.log1p(40*sustained/n);
        const band=hz<250?0:hz<2000?1:2;
        novelty[band][f]+=Math.max(0,log-prev[k]);
        melodicFlux[f]+=Math.max(0,logH-prevH[k]);
        prev[k]=log;prevH[k]=logH;
        percEnergy+=v*v;fullEnergy+=mag[k]*mag[k];
        if(hz>300 && hz<4500) { arithmetic+=v;geometric+=Math.log(v+1e-12);count++; }
      }
      re[k]*=mask;im[k]*=mask;
      if(k>0) { re[n-k]*=mask; im[n-k]*=mask; }
    }
    re[n/2]=0; im[n/2]=0;
    flatness[f]=count ? Math.exp(geometric/count)/(arithmetic/count+1e-12) : 0;
    ratio[f]=Math.sqrt(percEnergy/(fullEnergy+1e-16));
    // Inverse FFT by conjugation; overlap-add using the analysis/synthesis window.
    for(let j=0;j<n;j++) im[j]=-im[j]; fft(re,im);
    for(let j=0;j<n;j++) { const index=center+j-n/2; if(index>=0&&index<samples.length){transient[index]+=re[j]/n*window[j]; norm[index]+=window[j]**2;} }
    if(f%160===0) await pause();
  }
  for(let i=0;i<transient.length;i++) if(norm[i]>.01) transient[i]/=norm[i];
  const percentiles=novelty.map(values=>{const sorted=Float32Array.from(values).sort();return sorted[Math.floor(sorted.length*.985)]||1;});
  const merged=[];
  for(let band=0;band<3;band++) {
    const envelope=Float32Array.from(novelty[band],v=>Math.min(2,v/percentiles[band]));
    const attacks=refineOnsetTimes(transient,rate,pickOnsets(envelope,dt));
    for(const attack of attacks) {
      const f=attack.frame;
      const values=novelty.map((array,i)=>array[f]/percentiles[i]);
      const total=values.reduce((a,b)=>a+b,0)||1;
      const broadband=flatness[f]>.08;
      // A strong percussive bass rise can be a kick; higher-band broadband
      // transients can be snare/hat. Tonal/piano transients retain a separate label.
      const kind=band===0 && ratio[f]>.3 ? 'kick' : broadband ? band===1?'snare':'high' : 'tonal';
      const confidence=clamp(.25+.45*ratio[f]+.3*Math.min(1,flatness[f]/.15));
      if(envelope[f]<.22 || ratio[f]<.16) continue;
      merged.push({...attack,strength:clamp(envelope[f]),kind,confidence,low:values[0]/total,mid:values[1]/total,high:values[2]/total,percussiveRatio:ratio[f],flatness:flatness[f],source:'hpss-transient'});
    }
  }
  merged.sort((a,b)=>a.time-b.time||b.confidence-a.confidence);
  const events=[];
  for(const event of merged) {
    const prior=events.at(-1);
    if(prior && event.time-prior.time<.055) {
      if(event.confidence*event.strength>prior.confidence*prior.strength) events[events.length-1]=event;
    } else events.push(event);
  }
  const sustained = Float32Array.from(samples,(sample,index)=>sample-transient[index]);
  const melodicEvents=refineOnsetTimes(sustained,rate,pickOnsets(melodicFlux,dt)).map(({frame,...event})=>({...event,kind:'melodic',confidence:.65,source:'hpss-harmonic'}));
  return {percussionEvents:events.filter(e=>e.kind!=='tonal'),melodicEvents,
    percussionMethod:'median-hpss',percussionFrameDuration:dt};
}
