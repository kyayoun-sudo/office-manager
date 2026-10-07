import {prepareProgramme} from './programme-models.js';
const OM=window.OfficeManager,UI=window.OMScreens,el=UI.el,$=id=>document.getElementById(id);
const messages={PLAN_SUPERSEDED:'Un nouveau plan existe. Rechargez la mission et adaptez le programme.',PLAN_CONTENT_CHANGED:'Le plan source a changé. Rechargez la mission.',PROGRAMME_CHANGED:'Un autre programme a été enregistré. Rechargez la mission avant de soumettre une nouvelle version.',PROGRAMME_DATE_OUTSIDE_MISSION:'Une échéance est en dehors des dates prévues de la mission.',INVALID_PROGRAMME:'Complétez les tâches, rôles proposés, procédures et livrables. Vérifiez les dates.',MODEL_DOES_NOT_MATCH_PLAN:'Ce modèle exige les cinq phases : cadrage, cartographie, diagnostic, conception cible et restitution.',MISSION_PROGRAMME_UNAVAILABLE:'Le stockage des programmes est indisponible.'};
let state=null,draft=[],busy=false,generation=0,dirty=false,selected='';
function status(text){$('status').textContent=text;}
function changed(){dirty=true;$('reviewed').checked=false;}
function field(label,type,value,max,onInput,wide=false){
  const box=el('div',null,'field'+(wide?' task-wide':'')),id='f-'+crypto.randomUUID();
  const title=el('label',label);title.htmlFor=id;const input=el(type==='textarea'?'textarea':'input');input.id=id;
  if(type!=='textarea')input.type=type;if(max)input.maxLength=max;input.value=value;
  input.required=type!=='date'&&label!=='Pièces attendues (une par ligne)';
  if(type==='date'){input.min=state.mission.planned_start||'';input.max=state.mission.planned_end||'';}
  input.addEventListener('input',()=>{onInput(input.value);changed();});box.append(title,input);return box;
}
function renderDraft(){
  $('phases').textContent='';
  draft.forEach((phase,index)=>{
    const box=el('section',null,'card');box.appendChild(el('h2',state.plan.phases[index]));
    phase.tasks.forEach((task,taskIndex)=>{
      const card=el('div',null,'task'),grid=el('div',null,'task-grid');card.appendChild(el('h3','Tâche '+(taskIndex+1)));
      grid.append(field('Tâche','text',task.title,300,v=>task.title=v),field('Rôle proposé','text',task.proposed_role,120,v=>task.proposed_role=v),field('Procédure proposée','textarea',task.procedure,3000,v=>task.procedure=v,true),field('Pièces attendues (une par ligne)','textarea',task.expected_documents.join('\n'),null,v=>task.expected_documents=v.split('\n').map(s=>s.trim()).filter(Boolean),true),field('Livrable attendu','textarea',task.deliverable,1000,v=>task.deliverable=v,true),field('Échéance proposée (facultative)','date',task.due_on,null,v=>task.due_on=v));card.appendChild(grid);
      if(phase.tasks.length>1){const remove=el('button','Retirer cette tâche du brouillon','btn secondary');remove.type='button';remove.addEventListener('click',()=>{phase.tasks.splice(taskIndex,1);changed();renderDraft();});card.appendChild(remove);}
      box.appendChild(card);
    });
    const add=el('button','Ajouter une tâche','btn secondary');add.type='button';add.disabled=phase.tasks.length>=20||draft.reduce((n,p)=>n+p.tasks.length,0)>=100;
    add.addEventListener('click',()=>{if(phase.tasks.length>=20||draft.reduce((n,p)=>n+p.tasks.length,0)>=100){status('Limite : 20 tâches par phase et 100 par programme.');return;}phase.tasks.push({title:'',proposed_role:'',procedure:'',expected_documents:[],deliverable:'',due_on:''});changed();renderDraft();});box.appendChild(add);$('phases').appendChild(box);
  });
}
function render(data){
  state=data;dirty=false;$('reviewed').checked=false;$('editor').hidden=!data.plan||!data.plan.phases.length;
  $('history-section').hidden=!data.programmes.length;$('history').textContent='';
  data.programmes.forEach(programme=>{
    const card=el('section',null,'item'),box=el('div',null,'t');
    box.appendChild(el('h3','Programme v'+programme.version+' · proposé · plan v'+programme.source_plan_version));
    box.appendChild(el('p',UI.dateTime(programme.created_at)+(data.plan&&programme.plan_id!==data.plan.id?' · plan remplacé, programme à adapter':''),'meta'));
    const details=el('details');details.appendChild(el('summary','Voir le programme enregistré'));
    programme.phases.forEach(phase=>{details.appendChild(el('h4',programme.source_plan_phases[phase.phase_index]));phase.tasks.forEach(task=>{
      details.appendChild(el('h5',task.title));details.appendChild(el('p','Rôle proposé : '+task.proposed_role));details.appendChild(el('p',task.procedure));details.appendChild(el('p','Pièces attendues : '+(task.expected_documents.join(' ; ')||'Aucune précisée')));details.appendChild(el('p','Livrable : '+task.deliverable));details.appendChild(el('p','Échéance proposée : '+(task.due_on||'À préciser')));
    });});box.appendChild(details);card.appendChild(box);$('history').appendChild(card);
  });
  $('history-limit').textContent=data.truncated?'Les 20 programmes les plus récents sont affichés.':'';
  if(!data.plan){status('Enregistrez d’abord un plan de mission.');return;}
  if(!data.plan.phases.length){status('Ajoutez des phases au plan source avant de préparer un programme.');return;}
  $('programme-title').textContent=data.mission.name+' · plan version '+data.plan.version;
  $('plan-source').textContent=data.plan.content;
  $('plan-guard').textContent=data.plan_approved?'Plan approuvé. Le programme reste une proposition à valider séparément.':'Plan à valider. Vous pouvez préparer le programme, aucune exécution n’est autorisée.';
  const latest=data.programmes[0];
  draft=latest&&latest.plan_id===data.plan.id?JSON.parse(JSON.stringify(latest.phases)):prepareProgramme(data.plan);
  renderDraft();status(latest&&latest.plan_id===data.plan.id?'Programme v'+latest.version+' chargé. Vous pouvez proposer une nouvelle version.':'Préparez les tâches à partir du plan affiché.');
}
async function load(){
  const id=$('mission-select').value,stamp=++generation;selected=id;state=null;draft=[];dirty=false;
  $('editor').hidden=true;$('history-section').hidden=true;$('dossier-link').hidden=!id;
  if(!id){status('Choisissez une mission.');return false;}
  $('dossier-link').href='/mission.html?id='+encodeURIComponent(id);status('Chargement du programme…');
  try{const data=await OM.api('/api/app?route=mission-programme&mission_id='+encodeURIComponent(id));if(stamp===generation)render(data);return true;}catch(e){if(stamp===generation)status(messages[e.message]||'Chargement impossible : '+e.message);return false;}
}
$('mission-select').addEventListener('change',()=>{if(dirty){$('mission-select').value=selected;status('Enregistrez le brouillon avant de changer de mission.');return;}load();});
$('prepare').addEventListener('click',()=>{
  if(!state?.plan||busy)return;if(dirty){status('Enregistrez le brouillon avant de le remplacer par un modèle.');return;}
  try{draft=prepareProgramme(state.plan,$('model').value);renderDraft();changed();status('Brouillon préparé. Adaptez les tâches et choisissez les échéances.');}catch(e){status(messages[e.message]||e.message);}
});
$('programme-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!state?.plan||!$('reviewed').checked)return;
  const body={plan_id:state.plan.id,plan_hash:state.plan.content_hash,expected_programme_id:state.programmes[0]?.id||null,phases:draft};
  busy=true;document.querySelectorAll('main input,main textarea,main select,main button').forEach(node=>node.disabled=true);status('Enregistrement de la proposition…');
  try{const saved=await OM.api('/api/app?route=mission-programme',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const ok=await load();status(!ok?'Programme enregistré ; le rechargement a échoué.':state.programmes[0]?.id!==saved.programme.id?'Cette proposition existe déjà en version '+saved.programme.version+'. La dernière version reste affichée ; aucun historique n’a été remplacé.':'Programme enregistré comme proposition. Aucune affectation ou exécution.');}catch(e){status(messages[e.message]||'Enregistrement non confirmé : '+e.message);}finally{busy=false;document.querySelectorAll('main input,main textarea,main select,main button').forEach(node=>node.disabled=false);}
});
if(OM.getToken()){
  OM.loadBranding().catch(()=>{});
  OM.api('/api/missions').then(data=>{data.missions.forEach(m=>{const option=el('option',m.name||m.mission_code);option.value=m.id;$('mission-select').appendChild(option);});
    const id=new URLSearchParams(location.search).get('mission_id');if(id&&data.missions.some(m=>m.id===id))$('mission-select').value=id;return load();
  }).catch(e=>status('Missions indisponibles : '+e.message));
}
