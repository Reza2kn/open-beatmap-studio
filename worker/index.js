import {importYouTube} from '../server/youtube-import.js';
export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    if(path==='/api/youtube/import')return importYouTube(request);
    if(path.startsWith('/api/'))return Response.json({error:'Not found.'},{status:404});
    return env.ASSETS.fetch(request);
  }
};
