/** HTDemucs overlap-add: keep input samples at their original physical times. */
export const DRUM_SAMPLE_RATE=44100;
export const DRUM_SEGMENT=343980;
export const DRUM_OVERLAP=85995;
export const DRUM_STRIDE=DRUM_SEGMENT-DRUM_OVERLAP;
export function transitionWeight(index){return Math.max(1e-5,Math.min(1,index/DRUM_OVERLAP,(DRUM_SEGMENT-1-index)/DRUM_OVERLAP));}
export function addStemChunk(outputs,weights,stems,start,total){
  const length=Math.min(DRUM_SEGMENT,total-start),rows=[0,2,3];
  // Low-pass decimate 44.1k stereo to22.05k mono; features need no stereo output.
  for(let local=0;local<length;local+=2){
    const target=(start+local)/2;
    // STRIDE is odd; target can land on half-samples. Deposit both neighbors.
    const left=Math.floor(target),fraction=target-left;
    const w=transitionWeight(local);
    for(const [index,part]of[[left,1-fraction],[left+1,fraction]]){
      if(index>=weights.length||part===0)continue;
      weights[index]+=w*part;
      for(let row=0;row<3;row++){
        const offset=rows[row]*2*DRUM_SEGMENT;
        let value=0;
        // A small symmetric lowpass avoids unfiltered aliasing of cymbal energy.
        for(let tap=-2;tap<=2;tap++){
          const at=Math.max(0,Math.min(DRUM_SEGMENT-1,local+tap));
          const kernel=[1,4,6,4,1][tap+2]/16;
          value+=(stems[offset+at]+stems[offset+DRUM_SEGMENT+at])*.5*kernel;
        }
        outputs[row][index]+=value*w*part;
      }
    }
  }
}
