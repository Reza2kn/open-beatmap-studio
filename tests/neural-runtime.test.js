import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
test('GPU runtime transport stays opaque to static hosts and decompresses to the pinned npm runtime',()=>{
 const base=new URL('../public/runtime/',import.meta.url),manifest=JSON.parse(readFileSync(new URL('manifest.json',base)));
 assert.ok(manifest.file.endsWith('.bin'),'avoid automatic HTTP gzip decoding before compressed checksum validation');
 const compressed=readFileSync(new URL(manifest.file,base)),raw=gunzipSync(compressed);
 const sha=x=>createHash('sha256').update(x).digest('hex');
 assert.equal(compressed.length,manifest.bytes);assert.equal(sha(compressed),manifest.sha256);
 assert.equal(raw.length,manifest.uncompressedBytes);assert.equal(sha(raw),manifest.uncompressedSha256);
 assert.deepEqual(raw,readFileSync(new URL('../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm',import.meta.url)));
});
