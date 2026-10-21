/* global OfficeManager */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let state, revision;
  const el = (tag,text) => { const n = document.createElement(tag); n.textContent=text; return n; };
  const api = body => OfficeManager.api('/api/app?route=specialist-registry',body ? {method:'POST',body:JSON.stringify(body)} : undefined);
  async function run(fn) { try { $('specialist-status').textContent='Traitement…'; await fn(); await load(); $('specialist-status').textContent='État actualisé.'; } catch(e) { $('specialist-status').textContent=e.message; } }
  function button(host,label,fn) { const b=el('button',label); b.type='button'; b.className='btn ghost'; b.onclick=()=>run(fn); host.append(b); }
  function edit(s) { revision=s.revision; $('specialist-key').value=s.specialist_key; $('specialist-name').value=s.name; $('specialist-adapter').value=s.adapter_type; $('specialist-capabilities').value=s.capabilities.join(', '); $('specialist-enabled').checked=s.enabled; $('specialist-approval').checked=s.requires_human_approval; $('specialist-form').scrollIntoView(); }
  async function load() {
    state=await api(); $('specialist-list').replaceChildren(); $('specialist-calls').replaceChildren();
    for (const s of state.specialists) {
      const host=el('article',''); host.append(el('h3',s.name),el('p',s.specialist_key+' · '+s.adapter_type+' · '+(s.enabled?'Activé':'Désactivé')+' · Approbation : '+(s.requires_human_approval?'oui':'non')));
      const score=state.scores.find(x=>x.specialist_id===s.id); host.append(el('p','Appels mesurés : '+score.sample_size+' · Succès : '+(score.performance===null?'non mesuré':Math.round(score.performance*100)+' %')+' · Confiance déclarée : '+(score.confidence===null?'non mesurée':score.confidence)));
      button(host,'Modifier',()=>edit(s)); button(host,s.enabled?'Désactiver':'Activer',()=>api({...s,action:'save',enabled:!s.enabled}));
      for (const agent of state.agents) {
        const label=el('label',' '+agent+' '),check=document.createElement('input'); check.type='checkbox';check.checked=state.permissions.some(p=>p.specialist_id===s.id&&p.agent_key===agent&&p.allowed);check.onchange=()=>run(()=>api({action:'permission',specialist_key:s.specialist_key,agent_key:agent,allowed:check.checked}));label.prepend(check);host.append(label);
      }
      button(host,'Simuler un appel de Shadow',async()=>{const r=await api({action:'test',specialist_key:s.specialist_key}); $('specialist-result').textContent=r.status==='pending_approval'?'Appel enregistré : approbation humaine requise.':JSON.stringify(r,null,2);}); $('specialist-list').append(host);
    }
    for (const c of state.calls) {
      const row=el('article','');row.append(el('p',c.created_at+' · '+c.agent_key+' · '+c.capability+' · '+c.status+(c.error_code?' · '+c.error_code:'')));
      if(c.status==='pending_approval' && ['owner','partner','manager'].includes(OfficeManager.getRole())) { button(row,'Approuver l’appel',()=>api({action:'decide',call_id:c.id,decision:'approve'}));button(row,'Refuser',()=>api({action:'decide',call_id:c.id,decision:'reject'})); }
      if(c.status==='approved') button(row,'Exécuter le test approuvé',async()=>{const s=state.specialists.find(x=>x.id===c.specialist_id);if(!s)throw new Error('SPECIALIST_NOT_FOUND');$('specialist-result').textContent=JSON.stringify(await api({action:'test',specialist_key:s.specialist_key,call_id:c.id}),null,2);});
      $('specialist-calls').append(row);
    }
  }
  $('specialist-key').oninput=()=>{revision=undefined;};
  $('specialist-form').onsubmit=e=>{e.preventDefault();run(()=>api({action:'save',specialist_key:$('specialist-key').value,name:$('specialist-name').value,adapter_type:$('specialist-adapter').value,capabilities:$('specialist-capabilities').value.split(',').map(x=>x.trim()).filter(Boolean),enabled:$('specialist-enabled').checked,requires_human_approval:$('specialist-approval').checked,revision}));};
  load().catch(e => { $('specialist-status').textContent=e.message; });
})();
