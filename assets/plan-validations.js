(function () {
  var OM=window.OfficeManager, UI=window.OMScreens, el=UI.el;
  var $=function(id){return document.getElementById(id);};
  var labels={approve:'Approuvé',defer:'Reporté',reject:'Refusé'};
  var messages={PLAN_SUPERSEDED:'Une nouvelle version existe. Relisez-la avant de décider.',
    DECISION_CHANGED:'Une autre décision a été enregistrée. Rechargez la mission avant de décider.',
    PLAN_CONTENT_CHANGED:'Le contenu a changé. Rechargez la mission.',OWNER_ONLY:'Cette décision est réservée au propriétaire ou à un associé-gérant.',
    INVALID_PLAN_DECISION:'Vérifiez la décision et le commentaire.',PLAN_DECISIONS_UNAVAILABLE:'Le journal des plans est indisponible. Vérifiez sa configuration.'};
  var latest=null,busy=false,generation=0,pending=null;
  function status(text){$('status').textContent=text;}
  function render(data){
    latest=(data.plans||[])[0]||null;pending=null;
    $('review').hidden=!latest;$('history-section').hidden=!latest;
    $('reviewed').checked=false;$('note').value='';$('decision').value='approve';$('note').required=false;
    if(!latest){status('Aucun plan enregistré pour cette mission.');return;}
    $('plan-title').textContent=data.mission.name+' · Version '+latest.version;
    $('plan-status').textContent=(latest.last_decision?labels[latest.last_decision.decision]:'À valider')+' · enregistrée le '+UI.dateTime(latest.created_at);
    $('plan-content').textContent=latest.content;$('plan-phases').textContent='';
    latest.phases.forEach(function(p){$('plan-phases').appendChild(el('li',p));});
    $('decision-form').hidden=!OM.isOwner();$('owner-only').hidden=OM.isOwner();$('history').textContent='';
    data.plans.forEach(function(plan){
      var card=el('section',null,'item'),box=el('div',null,'t');
      box.appendChild(el('h3','Version '+plan.version+' · '+(plan.last_decision?labels[plan.last_decision.decision]:'À valider')));
      var detail=el('details');detail.appendChild(el('summary','Voir le contenu de cette version'));
      var phases=el('ol');plan.phases.forEach(function(p){phases.appendChild(el('li',p));});detail.appendChild(phases);
      var text=el('pre',plan.content);text.style.whiteSpace='pre-wrap';text.style.overflowWrap='anywhere';text.style.font='inherit';detail.appendChild(text);box.appendChild(detail);
      if(!plan.history.length)box.appendChild(el('p','Aucune décision.','meta'));
      plan.history.forEach(function(d){box.appendChild(el('p',labels[d.decision]+' · '+UI.dateTime(d.created_at)+' · accès propriétaire','meta'));if(d.note)box.appendChild(el('p',d.note));});
      if(plan.history_truncated)box.appendChild(el('p','Les 50 décisions les plus récentes sont affichées.','note'));
      card.appendChild(box);$('history').appendChild(card);
    });
    $('history-limit').textContent=data.truncated?'Les 20 versions les plus récentes sont affichées.':'';
    status('Version '+latest.version+' chargée. Aucune exécution automatique.');
  }
  function load(){
    var id=$('mission-select').value,stamp=++generation;
    latest=null;pending=null;$('review').hidden=true;$('history-section').hidden=true;$('dossier-link').hidden=!id;
    if(!id){status('Choisissez une mission.');return Promise.resolve(false);}
    $('dossier-link').href='/mission.html?id='+encodeURIComponent(id);status('Chargement du plan…');
    return OM.api('/api/app?route=plan-decisions&mission_id='+encodeURIComponent(id))
      .then(function(data){if(stamp===generation)render(data);return true;})
      .catch(function(e){if(stamp===generation)status(messages[e.message]||'Impossible de charger le plan : '+e.message);return false;});
  }
  $('mission-select').addEventListener('change',load);
  $('decision').addEventListener('change',function(){pending=null;$('note').required=$('decision').value==='reject';});
  $('note').addEventListener('input',function(){pending=null;});
  $('decision-form').addEventListener('submit',function(e){
    e.preventDefault();if(busy||!latest||!$('reviewed').checked)return;
    var choice=$('decision').value,note=$('note').value;
    if(choice==='reject'&&!note.trim()){status('Expliquez le refus dans le commentaire.');return;}
    if(!pending)pending={plan_id:latest.id,content_hash:latest.content_hash,decision:choice,note:note,expected_decision_id:latest.last_decision?latest.last_decision.id:null,request_id:crypto.randomUUID()};
    busy=true;$('save-decision').disabled=true;$('mission-select').disabled=true;$('decision').disabled=true;$('note').disabled=true;status('Enregistrement de la décision…');
    OM.api('/api/app?route=plan-decisions',{method:'POST',headers:{'Content-Type':'application/json','x-office-manager-owner-token':OM.getOwnerToken()},body:JSON.stringify(pending)})
      .then(function(){return load().then(function(ok){status(ok?'Décision enregistrée. Aucune affectation, aucun envoi, aucune exécution.':'Décision enregistrée. Le rechargement du journal a échoué.');});})
      .catch(function(e){status(messages[e.message]||'Enregistrement non confirmé. Réessayez : '+e.message);})
      .finally(function(){busy=false;$('save-decision').disabled=false;$('mission-select').disabled=false;$('decision').disabled=false;$('note').disabled=false;});
  });
  if(OM.getToken()){
    OM.loadBranding().catch(function(){});
    OM.api('/api/missions').then(function(data){data.missions.forEach(function(m){var o=el('option',m.name||m.mission_code);o.value=m.id;$('mission-select').appendChild(o);});
      var id=new URLSearchParams(location.search).get('mission_id');if(id&&data.missions.some(function(m){return m.id===id;}))$('mission-select').value=id;return load();
    }).catch(function(e){status('Impossible de charger les missions : '+e.message);});
  }
})();
