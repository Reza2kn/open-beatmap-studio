import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridge } from '../server/bridge.mjs';
import { checkLocalCompanion } from '../src/beat-model.js';

test('local pairing creates an HttpOnly session that authenticates model requests across page reloads',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'beatmap-studio-test-'));
  await mkdir(join(dir,'assets'));await writeFile(join(dir,'index.html'),'<h1>studio fixture</h1>');await writeFile(join(dir,'assets','app.js'),'/* fixture */');
  let calls=0;
  const {server}=createBridge({token:'test-bearer-secret',studioDirectory:dir,analyze:async audio=>{
    calls++;assert.equal(audio.length,5*22050*4);return{beatTimes:[0,.5,1,1.5]};
  }});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const unpaired=await fetch(base+'/studio/',{redirect:'manual'});
    assert.equal(unpaired.status,303);assert.equal(unpaired.headers.get('location'),'/connect');
    const form=await fetch(base+'/connect');const html=await form.text();
    assert.ok(!html.includes('test-bearer-secret'),'Pair page never exposes the bearer key');
    assert.equal(form.headers.get('access-control-allow-origin'),null);
    assert.ok(form.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
    const nonce=/name="nonce" value="([a-f0-9]+)"/.exec(html)[1];
    const denied=await fetch(base+'/connect',{method:'POST',headers:{Origin:'https://untrusted.example','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({nonce}),redirect:'manual'});
    assert.equal(denied.status,403);
    const paired=await fetch(base+'/connect',{method:'POST',headers:{Origin:base,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({nonce}),redirect:'manual'});
    assert.equal(paired.status,303);assert.equal(paired.headers.get('location'),'/studio/');
    const setCookie=paired.headers.get('set-cookie');assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/SameSite=Strict/);
    assert.ok(!setCookie.includes('test-bearer-secret'));
    const cookie=setCookie.split(';')[0],headers={Cookie:cookie};
    for(let reload=0;reload<2;reload++) {
      assert.equal((await fetch(base+'/studio/',{headers})).status,200);
      assert.equal((await fetch(base+'/health',{headers})).status,200);
    }
    assert.equal((await fetch(base+'/assets/app.js')).status,200);
    assert.equal((await fetch(base+'/studio/assets/app.js')).status,200,'Relative Vite assets resolve beneath /studio/ too');
    const analyzeHeaders={...headers,Origin:base,'Content-Type':'application/octet-stream'};
    const result=await fetch(base+'/analyze',{method:'POST',headers:analyzeHeaders,body:new Uint8Array(5*22050*4)});
    assert.equal(result.status,200);assert.equal(calls,1);
    assert.equal((await fetch(base+'/analyze',{method:'POST',headers:{...analyzeHeaders,Origin:'http://localhost:9999'},body:new Uint8Array(5*22050*4)})).status,401,'Another local origin cannot borrow the cookie session');
    assert.equal((await fetch(base+'/health',{headers:{...headers,Origin:'https://open-beatmap-studio.frostymoose128.chatgpt.site'}})).status,401,'Hosted app cannot borrow local cookie');
    assert.equal((await fetch(base+'/analyze',{method:'POST'})).status,401);
    assert.equal((await fetch(base+'/connect',{method:'POST',headers:{Origin:base,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({nonce}),redirect:'manual'})).status,403,'Nonce is single use');
    assert.equal((await fetch(base+'/assets/%2e%2e%2findex.html')).status,403,'Asset traversal cannot expose studio document');
  } finally {await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});

test('client verifies a local cookie session with an empty key and gives hosted tabs a connection action',async()=>{
  const requests=[];
  await checkLocalCompanion('',{location:new URL('http://127.0.0.1:4174/studio/'),fetcher:async(url,options)=>{
    requests.push({url,options});return{ok:true,json:async()=>({ready:true})};
  }});
  assert.equal(requests[0].options.credentials,'same-origin');
  assert.equal(requests[0].options.headers.Authorization,undefined);
  assert.equal(requests[0].url,'http://127.0.0.1:4174/health');
  await assert.rejects(()=>checkLocalCompanion('',{location:new URL('https://open-beatmap-studio.frostymoose128.chatgpt.site/'),fetcher:()=>{throw new Error('Must not fetch');}}),/Open the local neural studio/);
  await assert.rejects(()=>checkLocalCompanion('',{location:new URL('http://127.0.0.1:4174/studio/'),fetcher:async()=>({ok:false})}),/connection expired/);
});
