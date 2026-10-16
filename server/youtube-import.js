import {Innertube} from 'youtubei.js/cf-worker';

export function parseYouTubeUrl(input){
  let url;try{url=new URL(String(input).trim());}catch{throw new Error('Paste a valid YouTube video URL.');}
  const host=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||url.username||url.password||url.port||!['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtu.be'].includes(host))throw new Error('Use a youtube.com or youtu.be video URL.');
  const id=host==='youtu.be'?url.pathname.slice(1):['/shorts/','/embed/','/live/'].some(p=>url.pathname.startsWith(p))?url.pathname.split('/')[2]:url.pathname==='/watch'?url.searchParams.get('v'):null;
  if(!/^[\w-]{11}$/.test(id||''))throw new Error('Paste one video link, rather than a channel or playlist.');
  return id;
}
const MAX_BYTES=100*1024*1024;
const jsonError=(error,status=400)=>Response.json({error},{status,headers:{'Cache-Control':'private, no-store'}});
export async function importYouTube(request,{createClient,fetcher=fetch}={}){
  if(request.method!=='POST')return jsonError('Use POST to import a video.',405);
  const origin=request.headers.get('Origin');
  if((origin&&origin!==new URL(request.url).origin)||request.headers.get('Sec-Fetch-Site')==='cross-site')return jsonError('Open the studio to import audio.',403);
  if(!(request.headers.get('content-type')||'').startsWith('application/json')||Number(request.headers.get('content-length')||0)>4096)return jsonError('Expected a video URL.',400);
  try{
    const text=await request.text();if(text.length>4096)return jsonError('The URL is too long.');
    const id=parseYouTubeUrl(JSON.parse(text).url);
    const signal=AbortSignal.any([request.signal,AbortSignal.timeout(120000)]);
    const client=await (createClient??(options=>Innertube.create(options)))({retrieve_player:false,enable_session_cache:false,fetch:(input,init)=>fetcher(input,{...init,signal})});
    const info=await client.getBasicInfo(id,{client:'VISIONOS'});
    const details=info.basic_info,duration=Number(details.duration);
    if(details.is_live||details.is_upcoming||!Number.isFinite(duration)||duration<5||duration>600)return jsonError('Choose a public video between 5 seconds and 10 minutes.');
    let container='webm',format;
    try{format=info.chooseFormat({type:'audio',quality:'best',format:container});}
    catch{container='any';format=info.chooseFormat({type:'audio',quality:'best',format:container});}
    if(!format?.url)throw new Error('This video does not offer a downloadable audio stream.');
    const media=new URL(format.url);
    if(media.protocol!=='https:'||media.port||!media.hostname.endsWith('.googlevideo.com'))throw new Error('The audio host was not recognized.');
    const type=(format.mime_type||'').split(';')[0];
    if(!['audio/mp4','audio/webm','audio/ogg'].includes(type))throw new Error('YouTube returned an unsupported audio format.');
    const length=Number(format.content_length||0);
    if(length>MAX_BYTES)throw new Error('The audio is larger than 100 MB.');
    const stream=await info.download({type:'audio',quality:'best',format:container});
    const reader=stream.getReader();let count=0;
    // Download is lazy. Surface an upstream refusal as JSON before sending
    // success headers, then relay with bounded memory and backpressure.
    const first=await reader.read();
    if(first.done||!first.value?.length)throw new Error('YouTube returned empty audio.');
    let initial=first;
    const body=new ReadableStream({
      async pull(controller){try{const {done,value}=initial??await reader.read();initial=null;if(done){controller.close();return;}count+=value.byteLength;if(count>MAX_BYTES){await reader.cancel();throw new Error('Audio exceeds 100 MB.');}controller.enqueue(value);}catch(error){controller.error(error);}},
      cancel(reason){return reader.cancel(reason);}
    });
    return new Response(body,{headers:{'Content-Type':type,'Cache-Control':'private, no-store','X-Track-Title':encodeURIComponent(details.title||'YouTube track'),'X-Track-Duration':String(duration),'X-Audio-Extension':type==='audio/mp4'?'m4a':type==='audio/webm'?'webm':'ogg',...(length?{'Content-Length':String(length)}:{})}});
  }catch(error){
    if(error.name==='AbortError')return jsonError('Import cancelled.',499);
    // Do not expose upstream signed URLs, cookies or extraction internals.
    const message=/^(Paste |Use a |Choose a |The URL|The audio|This video|YouTube |The audio host)/.test(error.message)?error.message:'YouTube could not import this public video. It may be restricted or temporarily unavailable.';
    return jsonError(message,422);
  }
}
