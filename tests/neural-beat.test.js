import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {logMelSpectrogram,beatChunks,makeBeatChunk,postprocessBeats,summarizeNeuralTiming} from '../src/neural-beat-core.js';
const bytes=fs.readFileSync(new URL('../public/models/beat-this-mel.f32',import.meta.url));
const bank=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);
test('official 1500-frame chunk policy keeps borders and moves final overlap',()=>{
 assert.deepEqual(beatChunks(100),[{start:-6,length:112}]);
 assert.deepEqual(beatChunks(3000),[{start:-6,length:1500},{start:1482,length:1500},{start:1506,length:1500}]);
 const spect={frames:100,data:Float32Array.from({length:12800},(_,i)=>i)};
 const chunk=makeBeatChunk(spect,beatChunks(100)[0]);
 assert.equal(chunk.length,112*128);assert.equal(chunk[6*128+3],3);assert.equal(chunk[106*128],0);
});
test('official peak postprocessing uses logits, seven-frame maxima and downbeat alignment',()=>{
 const b=new Float32Array(40).fill(-10),d=b.slice();b[4]=2;b[5]=2;b[20]=3;b[22]=2;d[18]=4;
 assert.deepEqual(postprocessBeats(b,d),{beatTimes:[.09,.4],downbeatTimes:[.4]});
});
test('constant pulse summary describes timestamps without replacing them',()=>{
 const times=Array.from({length:200},(_,i)=>.25+i*60/88),weights=times.map(()=>.9);
 const result=summarizeNeuralTiming(times,weights,times.filter((_,i)=>i%4===0));
 assert.equal(result.bpm,88);assert.equal(result.offset,.25);assert.equal(result.quality.meter,4);
});
test('silence log-Mel is finite zero and invalid PCM is rejected',()=>{
 const spect=logMelSpectrogram(new Float32Array(22050),bank);
 assert.equal(spect.frames,51);assert.ok(spect.data.every(v=>v===0));
 assert.throws(()=>logMelSpectrogram(Float32Array.of(NaN),bank));
});
test('log-Mel matches official torchaudio oracle on reflected synthetic tone boundaries',()=>{
 const pcm=Float32Array.from({length:2205},(_,i)=>.4*Math.sin(2*Math.PI*440*i/22050)+.1*Math.sin(2*Math.PI*1710*i/22050));
 const spect=logMelSpectrogram(pcm,bank);
 // Values independently computed by beat_this.preprocessing.LogMelSpect.
 for(const [frame,bin,expected]of [[0,0,5.5217900276],[0,15,7.3446569443],[0,41,3.0280468464],[1,25,2.0554604530],[2,50,.1521056592],[4,80,1.0041415691],[5,10,6.1758460999]])
  assert.ok(Math.abs(spect.data[frame*128+bin]-expected)<.00003);
});
