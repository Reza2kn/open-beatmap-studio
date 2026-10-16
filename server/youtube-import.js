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
export async function importYouTube(request,{createClient,fetcher=fetch,relayUrl,relaySecret}={}){
  if(request.method!=='POST')return jsonError('Use POST to import a video.',405);
  const origin=request.headers.get('Origin');
  if((origin&&origin!==new URL(request.url).origin)||request.headers.get('Sec-Fetch-Site')==='cross-site')return jsonError('Open the studio to import audio.',403);
  if(!(request.headers.get('content-type')||'').startsWith('application/json')||Number(request.headers.get('content-length')||0)>4096)return jsonError('Expected a video URL.',400);
  try{
    const text=await request.text();if(text.length>4096)return jsonError('The URL is too long.');
    const id=parseYouTubeUrl(JSON.parse(text).url);
    const signal=AbortSignal.any([request.signal,AbortSignal.timeout(120000)]);
    if(relayUrl&&relaySecret){
      const origin=new URL(relayUrl);
      if(origin.protocol!=='https:'||origin.username||origin.password)throw new Error('The download service is unavailable.');
      const response=await fetcher(new URL('/audio',origin),{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+relaySecret},body:JSON.stringify({videoId:id}),signal,redirect:'manual'});
      if(!response.ok){
        if(response.status===429)return jsonError('The importer is busy. Try again shortly.',429);
        if(response.status===422)return jsonError('YouTube could not download this public video.',422);
        throw new Error('The download service is temporarily unavailable.');
      }
      const type=(response.headers.get('Content-Type')||'').split(';')[0],length=Number(response.headers.get('Content-Length')),duration=Number(response.headers.get('X-Track-Duration'));
      if(!['audio/webm','audio/mp4','audio/ogg'].includes(type)||!Number.isInteger(length)||length<=0||length>MAX_BYTES||!Number.isFinite(duration)||duration<5||duration>600)throw new Error('The download service returned invalid audio.');
      return await audioResponse(response.body,{type,length,duration,title:decodeURIComponent(response.headers.get('X-Track-Title')||'YouTube track')});
    }
    const client=await (createClient??(options=>Innertube.create(options)))({client_type:'VISIONOS',fail_fast:true,retrieve_player:false,enable_session_cache:false,fetch:(input,init)=>fetcher(input,{...init,signal})});
    let info;
    for(const kind of ['VISIONOS','ANDROID_VR']){
      info=await client.getBasicInfo(id,{client:kind});
      const status=info.playability_status?.status;
      if(!status||status==='OK')break;
      console.warn('youtube_import_playability',JSON.stringify({client:kind,status:status||'MISSING_VIDEO_DETAILS',reason:String(info.playability_status?.reason||'').slice(0,180)}));
    }
    if(info.playability_status?.status&&info.playability_status.status!=='OK')return jsonError('YouTube is refusing this video from the studio hosting network. Try importing an audio file.',422);
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
    return await audioResponse(stream,{type,length,duration,title:details.title||'YouTube track'});
  }catch(error){
    if(error.name==='AbortError')return jsonError('Import cancelled.',499);
    console.warn('youtube_import_failed',String(error.message||'Unknown upstream error').replace(/https?:\/\/\S+/g,'[upstream URL]').slice(0,180));
    // Do not expose upstream signed URLs, cookies or extraction internals.
    const message=/^(Paste |Use a |Choose a |The URL|The audio|The download service|This video|YouTube |The audio host)/.test(error.message)?error.message:'YouTube could not import this public video. It may be restricted or temporarily unavailable.';
    return jsonError(message,422);
  }
}
async function audioResponse(stream,{type,length,duration,title}){
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
    return new Response(body,{headers:{'Content-Type':type,'Cache-Control':'private, no-store','X-Track-Title':encodeURIComponent(title),'X-Track-Duration':String(duration),'X-Audio-Extension':type==='audio/mp4'?'m4a':type==='audio/webm'?'webm':'ogg',...(length?{'Content-Length':String(length)}:{})}});
}
