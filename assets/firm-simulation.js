(function(){
 'use strict';
 var OM=window.OfficeManager;if(!OM||!OM.isOwner())return;
 var anchor=document.getElementById('area');if(!anchor)return;
 function el(tag,text){var n=document.createElement(tag);if(text!=null)n.textContent=text;return n;}
 var panel=el('section');panel.className='card';panel.id='firm-simulation';
 panel.appendChild(el('h2','Cabinet virtuel — 15 personnes, 24 mois'));
 panel.appendChild(el('p','Deux parcours séparés : référence gratuite pour vérifier le moteur ; IA pour mesurer les réponses des agents. Le score porte sur des contrôles structurels, pas sur la qualité complète d’un audit. Les personnages suivent des règles de scénario ; ce premier module ne teste pas encore les services métier de production.'));
 var controls=el('div');controls.className='links';panel.appendChild(controls);
 var status=el('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');panel.appendChild(status);
 var results=el('div');panel.appendChild(results);anchor.insertAdjacentElement('beforebegin',panel);
 var busy=false,buttons=[],data;
 var mode=document.createElement('select');mode.setAttribute('aria-label','Parcours de simulation');[['reference','Référence gratuite'],['ai','Agents IA (appels au fournisseur)']].forEach(x=>{var o=el('option',x[1]);o.value=x[0];mode.appendChild(o);});controls.appendChild(mode);var budget=document.createElement('input');budget.type='number';budget.min='1';budget.max='1000';budget.value='24';budget.setAttribute('aria-label','Plafond total des appels IA de la campagne');controls.appendChild(budget);mode.onchange=()=>load().catch(e=>status.textContent=e.message);
 function button(label,fn){var b=el('button',label);b.type='button';b.className='btn ghost';b.onclick=fn;controls.appendChild(b);buttons.push(b);return b;}
 async function load(){var r=await OM.api('/api/app?route=shadow&firm=1&mode='+mode.value);data=r.campaign;render();}
 async function act(action,extra){if(busy)return;busy=true;mode.disabled=true;buttons.forEach(b=>b.disabled=true);status.textContent='Exécution…';try{await OM.api('/api/app?route=shadow',{method:'POST',body:JSON.stringify(Object.assign({action:action,mode:mode.value},extra||{}))});await load();return true;}catch(e){status.textContent='Action interrompue : '+e.message+' — la progression déjà enregistrée est conservée.';return false;}finally{busy=false;mode.disabled=false;buttons.forEach(b=>b.disabled=false);}}
 var reportLink=el('a','Voir les résultats de référence déjà calculés');reportLink.href='/cabinet-simulation-resultats.html';panel.appendChild(reportLink);
 var diskHelp=el('p','Recette locale séparée : fichiers versionnés sur disque, contrôles de population et test des services de procédure. Les deux années métier des agents ne sont pas validées. ');
 var diskLink=el('a','Instructions de lancement et limites');diskLink.href='/docs/FIRM_SIMULATION_DISK.md';diskHelp.appendChild(diskLink);panel.appendChild(diskHelp);
 var create=button('Créer le cabinet',()=>act('firm-create',{seed:1,max_calls:Number(budget.value)}));
 button('Démarrer / reprendre',()=>act('firm-start'));
 button('Pause',()=>act('firm-pause'));
 button('Référence : avancer de 100 événements',()=>act('firm-reference',{limit:100}));
 button('IA : exécuter une étape',()=>act('firm-ai-step'));
 button('IA : exécuter jusqu’à 10 étapes',async()=>{for(var i=0;i<10;i++){var ok=await act('firm-ai-step');if(!ok)break;if(!data||data.status!=='running'||data.last_error)break;}});
 button('Corriger une tentative bloquée',()=>{var note=window.prompt('Correction à transmettre à l’agent (simulation uniquement) :');if(note)act('firm-correct',{note:note});});
 button('Actualiser',()=>load().catch(e=>status.textContent=e.message));
 button('Télécharger les résultats',()=>{if(!data)return;var u=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));var a=el('a');a.href=u;a.download='cabinet-15-resultats.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);});
 function render(){results.textContent='';create.hidden=!!data;if(!data){status.textContent='Aucune campagne. Créez le cabinet pour commencer.';return;}
 status.textContent=data.virtual_date+' · '+data.status+' · '+data.summary.months_elapsed+'/24 mois · '+data.summary.proposals+' productions simulées · '+data.budget.calls+'/'+data.budget.max_calls+' appels IA réservés/consommés';
 if(data.blocker)results.appendChild(el('p','Blocage : '+data.blocker));if(data.last_error)results.appendChild(el('p','Dernière erreur : '+data.last_error));
 results.appendChild(el('p','Référence : '+data.results.reference_events+' événements. IA : '+data.results.ai_events+' événements. Score structurel IA : '+(data.evaluation.structural_ai_score==null?'non mesuré':data.evaluation.structural_ai_score+' %')+'. Qualité de jugement : non évaluée.'));
 results.appendChild(el('p','Missions clôturées en simulation : '+data.summary.closed+' ; refusées : '+data.summary.refused+' ; propositions perdues : '+data.summary.lost+'.'));
 if(data.next_event)results.appendChild(el('p','Prochaine étape : '+data.next_event.mission_id+' — '+data.next_event.title+' ('+data.next_event.agent+').'));
 var team=el('details');team.appendChild(el('summary','Les 15 collaborateurs fictifs'));data.staff.forEach(x=>team.appendChild(el('p',x.name+' · '+x.role)));results.appendChild(team);
 var table=el('table'),head=el('tr');['Mission','Étape','État','Productions'].forEach(x=>head.appendChild(el('th',x)));table.appendChild(head);
 data.missions.forEach(m=>{var r=el('tr');[m.name,String(m.stage)+'/13',m.outcome||m.state,String(m.artifacts.length)].forEach(x=>r.appendChild(el('td',x)));table.appendChild(r);});results.appendChild(table);
 var logs=el('details');logs.appendChild(el('summary','Derniers résultats et échanges fictifs'));data.events.slice(-20).reverse().forEach(x=>{var a=el('article');a.appendChild(el('h3',x.mission_id+' — '+x.stage+' · '+x.mode));a.appendChild(el('p',x.summary));a.appendChild(el('p',x.feedback));(x.messages||[]).forEach(m=>a.appendChild(el('p',m.to+' : '+m.text)));(x.human_replies||[]).forEach(m=>a.appendChild(el('p',m.from+' (personnage simulé) : '+m.text)));logs.appendChild(a);});results.appendChild(logs);
 var lessons=el('details');lessons.appendChild(el('summary','Leçons proposées, non appliquées à la production'));data.lessons.forEach(l=>lessons.appendChild(el('p',l.id+' : '+l.text)));results.appendChild(lessons);
 }
 load().catch(e=>status.textContent='Chargement impossible : '+e.message);
(function () {
  'use strict';
  var OM = window.OfficeManager;
  var host = document.getElementById('firm-simulation-host');
  if (!host || !OM || !OM.isOwner()) return;
  host.textContent = '';
  function el(tag, text, className) {
    var n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (className) n.className = className;
    return n;
  }
  var panel = el('section', null, 'card');
  panel.id = 'firm-simulation';
  panel.appendChild(el('h2', 'Cabinet virtuel — 15 personnes, 24 mois'));
  panel.appendChild(el('p', 'Créez le cabinet, faites travailler les agents, puis examinez les résultats. La progression est conservée entre vos visites.'));
  var steps = el('div', null, 'training-steps');
  ['1. Créer le cabinet', '2. Exécuter les agents', '3. Revoir les résultats'].forEach(function (s) { steps.appendChild(el('span', s)); });
  panel.appendChild(steps);
  var modeLabel = el('p', 'Parcours actif : Agents IA', 'training-mode');
  panel.appendChild(modeLabel);
  var help = el('p', 'Les étapes IA appellent le fournisseur configuré et peuvent être facturées. Aucun appel IA ne part à la simple ouverture de cette page.', 'small');
  panel.appendChild(help);
  var config = el('div', null, 'training-settings');
  var budgetLabel = el('label', 'Plafond d’appels IA pour cette campagne');
  budgetLabel.htmlFor = 'firm-call-budget';
  var budget = el('input');
  budget.id = 'firm-call-budget'; budget.type = 'number'; budget.min = '1'; budget.max = '1000'; budget.value = '24';
  config.appendChild(budgetLabel); config.appendChild(budget);
  config.appendChild(el('p', '24 appels permettent un premier essai, pas les deux années complètes. Le plafond est fixé à la création.', 'small'));
  panel.appendChild(config);
  var toolbar = el('div', null, 'training-toolbar'); panel.appendChild(toolbar);
  var status = el('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); panel.appendChild(status);
  var results = el('div'); panel.appendChild(results);
  var advanced = el('details', null, 'training-settings');
  advanced.appendChild(el('summary', 'Options avancées et vérification du simulateur'));
  var modeHelp = el('p', 'Le parcours de référence déroule un scénario programmé sans faire travailler votre IA. Ses résultats sont séparés de vos résultats IA.');
  advanced.appendChild(modeHelp);
  var modeLabelInput = el('label', 'Choisir le parcours'); modeLabelInput.htmlFor = 'firm-run-mode'; advanced.appendChild(modeLabelInput);
  var mode = el('select'); mode.id = 'firm-run-mode';
  [['ai', 'Agents IA — entraînement'], ['reference', 'Référence — vérification sans appel IA']].forEach(function (pair) { var o = el('option', pair[1]); o.value = pair[0]; mode.appendChild(o); });
  mode.value = 'ai'; advanced.appendChild(mode);
  var reportLink = el('a', 'Consulter le rapport de référence déjà calculé');
  reportLink.href = '/cabinet-simulation-resultats.html'; reportLink.style.display = 'block'; advanced.appendChild(reportLink);
  var advancedControls = el('div', null, 'training-toolbar'); advanced.appendChild(advancedControls);
  panel.appendChild(advanced);
  var limits = el('details'); limits.appendChild(el('summary', 'Ce que mesure cet entraînement'));
  limits.appendChild(el('p', 'Dans cette première version, les personnages suivent des scénarios programmés et les travaux sont enregistrés sous forme de données structurées. Le score contrôle les actions et les sources présentes ; il ne certifie pas le jugement d’audit. Les leçons restent proposées, sans modification automatique des agents en production.', 'small'));
  panel.appendChild(limits); host.appendChild(panel);
  var data = null, busy = false, buttons = [];
  var errors = {
    NO_AI_PROVIDER_CONFIGURED: 'Aucun fournisseur IA disponible. Vérifiez la connexion IA dans Paramètres.',
    START_CAMPAIGN_FIRST: 'Démarrez la campagne avant d’exécuter une étape.',
    SIMULATION_CALL_BUDGET_REACHED: 'Le plafond d’appels de cette campagne est atteint.',
    THREE_FAILED_ATTEMPTS: 'Trois tentatives sont incomplètes. Ajoutez une correction dans les options avancées.',
    STEP_ALREADY_RUNNING: 'Une étape est déjà en cours. Actualisez après sa fin.',
    USER_SESSION_REQUIRED: 'Connectez-vous avec votre compte personnel.',
    UNAUTHORIZED: 'Votre session a expiré. Reconnectez-vous.',
    PARTNERS_ONLY: 'Le pilotage est réservé au propriétaire et aux associés.',
    NO_CORRECTION_PENDING: 'Aucune tentative à corriger pour le moment.',
    RESOLVE_SIMULATION_BLOCKER: 'Ajoutez une correction dans les options avancées avant de reprendre.'
  };
  var states = { running: 'En cours', paused: 'En pause', completed: 'Terminée', blocked: 'Bloquée', pending: 'À démarrer', waiting_correction: 'Correction attendue' };
  function message(e) { return errors[e.message] || e.message; }
  function button(where, label, fn, primary) {
    var b = el('button', label, primary ? 'btn' : 'btn ghost'); b.type = 'button'; b.onclick = fn; where.appendChild(b); buttons.push(b); return b;
  }
  async function load() {
    var r = await OM.api('/api/app?route=shadow&firm=1&mode=' + mode.value);
    data = r.campaign; render();
  }
  function lock(value) {
    busy = value; mode.disabled = value; budget.disabled = value || !!data;
    buttons.forEach(function (b) { b.disabled = value; });
    if (!value) availability();
  }
  async function post(action, extra) {
    return OM.api('/api/app?route=shadow', {method: 'POST', body: JSON.stringify(Object.assign({action: action, mode: mode.value}, extra || {}))});
  }
  async function run(fn) {
    if (busy) return; lock(true); status.textContent = 'Exécution…';
    try { await fn(); await load(); }
    catch (e) { status.textContent = message(e) + ' La progression déjà enregistrée est conservée.'; }
    finally { lock(false); }
  }
  var primary = button(toolbar, 'Créer le cabinet', function () {
    run(async function () {
      if (!data) { await post('firm-create', {seed: 1, max_calls: Number(budget.value)}); return; }
      if (mode.value === 'reference') { await post('firm-reference', {limit: 100}); return; }
      if (data.status !== 'running') await post('firm-start');
      await post('firm-ai-step');
    });
  }, true);
  var pause = button(toolbar, 'Mettre en pause', function () { run(function () { return post('firm-pause'); }); });
  var refresh = button(toolbar, 'Actualiser', function () { run(async function () {}); });
  var download = button(toolbar, 'Télécharger mes résultats IA', function () {
    if (!data) return;
    var url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'}));
    var a = el('a'); a.href = url; a.download = mode.value === 'ai' ? 'cabinet-resultats-IA.json' : 'cabinet-resultats-REFERENCE.json'; a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });
  var batch = button(advancedControls, 'Exécuter jusqu’à 10 étapes IA', function () {
    run(async function () {
      if (!data || mode.value !== 'ai') return;
      if (data.status !== 'running') await post('firm-start');
      for (var i = 0; i < 10; i++) {
        await post('firm-ai-step'); await load();
        if (!data || data.status !== 'running' || data.last_error) break;
      }
    });
  });
  var correctionLabel = el('label', 'Correction à transmettre à l’agent'); correctionLabel.htmlFor = 'firm-correction';
  advanced.appendChild(correctionLabel);
  var note = el('textarea'); note.id = 'firm-correction'; note.rows = 3; note.maxLength = 1500; note.placeholder = 'Expliquez ce que l’agent doit reprendre…'; advanced.appendChild(note);
  var correct = button(advancedControls, 'Enregistrer la correction', function () {
    if (!note.value.trim()) { status.textContent = 'Écrivez d’abord une correction.'; return; }
    run(async function () { await post('firm-correct', {note: note.value.trim()}); note.value = ''; });
  });
  function availability() {
    primary.hidden = !!data && data.status === 'completed';
    primary.disabled = busy || (!!data && data.status === 'blocked') || (!!data && data.budget.calls >= data.budget.max_calls && mode.value === 'ai');
    pause.hidden = !data || data.status !== 'running';
    download.hidden = !data;
    batch.hidden = mode.value !== 'ai' || !data || data.status === 'completed';
    batch.disabled = busy || (!!data && (data.status === 'blocked' || data.budget.calls >= data.budget.max_calls));
    correct.disabled = busy || !data;
    config.hidden = !!data || mode.value !== 'ai';
  }
  function render() {
    var ai = mode.value === 'ai';
    modeLabel.textContent = ai ? 'Parcours actif : Agents IA' : 'Parcours actif : Référence — votre IA ne travaille pas';
    help.textContent = ai ? 'Les étapes IA appellent le fournisseur configuré et peuvent être facturées. Aucun appel IA ne part à la simple ouverture de cette page.' : 'Ce parcours gratuit vérifie le moteur avec un scénario programmé. Il ne mesure pas les performances de votre IA.';
    download.textContent = ai ? 'Télécharger mes résultats IA' : 'Télécharger les résultats de référence';
    primary.textContent = !data ? 'Créer le cabinet' : ai ? 'Exécuter une étape IA' : 'Avancer de 100 événements de référence';
    results.textContent = '';
    if (!data) {
      status.textContent = ai ? 'Commencez par créer votre cabinet virtuel. Vos résultats IA apparaîtront ici.' : 'Aucune campagne de référence créée.';
      availability(); return;
    }
    status.textContent = data.virtual_date + ' · ' + (states[data.status] || data.status);
    var title = el('h3', ai ? 'Mes résultats IA' : 'Résultats de référence'); results.appendChild(title);
    var metrics = el('div', null, 'training-metrics');
    [[ai ? 'Étapes IA exécutées' : 'Événements de référence', ai ? data.results.ai_events : data.results.reference_events],
      ['Mois virtuels écoulés', data.summary.months_elapsed + ' / 24'],
      ['Travaux produits', data.summary.proposals]].forEach(function (pair) {
        var p = el('p'); p.appendChild(el('strong', String(pair[1]))); p.appendChild(el('span', ' — ' + pair[0])); metrics.appendChild(p);
      }); results.appendChild(metrics);
    if (ai) {
      results.appendChild(el('p', 'Appels réservés ou consommés : ' + data.budget.calls + ' / ' + data.budget.max_calls + '. Score des contrôles : ' + (data.evaluation.structural_ai_score == null ? 'pas encore mesuré' : data.evaluation.structural_ai_score + ' %') + '. Qualité du jugement : non évaluée.', 'small'));
      if (!data.results.ai_events) results.appendChild(el('p', 'Aucun résultat IA pour le moment. Cliquez sur « Exécuter une étape IA ».'));
    }
    if (data.blocker) results.appendChild(el('p', errors[data.blocker] || data.blocker, 'status error'));
    if (data.last_error) results.appendChild(el('p', 'Dernière erreur : ' + message({message: data.last_error}), 'status error'));
    if (data.next_event) results.appendChild(el('p', 'Prochaine étape : ' + data.next_event.title + ' · ' + data.next_event.mission_id + ' · ' + data.next_event.agent));
    var logs = el('details'); logs.open = data.events.length > 0; logs.appendChild(el('summary', 'Derniers travaux et échanges'));
    data.events.slice(-10).reverse().forEach(function (x) {
      var a = el('article', null, 'training-log'); a.appendChild(el('h4', x.mission_id + ' — ' + x.stage));
      a.appendChild(el('p', x.summary)); a.appendChild(el('p', x.feedback, 'small'));
      (x.messages || []).forEach(function (m) { a.appendChild(el('p', m.to + ' : ' + m.text)); });
      (x.human_replies || []).forEach(function (m) { a.appendChild(el('p', m.from + ' (personnage fictif) : ' + m.text)); });
      logs.appendChild(a);
    }); results.appendChild(logs);
    var missions = el('details'); missions.appendChild(el('summary', 'Voir les missions et leur avancement'));
    var wrap = el('div', null, 'training-table'), table = el('table'), head = el('tr');
    ['Mission', 'Étape', 'État', 'Travaux'].forEach(function (t) { var th = el('th', t); th.scope = 'col'; head.appendChild(th); }); table.appendChild(head);
    var outcomes = {simulated_closed: 'Clôturée en simulation', refused: 'Refusée', lost: 'Proposition perdue'};
    data.missions.forEach(function (m) { var tr = el('tr'); [m.name, m.stage + ' / 13', outcomes[m.outcome] || states[m.state] || m.state, m.artifacts.length].forEach(function (t) { tr.appendChild(el('td', String(t))); }); table.appendChild(tr); });
    wrap.appendChild(table); missions.appendChild(wrap); results.appendChild(missions);
    var team = el('details'); team.appendChild(el('summary', 'Voir les 15 collaborateurs fictifs'));
    data.staff.forEach(function (x) { team.appendChild(el('p', x.name + ' · ' + x.role)); }); results.appendChild(team);
    var lessons = el('details'); lessons.appendChild(el('summary', 'Leçons proposées : ' + data.lessons.length));
    data.lessons.forEach(function (x) { lessons.appendChild(el('p', x.text)); }); results.appendChild(lessons);
    availability();
  }
  mode.onchange = function () { if (busy) return; data = null; run(async function () {}); };
  run(async function () {});
})();
