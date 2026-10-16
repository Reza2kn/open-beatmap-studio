import {rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {spawnSync} from 'node:child_process';
// Both Vite environments share dist. Clear obsolete output from earlier
// static-only builds before emitting the current client and Worker artifacts.
await rm(new URL('../dist/',import.meta.url),{recursive:true,force:true});
const require=createRequire(import.meta.url),bin=join(dirname(require.resolve('vite/package.json')),'bin/vite.js');
const result=spawnSync(process.execPath,[bin,'build'],{stdio:'inherit',env:process.env});
if(result.error)throw result.error;
process.exitCode=result.status??1;
