import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';

const COOKIE = 'beatmap_local_session';
const TYPES = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png',
  '.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.wasm':'application/wasm'};

/** Same-origin local studio. Pairing requires a local form POST and a short-lived
 * single-use nonce; its HttpOnly session never exposes the companion bearer key.
 */
export function createLocalStudio({ directory = resolve('dist') } = {}) {
  const nonces = new Map(), sessions = new Set(), root = resolve(directory);
  function origin(req) {
    const host = req.headers.host || '';
    const match = /^(127\.0\.0\.1|localhost):(\d+)$/.exec(host);
    return match && Number(match[2]) === req.socket.localPort ? `http://${host}` : null;
  }
  function authenticated(req) {
    const own = origin(req);
    if (!own || (req.headers.origin && req.headers.origin !== own)) return false;
    const cookie = (req.headers.cookie || '').split(';').map(v=>v.trim())
      .find(v=>v.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
    return Boolean(cookie && sessions.has(cookie));
  }
  const redirect = (res, location) => { res.writeHead(303,{Location:location});res.end(); };
  const html = (res,status,body) => {
    res.writeHead(status,{'Content-Type':'text/html; charset=utf-8'});
    res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect Open Beatmap Studio</title><style>body{color:#e8edef;background:#10151b;font:17px system-ui;line-height:1.6;max-width:560px;margin:10vh auto;padding:24px}h1{line-height:1.2}button{background:#f29b7d;color:#171a1d;border:0;border-radius:10px;padding:16px 22px;font:600 17px system-ui;cursor:pointer}code{color:#f29b7d}small{color:#a9b6bf}</style><body>${body}</body></html>`);
  };
  async function handle(req,res) {
    const path = (req.url || '').split('?')[0];
    if (!(path === '/' || path === '/connect' || path === '/studio' || path === '/studio/' || path.startsWith('/assets/') || path.startsWith('/studio/assets/') || path === '/icon.svg')) return false;
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');
    const own = origin(req);
    // These routes deliberately do not enable CORS, including for the hosted
    // app. Pairing/session credentials belong only to this exact local origin.
    if (!own || (req.headers.origin && req.headers.origin !== own)) {
      res.writeHead(403);res.end('Open the local studio directly.');return true;
    }
    if (path === '/') { redirect(res,'/studio/');return true; }
    if (path === '/connect') {
      res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
      if (req.method === 'GET') {
        if (authenticated(req)) { redirect(res,'/studio/');return true; }
        for (const [nonce,expires] of nonces) if(expires<Date.now())nonces.delete(nonce);
        while(nonces.size>=32)nonces.delete(nonces.keys().next().value);
        const nonce=randomBytes(24).toString('hex');nonces.set(nonce,Date.now()+300000);
        html(res,200,`<p>OPEN BEATMAP STUDIO · LOCAL NEURAL MODE</p><h1>Connect this browser.</h1><p>Use the models running on this computer. Your audio stays here, and no companion key needs to be copied.</p><form method="post" action="/connect"><input type="hidden" name="nonce" value="${nonce}"><button type="submit">Connect &amp; open studio</button></form><p><small>The connection lasts for this browser session. Keep the companion terminal running.</small></p>`);
        return true;
      }
      if (req.method === 'POST') {
        if(req.headers.origin!==own || !String(req.headers['content-type']||'').startsWith('application/x-www-form-urlencoded')) {
          res.writeHead(403);res.end('Connect from the local page.');return true;
        }
        let body='';
        for await(const chunk of req) {body+=chunk;if(body.length>1024){res.writeHead(413);res.end();return true;}}
        const nonce=new URLSearchParams(body).get('nonce'), expires=nonces.get(nonce);
        nonces.delete(nonce);
        if(!expires || expires<Date.now()){html(res,403,'<h1>Connection expired.</h1><p><a href="/connect">Open the connection page again.</a></p>');return true;}
        const session=randomBytes(24).toString('hex');
        while(sessions.size>=32)sessions.delete(sessions.values().next().value);
        sessions.add(session);
        res.setHeader('Set-Cookie',`${COOKIE}=${session}; HttpOnly; SameSite=Strict; Path=/`);
        redirect(res,'/studio/');return true;
      }
      res.writeHead(405);res.end();return true;
    }
    if(req.method!=='GET'){res.writeHead(405);res.end();return true;}
    const index=path==='/studio'||path==='/studio/';
    if(index&&!authenticated(req)){redirect(res,'/connect');return true;}
    let filename;
    const assetPath=path.replace(/^\/studio(?=\/assets\/)/,'');
    try {filename=resolve(root,index?'index.html':'.'+decodeURIComponent(assetPath));}
    catch {res.writeHead(400);res.end();return true;}
    const allowedRoot=assetPath.startsWith('/assets/')?resolve(root,'assets'):root;
    if(!filename.startsWith(allowedRoot+sep)){res.writeHead(403);res.end();return true;}
    try {
      const bytes=await readFile(filename);
      res.writeHead(200,{'Content-Type':TYPES[extname(filename)]||'application/octet-stream','Content-Length':bytes.length});res.end(bytes);
    } catch {
      if(index)html(res,503,'<h1>The local studio needs a build.</h1><p>In the project folder, run <code>npm run build</code>, then reload this page.</p>');
      else {res.writeHead(404);res.end();}
    }
    return true;
  }
  return {handle,authenticated};
}
