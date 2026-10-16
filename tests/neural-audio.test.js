import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeBrowserNeural} from '../src/neural-audio.js';
import {applyBeatModel} from '../src/beat-model.js';

test('fast neural mode never starts a separator and preserves DSP attack timestamps',async()=>{
  const oldWorker=globalThis.Worker,oldDocument=globalThis.document;
  const created=[];
  const result={duration:5,bpm:120,offset:0,beatTimes:[0,.5,1,1.5,2,2.5,3,3.5,4,4.5],model:{name:'Beat This!',device:'webgpu'}};
  globalThis.document={baseURI:'https://studio.test/'};
  globalThis.Worker=class {
    constructor(url){created.push(url.pathname);this.terminated=false;}
    terminate(){this.terminated=true;}
    postMessage(){queueMicrotask(()=>this.onmessage({data:{type:'result',result}}));}
  };
  try{
    const pcm=new Float32Array(110250);
    const buffer={duration:5,length:pcm.length,sampleRate:22050,numberOfChannels:1,getChannelData:()=>pcm};
    const neural=await analyzeBrowserNeural(buffer,{separateDrums:false});
    assert.equal(created.length,1);
    assert.ok(created[0].endsWith('/neural-beat.worker.js'));
    assert.equal(neural.model.profile,'neural-pulse+browser-dsp');
    assert.equal(neural.drumModel,undefined);
    const attacks=[{time:1.013,kind:'kick',strength:.8},{time:1.347,kind:'snare',strength:.7}];
    const merged=applyBeatModel({duration:5,percussionEvents:attacks,percussionSource:'browser-hpss'},neural);
    assert.deepEqual(merged.percussionEvents,attacks);
    assert.equal(merged.percussionSource,'browser-hpss');
    assert.equal(merged.beatSource,'learned');
  }finally{globalThis.Worker=oldWorker;globalThis.document=oldDocument;}
});
