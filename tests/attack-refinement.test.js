import test from 'node:test';
import assert from 'node:assert/strict';
import { zeroPhaseBandpass, refineOnsetTimes } from '../src/dsp.js';

test('a quiet hat keeps its attack when a louder kick occurs 40 ms later',()=>{
  const rate=11025, samples=new Float32Array(rate*2);
  const hit=(time,frequency,amplitude,decay)=>{
    const start=Math.round(time*rate);
    for(let j=0;j<rate*.12;j++)samples[start+j]+=amplitude*Math.sin(2*Math.PI*frequency*j/rate)*Math.exp(-j/(rate*decay));
  };
  hit(1,3500,.09,.006); hit(1.04,90,1,.025);
  const candidate=[{time:1,strength:.8}];
  const wrong=refineOnsetTimes(samples,rate,candidate)[0].time;
  const hat=refineOnsetTimes(zeroPhaseBandpass(samples,rate,2000,rate*.47),rate,candidate)[0].time;
  const kick=refineOnsetTimes(zeroPhaseBandpass(samples,rate,30,250),rate,[{time:1.04}])[0].time;
  assert.ok(wrong>1.025,`full-band control should reproduce neighboring-kick capture: ${wrong}`);
  assert.ok(Math.abs(hat-1)<.012,`hat ${hat}`);
  assert.ok(Math.abs(kick-1.04)<.012,`kick ${kick}`);
});

test('zero-phase band refinement retains timing under gain changes and rejects invalid bands',()=>{
  const rate=11025, samples=new Float32Array(rate*2);
  for(let j=0;j<rate*.08;j++)samples[rate+j]=Math.sin(2*Math.PI*3200*j/rate)*Math.exp(-j/(rate*.01));
  const refine=input=>refineOnsetTimes(zeroPhaseBandpass(input,rate,2000,rate*.47),rate,[{time:1}])[0].time;
  assert.ok(Math.abs(refine(samples)-refine(Float32Array.from(samples,x=>x*.02)))<1/rate);
  assert.throws(()=>zeroPhaseBandpass(samples,rate,2000,rate),/Band limits/);
});
