/** Conservative 2D saber envelopes. This is static lint, not headset playtesting. */
const vectors=[[0,1],[0,-1],[-1,0],[1,0],[-Math.SQRT1_2,Math.SQRT1_2],[Math.SQRT1_2,Math.SQRT1_2],[-Math.SQRT1_2,-Math.SQRT1_2],[Math.SQRT1_2,-Math.SQRT1_2]];
export const BOMB_LIMITS=Object.freeze({windowSeconds:.65,strokeExtensionCells:1.2,clearanceCells:.85,maxRecoverySeconds:1.5});
function segmentDistance(p,a,b){
  const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
function stroke(note,extension){const v=vectors[note.direction];return v?[{x:note.x-v[0]*extension,y:note.y-v[1]*extension},{x:note.x+v[0]*extension,y:note.y+v[1]*extension}]:null;}
export function createBombSafetyContext({notes=[],obstacles=[],bpm=120}){
  const ordered=[...notes].sort((a,b)=>a.beat-b.beat);
  return{notes:ordered,obstacles,bpm,hands:[0,1].map(color=>ordered.filter(n=>n.color===color))};
}
export function assessBombSafety(bomb,{notes=[],obstacles=[],bpm=120,hands},options={}){
  const limits={...BOMB_LIMITS,...options},seconds=beat=>beat*60/bpm,at=seconds(bomb.beat);
  let minClearance=Infinity,reason=null;
  const test=(distance,cause)=>{if(distance<minClearance){minClearance=distance;reason=cause;}};
  for(const note of notes){
    if(Math.abs(seconds(note.beat)-at)>limits.windowSeconds)continue;
    const endpoints=stroke(note,limits.strokeExtensionCells);
    test(endpoints?segmentDistance(bomb,...endpoints):Math.hypot(bomb.x-note.x,bomb.y-note.y)-limits.strokeExtensionCells,'cut');
  }
  for(const color of [0,1]){
    const hand=hands?.[color]??notes.filter(n=>n.color===color).sort((a,b)=>a.beat-b.beat);
    for(let i=1;i<hand.length;i++){
      const a=hand[i-1],b=hand[i],ta=seconds(a.beat),tb=seconds(b.beat);
      if(tb<at-limits.windowSeconds||ta>at+limits.windowSeconds||tb-ta>limits.maxRecoverySeconds)continue;
      const sa=stroke(a,limits.strokeExtensionCells),sb=stroke(b,limits.strokeExtensionCells);
      if(sa&&sb)test(segmentDistance(bomb,sa[1],sb[0]),'recovery');
    }
  }
  for(const wall of obstacles){
    if(at+limits.windowSeconds<seconds(wall.beat)||at-limits.windowSeconds>seconds(wall.beat+wall.duration))continue;
    if(bomb.x>=wall.x&&bomb.x<wall.x+wall.width&&bomb.y>=wall.y&&bomb.y<wall.y+wall.height)return{safe:false,reason:'wall',minClearance:0};
  }
  const safe=minClearance>=limits.clearanceCells;
  return{safe,reason:safe?null:reason,minClearance};
}
