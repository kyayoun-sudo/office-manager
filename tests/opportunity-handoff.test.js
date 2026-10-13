import test from 'node:test';
import assert from 'node:assert/strict';
import { handoffOpportunityDocuments } from '../lib/mission-events.js';
const folder = 'application/vnd.google-apps.folder';
function world(count = 1) {
  const files = new Map([['root', { id: 'root', mimeType: folder, parents: [] }], ['opp', { id: 'opp', mimeType: folder, parents: [] }]]);
  for (let i=0;i<count;i++) files.set('s'+String(i).padStart(4,'0'), {id:'s'+String(i).padStart(4,'0'),name:'TDR '+i+'.pdf',mimeType:'application/pdf',modifiedTime:'v1',parents:['opp']});
  const opportunity={id:'o',title:'Mission A',folder:{id:'opp',name:'Mission A'},workbook:{id:'s0000'}};
  const mission={id:'m',name:'Mission A'}; let copies=0; const registered=[];
  const d={documentReferences:async()=>[{document_type:'mission_root',document_role:'firm_reference',file_id:'root'}],patchOpportunity:async p=>Object.assign(opportunity,structuredClone(p)),fetchRows:async(path,opts)=>{if(opts) mission.drive_folder_id=JSON.parse(opts.body).drive_folder_id;return [];},tidy:{findOrCreateFolder:async(parent,name)=>{let found=[...files.values()].find(f=>f.mimeType===folder&&f.name===name&&f.parents.includes(parent));if(!found){found={id:'dest',name,mimeType:folder,parents:[parent],webViewLink:'https://drive.google.com/drive/folders/dest'};files.set(found.id,found);}return found;}},recordMissionDocuments:async(m,docs)=>registered.push(...docs),drive:{getMeta:async id=>files.get(id),listChildren:async id=>[...files.values()].filter(f=>f.parents.includes(id)),findFilesByExactName:async(name,parent)=>[...files.values()].filter(f=>f.name===name&&f.parents.includes(parent)),copyFile:async(id,name,parent)=>{const f={...files.get(id),id:'copy'+(++copies),parents:[parent]};files.set(f.id,f);return f;}}};
  return {opportunity,mission,d,files,registered,copies:()=>copies};
}
test('mission dossier is separate, originals preserved, copies registered and retries idempotent',async()=>{
 const w=world(); const r=await handoffOpportunityDocuments('org',w.opportunity,w.mission,w.d);
 assert.equal(r.status,'complete');assert.equal(w.mission.drive_folder_id,'dest');assert.deepEqual(w.files.get('s0000').parents,['opp']);assert.equal(w.registered[0].role,'acceptation');assert.equal(w.registered[0].source,'opportunity:o');
 await handoffOpportunityDocuments('org',w.opportunity,w.mission,w.d);assert.equal(w.copies(),1);
});
test('unknown mission root asks configuration without creating a folder',async()=>{
 const w=world();w.d.documentReferences=async()=>[];assert.equal((await handoffOpportunityDocuments('org',w.opportunity,w.mission,w.d)).status,'configuration_required');assert.equal(w.files.has('dest'),false);
});
test('changed source requires review and does not overwrite its copy',async()=>{
 const w=world();await handoffOpportunityDocuments('org',w.opportunity,w.mission,w.d);w.files.get('s0000').modifiedTime='v2';assert.equal((await handoffOpportunityDocuments('org',w.opportunity,w.mission,w.d)).status,'review_required');assert.equal(w.copies(),1);
});
test('large handoff resumes its checkpoint beyond the batch limit',async()=>{
 const w=world(205);assert.equal((await handoffOpportunityDocuments('org',w.opportunity,w.mission,w.d)).status,'partial');assert.equal((await handoffOpportunityDocuments('org',w.opportunity,w.mission,w.d)).status,'complete');assert.equal(w.copies(),205);
});
test('mission root inside the opportunity is refused',async()=>{
 const w=world();w.files.get('root').parents=['opp'];await assert.rejects(handoffOpportunityDocuments('org',w.opportunity,w.mission,w.d),/MISSION_DESTINATION_INSIDE_OPPORTUNITY/);assert.equal(w.copies(),0);
});
