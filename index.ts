import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const ORG = "cd95cc4f-fd68-4f7b-b2ec-dbb2fb28fce5";
const DRIVE = "0AOuBC85x_FJSUk9PVA";
const FOLDER = "application/vnd.google-apps.folder";
const URL = Deno.env.get("SUPABASE_URL") || "";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const JOB_SECRET = Deno.env.get("ORPAILLEUR_JOB_SECRET") || "";
const headers = {"apikey":KEY,"Authorization":"Bearer "+KEY,"Content-Type":"application/json"};
const json = (x:unknown,status=200) => new Response(JSON.stringify(x),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
async function db(table:string,method="GET",params="",body?:unknown,prefer?:string):Promise<any>{
 const h:Record<string,string>={...headers}; if(prefer)h.Prefer=prefer;
 const r=await fetch(URL+"/rest/v1/"+table+params,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});
 if(!r.ok)throw Error("DB "+table+" "+r.status+": "+(await r.text()).slice(0,400));
 const raw=await r.text();return raw?JSON.parse(raw):null;
}
async function rpc(name:string,args:unknown){return await db("rpc/"+name,"POST","",args)}
async function permissions(){const a=await db("office_processing_permissions","GET","?org_id=eq."+ORG+"&select=inventory_metadata_approved,selected_content_approved,external_ai_approved,outbound_messaging_approved");return a[0]||{}}
function encode(s:string){return new TextEncoder().encode(s)}
function b64url(v:Uint8Array|string){const bytes=typeof v==="string"?encode(v):v;let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")}
async function googleToken():Promise<string>{
 const sa=Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
 if(sa){
  const obj=JSON.parse(sa);const raw=atob(obj.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,""));const der=Uint8Array.from(raw,c=>c.charCodeAt(0));
  const key=await crypto.subtle.importKey("pkcs8",der,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);
  const now=Math.floor(Date.now()/1000);const assertion=b64url(JSON.stringify({alg:"RS256",typ:"JWT"}))+"."+b64url(JSON.stringify({iss:obj.client_email,scope:"https://www.googleapis.com/auth/drive",aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3300}));
  const sig=await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,encode(assertion));const jwt=assertion+"."+b64url(new Uint8Array(sig));
  const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion:jwt})});
  const x=await r.json();if(!r.ok||!x.access_token)throw Error("GOOGLE_AUTH_FAILURE "+r.status);return x.access_token;
 }
 const refresh=Deno.env.get("GOOGLE_OAUTH_REFRESH_TOKEN"),client=Deno.env.get("GOOGLE_OAUTH_CLIENT_ID"),secret=Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
 if(refresh&&client&&secret){
  const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"refresh_token",refresh_token:refresh,client_id:client,client_secret:secret})});
  const x=await r.json();if(!r.ok||!x.access_token)throw Error("GOOGLE_AUTH_FAILURE "+r.status);return x.access_token;
 }
 throw Error("GOOGLE_CONNECTION_REQUIRED: configure a service account with Shared Drive access or an OAuth refresh connection");
}
async function driveJson(path:string,token:string){
 const r=await fetch("https://www.googleapis.com/drive/v3/"+path,{headers:{"Authorization":"Bearer "+token}});
 if(!r.ok)throw Error("GOOGLE_DRIVE_"+r.status+": "+(await r.text()).slice(0,250));
 return await r.json();
}
async function listFolder(token:string,folder:string,page?:string){
 const u=new URLSearchParams({corpora:"drive",driveId:DRIVE,includeItemsFromAllDrives:"true",supportsAllDrives:"true",spaces:"drive",q:"'"+folder.replace(/'/g,"\\'")+"' in parents and trashed = false",pageSize:"250",fields:"nextPageToken,incompleteSearch,files(id,name,mimeType,parents,modifiedTime,version,size,webViewLink,md5Checksum,description)"});
 if(page)u.set("pageToken",page);
 return await driveJson("files?"+u.toString(),token);
}
async function active(){const rows=await db("orpailleur_scan_runs","GET","?org_id=eq."+ORG+"&drive_id=eq."+DRIVE+"&status=eq.RUNNING&order=started_at.desc&limit=1");return rows[0]||null}
async function syncOfficeRun(run:any,status:"running"|"partial"|"verified"|"failed",summary:string,errors:string[]=[]){
 let officeId=run.office_run_id;
 if(!officeId){
  const rows=await db("office_agent_runs","POST","",[{org_id:ORG,agent_key:"orpailleur",status,summary,metrics:{scan_id:run.id,drive_id:DRIVE},errors}],"return=representation");
  officeId=rows[0].id;
  await db("orpailleur_scan_runs","PATCH","?id=eq."+run.id,{office_run_id:officeId});
 }
 await db("office_agent_runs","PATCH","?id=eq."+officeId,{status,summary,metrics:{scan_id:run.id,drive_id:DRIVE,folder_count:run.folder_count,file_count:run.file_count,page_count:run.page_count},errors,finished_at:status==="running"?null:new Date().toISOString()});
}
async function queueReview(item:any,reason:string,job:any){
 const key="orpailleur-review-"+item.file_id+"-"+job.version_fingerprint;
 await db("office_action_queue","POST","?on_conflict=org_id,idempotency_key",[{org_id:ORG,agent_key:"orpailleur",action_type:"REVIEW_FILE",idempotency_key:key,summary:"Contrôler la pièce "+item.name+" avant classement",payload:{file_id:item.file_id,drive_id:DRIVE,source_parent_id:item.parent_id,source_url:item.web_url,version_fingerprint:job.version_fingerprint},evidence:{reason,inspection_queue_id:job.id},status:"proposed"}],"resolution=ignore-duplicates,return=minimal");
}
async function initiate(token:string){
 await driveJson("drives/"+DRIVE+"?fields=id,name",token);
 let run=await active();let resumed=!!run;
 if(!run){
  const staged=await db("orpailleur_scan_runs","GET","?org_id=eq."+ORG+"&drive_id=eq."+DRIVE+"&status=eq.WAITING_CONNECTION&order=started_at.desc&limit=1");
  if(staged.length){
   run=staged[0];resumed=true;
   await db("orpailleur_scan_runs","PATCH","?id=eq."+run.id,{status:"RUNNING",heartbeat_at:new Date().toISOString(),last_error:null});
  }else{
   const rows=await db("orpailleur_scan_runs","POST","",[{org_id:ORG,drive_id:DRIVE,status:"RUNNING",heartbeat_at:new Date().toISOString()}],"return=representation");
   run=rows[0];
  }
 }
 await db("orpailleur_folder_queue","POST","?on_conflict=run_id,folder_id",[{run_id:run.id,folder_id:DRIVE,folder_path:"/",depth:0,status:"PENDING"}],"resolution=ignore-duplicates,return=minimal");
 await syncOfficeRun(run,"running","Inventaire du Shared Drive en cours ; aucun classement non vérifié.");
 return {run_id:run.id,status:"RUNNING",resumed};
}
async function doPage(run:any,token:string){
 const jobs=await rpc("orpailleur_claim_folder",{p_run_id:run.id});const job=jobs?.[0];
 if(!job)return {idle:true};
 try{
  const page=await listFolder(token,job.folder_id,job.page_token||undefined);
  if(page.incompleteSearch)throw Error("GOOGLE_INCOMPLETE_SEARCH");
  const files=page.files||[];
  const ids=files.map((x:any)=>x.id);
  const old=ids.length?await db("orpailleur_inventory","GET","?org_id=eq."+ORG+"&drive_id=eq."+DRIVE+"&file_id=in.("+ids.map(encodeURIComponent).join(",")+")&select=file_id,name,parent_id,modified_at,drive_version,classification,decision_status"):[];
  const oldMap=new Map(old.map((x:any)=>[x.file_id,x]));
  const rows=files.map((f:any)=>{
   const prev:any=oldMap.get(f.id),modified=f.modifiedTime||null,parent=f.parents?.[0]||job.folder_id;
   const changed=!prev||prev.name!==f.name||prev.parent_id!==parent||Date.parse(prev.modified_at||"")!==Date.parse(modified||"")||prev.drive_version!==String(f.version||"");
   return {org_id:ORG,drive_id:DRIVE,file_id:f.id,parent_id:parent,folder_path:job.folder_path,name:f.name,mime_type:f.mimeType,is_folder:f.mimeType===FOLDER,
    modified_at:modified,drive_version:String(f.version||""),size_bytes:f.size?Number(f.size):null,web_url:f.webViewLink||null,last_seen_at:new Date().toISOString(),last_scan_id:run.id,
    classification:changed?"UNREVIEWED":prev?.classification||"UNREVIEWED",decision_status:changed?(prev?"CHANGED":"INVENTORIED"):"UNCHANGED"};
  });
  if(rows.length)await db("orpailleur_inventory","POST","?on_conflict=org_id,drive_id,file_id",rows,"resolution=merge-duplicates,return=minimal");
  const child=files.filter((f:any)=>f.mimeType===FOLDER).map((f:any)=>({run_id:run.id,folder_id:f.id,parent_id:job.folder_id,folder_path:job.folder_path+f.name+"/",depth:job.depth+1}));
  if(child.length)await db("orpailleur_folder_queue","POST","?on_conflict=run_id,folder_id",child,"resolution=ignore-duplicates,return=minimal");
  const inspections=files.filter((f:any)=>f.mimeType!==FOLDER).filter((f:any)=>{const p:any=oldMap.get(f.id);return !p||p.name!==f.name||p.parent_id!==(f.parents?.[0]||job.folder_id)||Date.parse(p.modified_at||"")!==Date.parse(f.modifiedTime||"")||p.drive_version!==String(f.version||"")}).map((f:any)=>({org_id:ORG,drive_id:DRIVE,file_id:f.id,version_fingerprint:String(f.version||"")+"|"+String(f.modifiedTime||"")+"|"+f.name,status:"PENDING"}));
  if(inspections.length)await db("orpailleur_inspection_queue","POST","?on_conflict=org_id,drive_id,file_id,version_fingerprint",inspections,"resolution=ignore-duplicates,return=minimal");
  await db("orpailleur_folder_queue","PATCH","?id=eq."+job.id,{status:page.nextPageToken?"PENDING":"DONE",page_token:page.nextPageToken||null,lease_until:null,scanned_at:page.nextPageToken?null:new Date().toISOString(),last_error:null});
  await db("orpailleur_scan_runs","PATCH","?id=eq."+run.id,{heartbeat_at:new Date().toISOString(),page_count:run.page_count+1,file_count:run.file_count+files.filter((x:any)=>x.mimeType!==FOLDER).length,folder_count:run.folder_count+files.filter((x:any)=>x.mimeType===FOLDER).length});
  return {folder_id:job.folder_id,page_files:files.length,folders_queued:child.length,needs_inspection:inspections.length,has_more_pages:!!page.nextPageToken};
 }catch(e){
  const err=String(e);const fatal=job.attempts>=5;
  await db("orpailleur_folder_queue","PATCH","?id=eq."+job.id,{status:fatal?"ERROR":"PENDING",lease_until:null,last_error:err});
  await db("orpailleur_scan_runs","PATCH","?id=eq."+run.id,{heartbeat_at:new Date().toISOString(),last_error:err});
  return {folder_id:job.folder_id,error:err,retry:!fatal};
 }
}
async function finish(run:any){
 const pending=await db("orpailleur_folder_queue","GET","?run_id=eq."+run.id+"&status=in.(PENDING,PROCESSING)&select=id&limit=1");
 if(pending.length)return {status:"RUNNING"};
 const errors=await db("orpailleur_folder_queue","GET","?run_id=eq."+run.id+"&status=eq.ERROR&select=id&limit=1");
 const status=errors.length?"PARTIAL":"COMPLETE";
 const work=await db("orpailleur_inspection_queue","GET","?org_id=eq."+ORG+"&drive_id=eq."+DRIVE+"&status=in.(PENDING,PROCESSING,NEEDS_REVIEW,ERROR)&select=id&limit=1");
 const officeStatus=(!errors.length&&!work.length)?"verified":"partial";
 await db("orpailleur_scan_runs","PATCH","?id=eq."+run.id,{status,finished_at:new Date().toISOString()});
 await syncOfficeRun(run,officeStatus,status==="COMPLETE"?"Inventaire récursif terminé ; décisions documentaires "+(work.length?"encore en attente.":"toutes résolues."):"Inventaire incomplet : dossiers inaccessibles ou en erreur.",errors.length?["FOLDER_SCAN_ERRORS"]:work.length?["INSPECTIONS_OR_REVIEW_PENDING"]:[]);
 return {status,office_status:officeStatus,review_or_inspection_pending:!!work.length};
}
async function inspect(token:string,p:any){
 const jobs=await rpc("orpailleur_claim_inspection",{p_org_id:ORG,p_drive_id:DRIVE});const job=jobs?.[0];if(!job)return {idle:true};
 try{
  const item=(await db("orpailleur_inventory","GET","?org_id=eq."+ORG+"&drive_id=eq."+DRIVE+"&file_id=eq."+job.file_id+"&select=*"))[0];
  if(!item)throw Error("INVENTORY_ITEM_MISSING");
  let excerpt="";const mime=item.mime_type;
  if(mime==="application/vnd.google-apps.document"||mime.startsWith("text/")){
   const path=mime==="application/vnd.google-apps.document"?"files/"+item.file_id+"/export?mimeType=text%2Fplain":"files/"+item.file_id+"?alt=media&supportsAllDrives=true";
   const r=await fetch("https://www.googleapis.com/drive/v3/"+path,{headers:{Authorization:"Bearer "+token}});if(!r.ok)throw Error("CONTENT_READ_"+r.status);
   excerpt=(await r.text()).slice(0,12000);
  }else{
   await db("orpailleur_inspection_queue","PATCH","?id=eq."+job.id,{status:"NEEDS_REVIEW",decision_reason:"No safe complete-content extractor configured for this MIME type: "+mime,lease_until:null,updated_at:new Date().toISOString()});
   await db("orpailleur_inventory","PATCH","?org_id=eq."+ORG+"&drive_id=eq."+DRIVE+"&file_id=eq."+item.file_id,{decision_status:"REVIEW",classification:"REVIEW"});
   await queueReview(item,"No safe complete-content extractor configured for "+mime,job);
   return {file_id:item.file_id,status:"NEEDS_REVIEW",mime};
  }
  const reason="Text extracted; classification requires content-based decision and current mission/architecture checks. No filename-only move.";
  await db("orpailleur_inspection_queue","PATCH","?id=eq."+job.id,{status:"NEEDS_REVIEW",content_excerpt:excerpt,decision_reason:reason,lease_until:null,updated_at:new Date().toISOString()});
  await db("orpailleur_inventory","PATCH","?org_id=eq."+ORG+"&drive_id=eq."+DRIVE+"&file_id=eq."+item.file_id,{decision_status:"REVIEW",classification:"REVIEW",content_verified_at:new Date().toISOString()});
  await queueReview(item,reason,job);
  return {file_id:item.file_id,status:"NEEDS_REVIEW",excerpt_length:excerpt.length};
 }catch(e){const error=String(e),fatal=job.attempts>=5;await db("orpailleur_inspection_queue","PATCH","?id=eq."+job.id,{status:fatal?"ERROR":"PENDING",lease_until:null,last_error:error,updated_at:new Date().toISOString()});return {file_id:job.file_id,error,retry:!fatal}}
}
async function continueScan(){
 try{
  await fetch(URL+"/functions/v1/orpailleur-durable-worker",{method:"POST",headers:{...headers,"x-orpailleur-secret":JOB_SECRET},body:JSON.stringify({action:"tick",max_pages:5})});
 }catch(e){console.error("ORPAILLEUR_CONTINUATION_FAILED",String(e));}
}
Deno.serve(async req=>{
 try{
  if(req.method!=="GET"&&req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405);
  if(!JOB_SECRET||req.headers.get("x-orpailleur-secret")!==JOB_SECRET)return json({error:"WORKER_NOT_AUTHORIZED_OR_NOT_CONFIGURED"},403);
  if(req.method==="GET")return json({service:"orpailleur-durable-worker",state:"deployed",google_connected:!!(Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON")||Deno.env.get("GOOGLE_OAUTH_REFRESH_TOKEN")),job_secret_configured:true,permissions:await permissions(),active_run:await active()});
  const body=await req.json().catch(()=>({}));const action=String(body.action||"status");
  const perms=await permissions();
  if(action==="status")return json({permissions:perms,active_run:await active()});
  if(!perms.inventory_metadata_approved)return json({error:"TENANT_METADATA_APPROVAL_REQUIRED"},409);
  if(action==="inspect"&&!perms.selected_content_approved)return json({error:"TENANT_CONTENT_APPROVAL_REQUIRED"},409);
  const token=await googleToken();
  if(action==="start"){const started=await initiate(token);EdgeRuntime.waitUntil(continueScan());return json({...started,auto_continuation:true});}
  if(action==="inspect")return json(await inspect(token,perms));
  const run=await active();if(!run)return json({error:"NO_ACTIVE_RUN"},409);
  if(action!=="tick")return json({error:"UNKNOWN_ACTION"},400);
  const pages=Math.min(5,Math.max(1,Number(body.max_pages||3)));const results=[];let current=run;
  for(let i=0;i<pages;i++){const r=await doPage(current,token);results.push(r);if(r.idle)break;current=(await active())||current;}
  const completion=await finish(run);if(completion.status==="RUNNING")EdgeRuntime.waitUntil(continueScan());return json({run_id:run.id,results,completion,auto_continuation:completion.status==="RUNNING"});
 }catch(e){return json({error:String(e)},503)}
});
