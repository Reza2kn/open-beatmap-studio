import test from 'node:test';
import assert from 'node:assert/strict';
import {parseYouTubeUrl,importYouTube} from '../server/youtube-import.js';
const id='206atvk4uyE';
function request(url=`https://youtu.be/${id}`,headers={}){return new Request('https://studio.test/api/youtube/import',{method:'POST',headers:{'Content-Type':'application/json','Origin':'https://studio.test',...headers},body:JSON.stringify({url})});}
function client({duration=196,host='rr1.googlevideo.com',bytes=5,failure=false}={}){
  return async options=>{
    assert.equal(options.retrieve_player,false);assert.equal(options.enable_session_cache,false);
    return{async getBasicInfo(video,config){assert.equal(video,id);assert.equal(config.client,'VISIONOS');return{
      basic_info:{duration,title:'Song / 演奏'},chooseFormat:()=>({url:`https://${host}/videoplayback`,mime_type:'audio/webm; codecs="opus"',content_length:bytes}),
      download:async()=>new ReadableStream({start(controller){if(failure){controller.error(new Error('upstream refused signedURL=secret'));return;}controller.enqueue(new Uint8Array([1,2]));controller.enqueue(new Uint8Array([3,4,5]));controller.close();}})
    };}};
  };
}
test('YouTube input accepts canonical, short, mobile and embed links without accepting arbitrary hosts',()=>{
  for(const url of [`https://youtu.be/${id}`,`https://www.youtube.com/watch?v=${id}&t=21`,`https://m.youtube.com/watch?v=${id}`,`https://youtube.com/shorts/${id}`,`https://music.youtube.com/watch?v=${id}`,`https://youtube.com/embed/${id}`])assert.equal(parseYouTubeUrl(url),id);
  for(const url of ['http://youtube.com/watch?v='+id,'https://youtube.com.evil.test/watch?v='+id,'https://youtube.com@evil.test/watch?v='+id,'https://user:secret@youtube.com/watch?v='+id,'https://youtube.com:8443/watch?v='+id,'file:///etc/passwd','https://youtube.com/playlist?list=abc','https://youtu.be/not-an-id'])assert.throws(()=>parseYouTubeUrl(url));
});
test('same-origin import relays audio and encoded metadata without requiring a key',async()=>{
  const response=await importYouTube(request(),{createClient:client()});
  assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'audio/webm');
  assert.equal(decodeURIComponent(response.headers.get('X-Track-Title')),'Song / 演奏');
  assert.equal(response.headers.get('Cache-Control'),'private, no-store');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()),new Uint8Array([1,2,3,4,5]));
});
test('cross-site and non-YouTube requests are rejected before any upstream fetch',async()=>{
  let called=false;const createClient=()=>{called=true;throw new Error('must not run');};
  assert.equal((await importYouTube(request(undefined,{Origin:'https://evil.test'}),{createClient})).status,403);
  assert.equal((await importYouTube(request('https://evil.test/'),{createClient})).status,422);
  assert.equal(called,false);
});
test('long/live-sized videos, oversized streams and unexpected media hosts are rejected',async()=>{
  for(const options of [{duration:601},{duration:NaN},{bytes:101*1024*1024},{host:'evil.test'}]){
    const response=await importYouTube(request(),{createClient:client(options)});assert.equal(response.status>=400,true);assert.match(response.headers.get('Content-Type'),/json/);
  }
});
test('a lazy CDN failure is returned as JSON rather than false download success or a leaked signed URL',async()=>{
  const response=await importYouTube(request(),{createClient:client({failure:true})});
  assert.equal(response.status,422);const text=await response.text();assert.ok(!text.includes('secret'));assert.match(text,/YouTube could not import/);
});
test('a denied player response is reported as an upstream refusal rather than an invalid song duration',async()=>{
  const tried=[];
  const response=await importYouTube(request(),{createClient:async options=>{
    assert.equal(options.fail_fast,true);
    return{getBasicInfo:async(_,config)=>{tried.push(config.client);return{basic_info:{},playability_status:{status:'LOGIN_REQUIRED',reason:'Sign in to confirm you are not a bot'}};}};
  }});
  assert.deepEqual(tried,['VISIONOS','ANDROID_VR']);assert.equal(response.status,422);
  assert.match((await response.json()).error,/hosting network/);
});
test('a second anonymous client can supply a valid stream after the first metadata response is denied',async()=>{
  const createClient=async options=>{
    const real=await client()(options),good=await real.getBasicInfo(id,{client:'VISIONOS'});
    return{getBasicInfo:async(_,config)=>config.client==='VISIONOS'?{basic_info:{},playability_status:{status:'LOGIN_REQUIRED'}}:good};
  };
  const response=await importYouTube(request(),{createClient});assert.equal(response.status,200);
  assert.equal((await response.arrayBuffer()).byteLength,5);
});
