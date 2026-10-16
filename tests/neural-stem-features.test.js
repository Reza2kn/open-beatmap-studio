import {test}from'node:test';import assert from'node:assert/strict';
import {stemAttackEvents,instrumentAttackEvents,extractNeuralStemFeatures}from'../src/neural-stem-features.js';
const sr=22050;
function pluck(signal,time,frequency,level=1,decay=.035){const start=Math.round(time*sr);for(let i=0;i<Math.min(signal.length-start,sr*.25);i++){const t=i/sr;signal[start+i]+=level*Math.sin(2*Math.PI*frequency*t)*Math.exp(-t/decay);}}
test('isolated drum events follow syncopation without inventing grid pulses',()=>{
 const signal=new Float32Array(sr*4),expected=[.5,1,1.375,1.5,2.25,3];expected.forEach(t=>pluck(signal,t,120));
 const {events}=stemAttackEvents(signal,sr,{details:false});assert.equal(events.length,expected.length);
 for(const t of expected)assert.ok(events.some(e=>Math.abs(e.time-t)<.012));
});
test('other stem does not reuse drum-detail peaks and rejects dominant voiced leakage',()=>{
 const other=new Float32Array(sr*6),vocals=other.slice();
 const real=[1,2,3,4];for(const t of real)pluck(other,t,440,1);
 for(const t of [1.5,2.5,3.5,4.5]){pluck(other,t,220,.3);pluck(vocals,t,220,7.5);}
 const events=instrumentAttackEvents(other,vocals,sr);for(const t of real)assert.ok(events.some(e=>Math.abs(e.time-t)<.015));
 assert.ok(events.every(e=>!e.detail&&e.tonalConfidence>=.65));assert.ok(events.every(e=>real.some(t=>Math.abs(e.time-t)<.015)));
});
test('silent stems have no manufactured events or active ranges',()=>{
 const zero=new Float32Array(sr),result=extractNeuralStemFeatures({drums:zero,other:zero,vocals:zero},sr);
 assert.deepEqual(result.percussionEvents,[]);assert.deepEqual(result.melodicEvents,[]);assert.deepEqual(result.drumQuality.activeRanges,[]);
});
test('quiet high-frequency physical attacks survive louder low kicks',()=>{
 const audio=new Float32Array(sr*7),expected=[];let seed=42;
 const random=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return (seed/2**32*2-1)*Math.sqrt(3);};
 for(let beat=1;beat<6;beat+=.5){pluck(audio,beat,80,.8,.04);const time=beat+.25;expected.push(time);let previous=0;for(let i=0;i<800;i++){const noise=random(),high=noise-previous;previous=noise;audio[Math.round(time*sr)+i]+=.025*high*Math.exp(-i/sr*130);}}
 const {events}=stemAttackEvents(audio,sr);const found=expected.filter(t=>events.some(e=>e.detail&&Math.abs(e.time-t)<.02));
 assert.ok(found.length>=expected.length*.9,`${found.length}/${expected.length} quiet hats retained`);
});
test('sustained instrument modulation is not a manufactured stream of notes',()=>{
 const signal=Float32Array.from({length:sr*6},(_,i)=>.08*Math.sin(2*Math.PI*440*i/sr)*(1+.1*Math.sin(2*Math.PI*4*i/sr)));
 const events=instrumentAttackEvents(signal,new Float32Array(signal.length),sr);assert.ok(events.filter(e=>e.time>.3).length<=1);
});
