import test from 'node:test';
import assert from 'node:assert/strict';
import {assessBombSafety} from '../src/hazards.js';
const map=notes=>({bpm:60,notes,obstacles:[]}),note=(beat,x,y,direction=0,color=0)=>({beat,x,y,direction,color}),bomb={beat:5,x:0,y:0};
test('a bomb may share a beat with a spatially separate opposite-lane cut',()=>{
  assert.equal(assessBombSafety(bomb,map([note(5,2,0)])).safe,true);
});
test('bombs reserve incoming cuts, follow-through and uncertain dot directions',()=>{
  for(const n of [note(5,0,0),note(4.7,1,0,2),note(5.5,1,0,3),note(5,2,0,8)])assert.equal(assessBombSafety(bomb,map([n])).safe,false);
});
test('same-hand recovery can cross a bomb even when the cuts individually clear it',()=>{
  const a=note(4.6,0,0,1),b=note(5.4,2,2,0),target={beat:5,x:1,y:0};
  assert.equal(assessBombSafety(target,map([a])).safe,true);
  assert.equal(assessBombSafety(target,map([b])).safe,true);
  assert.equal(assessBombSafety(target,map([a,b])).reason,'recovery');
  assert.equal(assessBombSafety(target,map([a,{...b,color:1}])).safe,true);
});
test('wall footprints are reserved before and after their active window',()=>{
  const m={...map([]),obstacles:[{beat:5.4,x:0,y:0,width:1,height:5,duration:1}]};
  assert.equal(assessBombSafety(bomb,m).reason,'wall');
  assert.equal(assessBombSafety({...bomb,x:3},m).safe,true);
});
