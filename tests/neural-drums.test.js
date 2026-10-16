import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {DRUM_SEGMENT,DRUM_STRIDE,addStemChunk,transitionWeight} from '../src/neural-drums-core.js';
test('overlap-add preserves DC, stem rows and odd chunk positions without boundary gaps',()=>{
 const total=DRUM_SEGMENT+DRUM_STRIDE+130,length=Math.ceil(total/2);
 const output=Array.from({length:3},()=>new Float32Array(length)),weights=new Float32Array(length);
 const stems=new Float32Array(8*DRUM_SEGMENT);
 for(let row=0;row<4;row++)stems.fill(row+1,row*2*DRUM_SEGMENT,(row+1)*2*DRUM_SEGMENT);
 for(let start=0;start<total;start+=DRUM_STRIDE)addStemChunk(output,weights,stems,start,total);
 for(let i=0;i<length;i++){
  assert.ok(weights[i]>0,`sample${i} has no overlap weight`);
  for(const [row,expected]of[1,3,4].entries())assert.ok(Math.abs(output[row][i]/weights[i]-expected)<1e-5);
 }
});
test('shipped neural model shards reconstruct the pinned GPU core graph',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../public/models/demucs-gpu-manifest.json',import.meta.url)));
 const hash=createHash('sha256');let total=0;
 for(const part of manifest.shards){
  const bytes=readFileSync(new URL('../public/models/'+part.file,import.meta.url));
  assert.equal(bytes.length,part.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),part.sha256);
  assert.ok(bytes.length<20*1024*1024);hash.update(bytes);total+=bytes.length;
 }
 assert.equal(total,manifest.modelBytes);assert.equal(hash.digest('hex'),manifest.modelSha256);
 assert.deepEqual(manifest.input.shape,[1,2,343980]);
 assert.deepEqual(manifest.outputs.spectra.shape,[1,4,2,2,2049,340]);
 assert.ok(transitionWeight(0)>0);assert.equal(transitionWeight(DRUM_SEGMENT/2),1);
});
