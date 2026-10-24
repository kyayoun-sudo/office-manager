import test from 'node:test';
import assert from 'node:assert/strict';
import { startAnalyticalReview, importAnalyticalReview, analyticalReviewContext, finalizeAnalyticalReview, refreshEynowaKnowledge, deleteAnalyticalFile } from '../lib/analytical-review.js';
import { auditorStep } from '../lib/enhanced-auditor.js';
const M = '11111111-1111-1111-1111-111111111111', account = { role:'owner', email:'owner@example.com' };
function world(manager = true) {
  const files = new Map();
  const docs = [{id:'client',name:'Balance N.xlsx',deposit:'analytical_review_pending'},{id:'review',name:'Revue.xlsx',deposit:'analytical_review_template',role:'feuille_de_travail'}];
  const drive = {
    findFilesByExactName:async name => files.has(name) ? [{id:name}] : [],
    downloadBuffer:async id => Buffer.from(JSON.stringify(files.get(id))),
    getMeta:async()=>({}),
    createBinary:async ({name,buffer})=>{files.set(name,JSON.parse(buffer));return {id:name};},
    updateBinary:async (id,{buffer})=>{files.set(id,JSON.parse(buffer));}
  };
  const d = { saveReport:async()=>({id:'report'}), drive,folder:'memory',missionDocuments:async()=>docs,
    fetchRows:async path=>path.startsWith('office_missions?')?[{id:M,name:'Audit',drive_folder_id:'mission'}]:path.startsWith('office_mission_assignments?')?[{id:'assignment',staff_profile_id:'person',mission_function:manager?'manager':'auditor'}]:path.startsWith('office_staff_profiles?')?[{id:'person',full_name:'Manager',email:account.email}]:[],
    updateMissionRegister:async (name,mutate)=>{mutate({missions:{[M]:{documents:docs}}});return {};},notifyMissionKnowledge:async()=>{},audit:async()=>{},
    tidyDrive:{findOrCreateFolder:async(parent,name)=>({id:name}),getFile:async()=>({name:'Revue.xlsx',parents:['mission']}),move:async()=>({name:'Revue.xlsx'})}
  };
  return {d,files,docs};
}
test('manager required; explicit sources exclude imported working files and Lab is not called',async()=>{
  const w=world(false);
  await assert.rejects(startAnalyticalReview('org',{},M,account,w.d),/MANAGER_REQUIRED/);
  const {d}=world();let payload;
  d.startAuditorReview=async(o,r,b)=>{payload=b;return {started:true};};
  d.callModel=async()=>{throw Error('Lab must not block launch');};
  await startAnalyticalReview('org',{},M,account,d);
  assert.equal(payload.analytical_review,true);assert.deepEqual(payload.evidence_files,['client']);
});
test('dedicated analytic stage uses configured provider pool without Lab or programme execution',async()=>{
  const {d,files}=world();
  files.set('OFFICE_MANAGER_ENHANCED_AUDITOR.json',{reviews:{[M]:{status:'running',stage:'analytical',focus:'[REVUE_ANALYTIQUE_PRELIMINAIRE]',mission:{id:M,name:'Audit'},evidence_files:['client'],log:[]}}});
  d.fileForAI=async()=>({name:'Balance',text:'N 100 / N-1 80'});
  d.executeMissionWork=async()=>{throw Error('programme must not execute');};
  d.multiModel=async(args,pool)=>{assert(!pool.includes('eynowa-lab'));assert(pool.includes('ollama'));assert(pool.includes('mistral'));return [{provider:'mistral',text:JSON.stringify({usable:true,summary:'Hausse de 25 % (100 contre 80)',priority_actions:['Expliquer la variation']})}];};
  const r=await auditorStep('org',{}, {mission_id:M},d);assert.equal(r.status,'done');assert.match(r.summary,/25/);
});
test('empty/template review cannot unlock programme',async()=>{
  const {d,docs}=world();d.fileForAI=async()=>({text:'Revue analytique : instructions du modèle'});
  d.multiModel=async()=>[{text:JSON.stringify({usable:false,summary:'Template',quotes:[]})}];
  const r=await importAnalyticalReview('org',M,'review',account,d);
  assert.equal(r.template,true);assert.equal(docs[1].analytical_state,'template');
  assert.equal((await analyticalReviewContext('org',M,account,d)).finalized,false);
});
test('completed review imports without manager and persists conclusions for planning',async()=>{
  const {d}=world(false);
  const quotes=['Les ventes progressent de 100 à 125, soit 25 %.','La marge baisse de 30 % à 20 % : risque à investiguer.'];
  d.fileForAI=async()=>({text:quotes.join('\n'),url:'https://drive.google.com/file/d/review/view'});
  d.multiModel=async()=>[{text:JSON.stringify({usable:true,summary:quotes.join(' '),quotes,priority_actions:['Analyser la marge']})}];
  const r=await importAnalyticalReview('org',M,'review',account,d);
  assert.equal(r.imported,true);assert.equal(r.finalized,true);
  assert.equal((await analyticalReviewContext('org',M,account,d)).finalized,true);
});
test('an unrelated auditor result cannot finalize this analytical review',async()=>{
 const {d}=world();d.auditorState=async()=>({status:'done',focus:'other audit'});
 await assert.rejects(finalizeAnalyticalReview('org',M,account,d),/NOT_FINISHED/);
});

test('document list survives a new context read independently of Lab',async()=>{
 const {d,docs}=world();d.callModel=async()=>{throw Error('unavailable');};
 const a=await analyticalReviewContext('org',M,account,d), b=await analyticalReviewContext('org',M,account,d);
 assert.deepEqual(a.documents,docs);assert.deepEqual(b.documents,docs);
 assert(a.requirements.some(r=>r.key==='trial_balance_prior' && r.required));
});
test('fabricated quotations do not turn a template into a completed review',async()=>{
 const {d}=world();d.fileForAI=async()=>({text:'Titre du modèle vide'});
 d.multiModel=async()=>[{text:JSON.stringify({usable:true,summary:'Invented',quotes:['Les ventes augmentent de 25 pour cent.','La marge baisse et exige une analyse.']})}];
 assert.equal((await importAnalyticalReview('org',M,'review',account,d)).imported,false);
});
test('classification files only the source set actually used',async()=>{
 const {d,files,docs}=world();let moved=[];
 files.set('OFFICE_MANAGER_ANALYTICAL_REVIEW.json',{missions:{[M]:{review_source_ids:['client']}}});
 d.auditorState=async()=>({status:'done',focus:'[REVUE_ANALYTIQUE_PRELIMINAIRE]'});
 d.tidyDrive.nameTaken=async()=>false;d.tidyDrive.move=async id=>{moved.push(id);return {name:'Balance N.xlsx'};};
 await finalizeAnalyticalReview('org',M,account,d);
 assert.deepEqual(moved,['client']);assert.equal(docs[0].analytical_state,'classified');assert.notEqual(docs[1].analytical_state,'classified');
});

test('Lab timeout preserves minimum N/N-1 requirements and never hides uploaded documents',async()=>{
 const {d}=world();d.labTimeoutMs=5;d.firmKnowledge=()=>new Promise(()=>{});d.env={};
 const r=await refreshEynowaKnowledge('org',M,account,d);assert.equal(r.lab.status,'timeout');
 assert(r.requirements.some(x=>x.key==='trial_balance_prior'));
 assert.equal((await analyticalReviewContext('org',M,account,d)).documents.length,2);
});
test('refreshing the Lab is refused to someone outside the mission',async()=>{
 const {d}=world();
 await assert.rejects(refreshEynowaKnowledge('org',M,{email:'outsider@example.com',role:'auditor'},d),/NOT_ON_THIS_MISSION/);
});
test('removing an uploaded source persists across context reload',async()=>{
 const {d,docs}=world();let trashed=false;
 d.tidyDrive.trashFile=async()=>{trashed=true;};
 d.updateMissionRegister=async(name,mutate)=>{const next=mutate({missions:{[M]:{documents:docs}}});docs.splice(0,docs.length,...next.missions[M].documents);return {};};
 await deleteAnalyticalFile('org',M,'client',account,d);
 assert(trashed);assert.deepEqual((await analyticalReviewContext('org',M,account,d)).documents.map(x=>x.id),['review']);
});

test('generated review keeps expectation, corroborating evidence, risks and actions in the Excel output',async()=>{
 const {d,files}=world();files.set('OFFICE_MANAGER_ENHANCED_AUDITOR.json',{reviews:{[M]:{status:'running',stage:'analytical',focus:'[REVUE_ANALYTIQUE_PRELIMINAIRE]',mission:{id:M,name:'Audit'},evidence_files:['client'],log:[]}}});
 d.fileForAI=async()=>({name:'export_01.xlsx',text:'Ventes N 125 / N-1 100'});
 const analysis={zone:'Ventes',current:125,prior:100,variation:'+25 %',expectation:'Activité stable',explanation:'Deux points de vente',evidence:'export_01.xlsx ; contrats manquants',conclusion:'Explication à corroborer',risk:'Cut-off à évaluer',assertion:'Séparation des exercices',audit_action:'Examiner les ventes de clôture'};
 d.multiModel=async()=>[{provider:'mistral',text:JSON.stringify({usable:true,summary:'Variation à expliquer, pas une anomalie automatiquement.',analyses:[analysis],priority_actions:[analysis.audit_action],missing_documents:['Contrats des points de vente']})}];
 let sheets;d.saveWorkbook=async(kind,title,data)=>{sheets=data;return{id:'excel',url:'https://drive.google.com/file/d/excel/view'};};
 const r=await auditorStep('org',{}, {mission_id:M},d);assert.equal(r.status,'done');assert.equal(r.analyses[0].expectation,analysis.expectation);assert.deepEqual(sheets[0].rows[0],['Zone','N','N-1','Variation','Attente','Explication','Preuve','Conclusion','Risque','Assertion','Action audit']);assert.equal(sheets[0].rows[1][6],analysis.evidence);assert.equal(r.matrix.id,'excel');
});
test('insufficient data requests specific documents and does not finalize the review',async()=>{
 const {d,files}=world();files.set('OFFICE_MANAGER_ENHANCED_AUDITOR.json',{reviews:{[M]:{status:'running',stage:'analytical',focus:'[REVUE_ANALYTIQUE_PRELIMINAIRE]',mission:{id:M,name:'Audit'},evidence_files:['client'],log:[]}}});
 d.fileForAI=async()=>({name:'empty.xlsx',text:'Instructions seules'});d.multiModel=async()=>[{provider:'mistral',text:JSON.stringify({usable:false,summary:'Aucune donnée comptable dans ce fichier.',missing_documents:['Balance N','Balance N-1']})}];
 const r=await auditorStep('org',{}, {mission_id:M},d);assert.equal(r.status,'needs_documents');assert.deepEqual(r.missing_documents,['Balance N','Balance N-1']);await assert.rejects(finalizeAnalyticalReview('org',M,account,d),/NOT_FINISHED/);
});

test('compact Excel rows remain importable when quotes use spaces instead of worksheet tabs',async()=>{
 const {d}=world(false);d.fileForAI=async()=>({text:'Ventes\t125\t100\nConclusion\tÉcart à justifier',url:'https://drive.google.com/file/d/review/view'});
 d.multiModel=async()=>[{text:JSON.stringify({usable:true,summary:'Revue des ventes avec conclusion.',quotes:['Ventes 125 100','Conclusion Écart à justifier'],priority_actions:['Justifier les ventes']})}];
 assert.equal((await importAnalyticalReview('org',M,'review',account,d)).imported,true);
});
test('an unreadable uploaded review remains a working file instead of becoming source evidence',async()=>{
 const {d,docs}=world();docs[1].deposit='analytical_review_pending';docs[1].path='PIECES_RECUES/Revue.xlsx';
 d.fileForAI=async()=>{throw Error('UNREADABLE_FILE');};await assert.rejects(importAnalyticalReview('org',M,'review',account,d),/UNREADABLE_FILE/);
 assert.equal(docs[1].deposit,'analytical_review_template');let payload;d.startAuditorReview=async(o,r,b)=>{payload=b;};await startAnalyticalReview('org',{},M,account,d);assert.deepEqual(payload.evidence_files,['client']);
});
