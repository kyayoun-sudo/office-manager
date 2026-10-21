import http from 'node:http';
import {createHash,timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';

const routes={
  ollama:{port:11434,get:/^\/api\/tags$/,post:/^\/api\/generate$/},
  doctr:{port:8080,get:/^\/openapi\.json$/,post:/^\/ocr\/$/},
  gotenberg:{port:3000,get:/^\/health$/,post:/^\/forms\/libreoffice\/convert$/},
  chroma:{port:8000,get:/^\/api\/v2\/heartbeat$/,post:/^\/api\/v2\/tenants\/[^/]+\/databases\/[^/]+\/collections\/[^/]+\/(query|upsert)$/},
  meilisearch:{port:7700,get:/^\/health$/,post:/^\/indexes\/[^/]+\/(search|documents)$/},
  n8n:{port:5678,get:/^\/healthz$/,post:/^\/webhook\/[a-zA-Z0-9_/-]+$/}
};
const digest=x=>createHash('sha256').update(String(x)).digest();
export function createToolRelay({token,request=http.request,maxBytes=100*1024*1024}={}){
  if(typeof token!=='string'||token.length<40)throw Error('RELAY_SECRET_REQUIRED');
  const expected=digest(token);
  return http.createServer((req,res)=>{
    const reply=(status,code)=>{if(!res.headersSent)res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:code}));};
    if(!timingSafeEqual(expected,digest(req.headers['x-office-relay-token']||'')))return reply(401,'RELAY_AUTH_REQUIRED');
    let url;try{url=new URL(req.url,'http://relay');}catch{return reply(400,'INVALID_PATH');}
    const [,name,...rest]=url.pathname.split('/'),service=routes[name],path='/'+rest.join('/');
    if(!service||req.url.includes('%')||/\.\./.test(req.url)||!service[String(req.method).toLowerCase()]?.test(path))return reply(403,'ROUTE_NOT_ALLOWED');
    if(Number(req.headers['content-length']||0)>maxBytes)return reply(413,'BODY_TOO_LARGE');
    const headers={};for(const key of ['content-type','authorization','x-chroma-token','x-webhook-secret'])if(req.headers[key])headers[key]=req.headers[key];
    let received=0,returned=0;
    const upstream=request({hostname:'127.0.0.1',port:service.port,path:path+url.search,method:req.method,headers,timeout:160000},answer=>{
      res.writeHead(answer.statusCode,{'Content-Type':answer.headers['content-type']||'application/octet-stream','Cache-Control':'no-store'});
      answer.on('data',chunk=>{returned+=chunk.length;if(returned>maxBytes){upstream.destroy();res.destroy();}});
      answer.on('error',()=>res.destroy());answer.pipe(res);
    });
    upstream.on('timeout',()=>upstream.destroy());upstream.on('error',()=>{if(res.headersSent)res.destroy();else reply(502,'LOCAL_SERVICE_UNAVAILABLE');});
    req.on('data',chunk=>{received+=chunk.length;if(received>maxBytes){upstream.destroy();reply(413,'BODY_TOO_LARGE');req.unpipe(upstream);}});
    req.on('aborted',()=>upstream.destroy());res.on('close',()=>{if(!res.writableFinished)upstream.destroy();});req.pipe(upstream);
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const token=process.env.EYNOWA_RELAY_TOKEN||(process.env.EYNOWA_RELAY_TOKEN_FILE?readFileSync(process.env.EYNOWA_RELAY_TOKEN_FILE,'utf8').trim():'');
  createToolRelay({token}).listen(17840,'127.0.0.1',()=>console.log('Protected tool relay listening on 127.0.0.1:17840'));
}
