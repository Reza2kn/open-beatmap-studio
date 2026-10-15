import test from 'node:test';
import assert from 'node:assert/strict';
import { medianFilter } from '../src/percussion.js';
import { analyzeAudio } from '../src/audio.js';

test('separation medians match direct median including edges and repeated values',()=>{
  const input=Float32Array.from([0,3,3,1,9,2,0,1,1,4,2]);
  for(const radius of [1,2,4]) {
    const expected=Array.from(input,(_,i)=>Array.from({length:radius*2+1},(_,j)=>input[Math.max(0,Math.min(input.length-1,i+j-radius))]).sort((a,b)=>a-b)[radius]);
    assert.deepEqual(Array.from(medianFilter(input,radius)),expected);
  }
});

test('transient separation finds known drum attacks over a sustained chord',async()=>{
  const sampleRate=11025, duration=14, samples=new Float32Array(sampleRate*duration);
  for(let i=0;i<samples.length;i++) {const t=i/sampleRate; samples[i]=.07*(Math.sin(2*Math.PI*220*t)+Math.sin(2*Math.PI*330*t))*Math.min(1,t/.3);}
  const hits=[];
  for(let time=3;time<12;time+=.5) {
    hits.push(time);
    for(let j=0;j<sampleRate*.17;j++) {const t=j/sampleRate; samples[Math.round(time*sampleRate)+j]+=.7*Math.sin(2*Math.PI*(65*t+4*(1-Math.exp(-t*50))))*Math.exp(-t*30);}
  }
  const result=await analyzeAudio({sampleRate,length:samples.length,numberOfChannels:1,duration,getChannelData:()=>samples});
  const attacks=result.percussionEvents.filter(e=>e.strength>.4).map(e=>e.time);
  const found=hits.filter(time=>attacks.some(attack=>Math.abs(time-attack)<.035));
  assert.ok(found.length>=hits.length*.9,`${found.length}/${hits.length} known drums recovered`);
  assert.ok(attacks.filter(time=>time>.7&&time<2.5).length===0,'steady sustained chord does not invent repeated drums');
});
