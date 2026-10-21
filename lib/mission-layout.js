const FOLDER='application/vnd.google-apps.folder';
const fold=s=>String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const clean=s=>String(s || '').replace(/[\\/:*?"<>|]/g,' ').replace(/\s+/g,' ').trim().slice(0,200);
const fail=code=>Object.assign(new Error(code),{statusCode:409});
const only=list=>{if(list.length>1)throw fail('MISSION_LAYOUT_AMBIGUOUS');return list[0] || null;};

export function missionYear(mission,now=new Date()) {
  for(const [field,value] of [['planned_start',mission.planned_start],['created_at',mission.created_at]]) {
    if(/^20\d{2}-\d{2}-\d{2}/.test(String(value || '')))return {year:String(value).slice(0,4),source:field};
  }
  return {year:String(now.getUTCFullYear()),source:'creation_time'};
}
export async function isWithin(id,rootId,drive) {
  const seen=new Set();let at=id;
  while(at && seen.size<40 && !seen.has(at)) {
    if(at===rootId)return true;
    seen.add(at);const meta=await drive.getMeta(at);if(!meta || meta.trashed)return false;at=meta.parents?.[0];
  }
  return false;
}
// User-authorized taxonomy: preserve the existing year/client or client/year convention.
// Empty root defaults to client/year. Audit period never substitutes for the mission year.
export async function organizedMissionParent(root,mission,drive,tidy,now=new Date()) {
  const name=clean(mission.client_name);if(!name)throw fail('CLIENT_REQUIRED_FOR_MISSION_LAYOUT');
  const {year,source}=missionYear(mission,now);
  const isYear=f=>new RegExp('^(?:(?:fy|exercice|annee)[ _-]*)?'+year+'$','i').test(fold(f.name));
  const kids=(await drive.listChildren(root.id)).filter(f=>f.mimeType===FOLDER);
  let client=only(kids.filter(f=>fold(f.name)===fold(name)));
  const y=only(kids.filter(isYear));
  const indexed=mission.client_folder_id?await drive.getMeta(mission.client_folder_id):null;
  if(indexed && !indexed.trashed && indexed.mimeType===FOLDER && indexed.parents?.includes(root.id))client=indexed;
  let clientUnderYear=null;
  if(y)clientUnderYear=only((await drive.listChildren(y.id)).filter(f=>f.mimeType===FOLDER && fold(f.name)===fold(name)));
  if(y && indexed && !indexed.trashed && indexed.mimeType===FOLDER && indexed.parents?.includes(y.id))clientUnderYear=indexed;
  if(client && clientUnderYear)throw fail('MISSION_LAYOUT_AMBIGUOUS');
  let parent,layout;
  if(clientUnderYear || (!client && y)) {
    client=clientUnderYear || await tidy.findOrCreateFolder(y.id,name);
    parent=client;layout='year/client/mission';
  } else {
    client ||= await tidy.findOrCreateFolder(root.id,name);
    parent=only((await drive.listChildren(client.id)).filter(f=>f.mimeType===FOLDER && isYear(f))) || await tidy.findOrCreateFolder(client.id,year);
    layout='client/year/mission';
  }
  const meta=await drive.getMeta(parent.id);
  if(!meta || meta.trashed || meta.mimeType!==FOLDER || !await isWithin(meta.id,root.id,drive))throw fail('MISSION_LAYOUT_NOT_VERIFIED');
  return {id:parent.id,client_folder_id:client.id,layout,year,year_source:source};
}
