/** Reproducible transport compression of the pinned npm GPU runtime. */
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const dir=new URL('../public/runtime/',import.meta.url);await mkdir(dir,{recursive:true});
const raw=await readFile(new URL('../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm',import.meta.url));
const compressed=gzipSync(raw,{level:9,mtime:0}),sha=x=>createHash('sha256').update(x).digest('hex');
const file='ort-webgpu-1.30.0.wasm.gzip.bin';await writeFile(new URL(file,dir),compressed);
await writeFile(new URL('manifest.json',dir),JSON.stringify({version:'1.30.0',license:'MIT',file,bytes:compressed.length,sha256:sha(compressed),uncompressedBytes:raw.length,uncompressedSha256:sha(raw)},null,2)+'\n');
await copyFile(new URL('../node_modules/onnxruntime-web/README.md',import.meta.url),new URL('onnxruntime-README.md',dir));
console.log(JSON.stringify({bytes:compressed.length,uncompressedBytes:raw.length}));
