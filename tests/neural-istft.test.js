import {test}from'node:test';import assert from'node:assert/strict';
import {fft}from'../src/dsp.js';import {inverseStft,reconstructNeuralStems}from'../src/neural-istft.js';
function forward(signal,{n,hop,frames}){
 const bins=n/2+1,result=new Float32Array(2*bins*frames);
 for(let f=0;f<frames;f++){
  const re=Float64Array.from({length:n},(_,i)=>signal[f*hop+i]*(.5-.5*Math.cos(2*Math.PI*i/n))),im=new Float64Array(n);fft(re,im);
  for(let k=0;k<bins;k++){result[k*frames+f]=re[k]/Math.sqrt(n);result[(bins+k)*frames+f]=im[k]/Math.sqrt(n);}
 }
 return result;
}
test('inverse normalized STFT reconstructs overlapping tones with correct channel order',()=>{
 const n=64,hop=16,frames=10,total=(frames-1)*hop+n,crop=16,length=total-32;
 const a=Float32Array.from({length:total},(_,i)=>.4*Math.cos(2*Math.PI*3*i/n)+.2*Math.sin(2*Math.PI*7*i/n));
 const b=Float32Array.from({length:total},(_,i)=>.7*Math.cos(2*Math.PI*11*i/n));
 const spectra=new Float32Array(2*2*(n/2+1)*frames);spectra.set(forward(a,{n,hop,frames}));spectra.set(forward(b,{n,hop,frames}),spectra.length/2);
 const got=inverseStft(spectra,{channels:2,frames,fftSize:n,hopLength:hop,length,crop});
 for(let i=0;i<length;i++){assert.ok(Math.abs(got[i]-a[crop+i])<1e-6);assert.ok(Math.abs(got[length+i]-b[crop+i])<1e-6);}
});
test('inverse STFT preserves an isolated physical attack without a crop delay',()=>{
 const n=64,hop=16,frames=10,signal=new Float32Array((frames-1)*hop+n);signal[95]=1;
 const got=inverseStft(forward(signal,{n,hop,frames}),{channels:1,frames,fftSize:n,hopLength:hop,length:150,crop:32});
 assert.equal(got.indexOf(Math.max(...got)),63);assert.ok(Math.abs(got[63]-1)<1e-6);
});
test('invalid neural branch shapes fail before a large allocation',()=>{
 assert.throws(()=>reconstructNeuralStems(new Float32Array(1),new Float32Array(1)));
 assert.throws(()=>inverseStft(new Float32Array(1),{channels:1,frames:3,length:100}));
});
