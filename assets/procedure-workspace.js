(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var view, book, cell = null, history = [], sequence = 0, readingScope = null;
  function node(tag, value) { var n = document.createElement(tag); if (value != null) n.textContent = value; return n; }
  // A list shown as visible choices (Paul, 2026-10-25: on his screen the open list of a <select> showed nothing readable). The <select>
  // stays, hidden, as the value holder: the existing code keeps reading select.value and its onchange still runs.
  function choices(select, title) {
    var box = node('div'); box.className = 'wf-choices'; box.setAttribute('role', 'radiogroup'); box.setAttribute('aria-label', title);
    select.style.display = 'none';
    function draw() {
      box.textContent = ''; box.appendChild(node('p', title)).className = 'wf-choices-title';
      var opts = [].slice.call(select.options).filter(function (o) { return o.value !== ''; });
      if (!opts.length) { var e = node('p', select.options[0] ? select.options[0].text : '—'); e.className = 'meta'; box.appendChild(e); return; }
      opts.forEach(function (o) {
        var b = node('button', o.text); b.type = 'button'; b.className = 'wf-choice' + (select.value === o.value ? ' on' : ''); b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(select.value === o.value));
        b.disabled = select.disabled;
        b.onclick = function () { select.value = o.value; select.dispatchEvent(new Event('change')); draw(); };
        box.appendChild(b);
      });
    }
    select.addEventListener('change', draw);
    new MutationObserver(draw).observe(select, { childList: true, attributes: true, attributeFilter: ['disabled'] });
    draw(); return box;
  }
  function post(body) {
    function run(signal){return window.OfficeManager.api('/api/app?route=procedure', { method: 'POST', signal:signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ mission_id: view.mission_id, code: view.line.code }, body)) });}
    return body.action==='step-plan'?window.OfficeManager.readingRequest(run,function(seconds){$('audit-message').textContent='Lecture en cours · '+seconds+' s pour ce passage. La progression précédente est conservée.';}):run();
  }
  function error(e) {
    return ({ SOURCE_SHEET_REQUIRED:'Choisissez explicitement la feuille contenant les données client.',SOURCE_TYPE_MISMATCH:'Ce tableau est un budget, pas un GL (ou inversement). Choisissez le document adapté à la destination.',PROPOSAL_CONFIRMATION_REQUIRED:'Des valeurs sont proposées avec leurs sources. Confirmez-les dans les étapes du test avant de les écrire dans Excel.',CYCLE_ALREADY_IN_REVIEW:'Une procédure du cycle est déjà soumise ou revue. Le modèle ne peut pas être remplacé dans cet état.',SOURCE_CSV_INVALID:'Le CSV contient un champ entre guillemets incomplet. Corrigez le fichier source.',SOURCE_AMOUNT_INVALID:'Un montant de la source n’est pas interprétable. Vérifiez la colonne choisie.',SOURCE_FORMULA_WITHOUT_VALUE:'Une formule source n’a pas de valeur calculée enregistrée. Recalculez et enregistrez le fichier source dans Excel.',SOURCE_TABLE_LIMIT_REACHED:'Le fichier dépasse la capacité de cet import ; aucune lecture complète n’est annoncée.',TABLE_CAPACITY_OR_OCCUPIED_CELL:'Le modèle ne dispose pas de suffisamment de cellules d’entrée vides. Aucune ligne n’a été importée.',COLUMN_MAPPING_REQUIRED:'Vérifiez les correspondances de colonnes avant l’import.',DATA_SHEET_REQUIRED:'Choisissez la feuille de données du modèle : GL, budget, fonds reçus ou avances.',NO_WRITABLE_TABLE:'Aucun tableau d’entrée vide n’a été identifié dans cette feuille.',HUMAN_CONFIRMATION_REQUIRED:'Confirmez ou corrigez le remplissage précédent avant de poursuivre.',TEMPLATE_CHANGED:'Le modèle a changé : examinez-le à nouveau.',MANAGER_TEMPLATE_REQUIRED:'Le rattachement du modèle est réservé au responsable autorisé.',DOCUMENT_OCR_RETRY_REQUIRED:'La transcription de cette page n’a pas abouti. Reprenez pour réessayer cette page.', READING_REQUEST_TIMEOUT:'Ce passage dépasse le délai de réponse.', AGENTS_NOT_AUTHORIZED: 'L’utilisation des agents doit être autorisée dans les paramètres du cabinet.',
      NO_WORKPAPER_FOR_CYCLE: 'Le fichier de travail de ce cycle n’est pas encore préparé.',
      PROCEDURE_SHEET_NOT_FOUND: 'La feuille de cette procédure est introuvable dans le fichier.',
      WORKBOOK_TOO_LARGE: 'Ce classeur dépasse la taille prise en charge par cette vue.' })[e.message] || e.message || 'Service indisponible.';
  }
  function bubble(role, value) {
    var p = node('div', (role === 'user' ? 'Vous\n' : 'Enhanced Auditor\n') + value);
    p.className = 'audit-bubble ' + role; $('audit-conversation').appendChild(p);
    p.scrollIntoView({ block: 'nearest' });
  }
  function brief(r) {
    var host = $('audit-brief'); host.textContent = ''; host.hidden = false;
    var b = r.brief || {};
    function section(title, lines) {
      host.appendChild(node('h3', title));
      (lines.length ? Array.from(new Set(lines)) : ['Aucun élément documenté à ce stade.']).forEach(function (s) { host.appendChild(node('p', s)); });
    }
    window.OfficeManager.renderWorkpaperDialogue(host,b.dialogue||[],post);
    if(b.mission && b.mission.period_label)section('Période de la mission',[b.mission.period_label]);
    section('Ce que j’ai reçu', (b.population ? ['Population : ' + b.population] : []).concat((b.received || []).map(function (e) { return (e.sample_id ? e.sample_id + ' : ' : '') + (e.name || e.file_id) + (e.reading ? ' · ' + e.reading : ''); })));
    if(b.coverage)section('Couverture de lecture',[(b.coverage.scope==='selected_document'?'Document sélectionné : ':'Documents rattachés à la mission : ')+b.coverage.documents+' document(s) · '+b.coverage.pages_analysed+' / '+b.coverage.pages+' page(s) analysée(s) · '+(b.coverage.exhaustive?'toutes les pages ont été traitées':'lecture incomplète : voir les passages signalés')]);
    if(b.observed_total>50)host.appendChild(node('p','50 faits affichés sur '+b.observed_total+'. Le relevé complet est conservé.'));
    section('Ce que j’ai vu', (b.observed || []).map(function (o) { return (o.sample_id ? o.sample_id + ' : ' : '') + o.observation + (o.source ? '\nSource : ' + o.source : '') + (o.quote ? '\n« ' + o.quote + ' »' : ''); }));
    if(b.report_plan_id && b.observed_total>50){
      var more=node('button','Afficher les faits suivants'),offset=50;
      more.type='button';more.addEventListener('click',async function(){more.disabled=true;try{var page=await post({action:'reading-report',plan_id:b.report_plan_id,offset:offset});page.findings.forEach(function(f){host.insertBefore(node('p',f.fact+'\nSource : '+f.source+' — '+f.reference+'\n« '+f.quote+' »'),more);});offset+=page.findings.length;more.hidden=offset>=page.findings_total;}catch(e){$('audit-message').textContent=error(e);}more.disabled=false;});host.appendChild(more);
    }
    if (r.assessment) section('Mon avis provisoire', [r.assessment]);
    var names = { 'prepare-sop-step': 'Lire les pièces selon le SOP', 'write-sop-preparation': 'Inscrire la préparation sourcée dans Excel', 'prepare-observations': 'Préparer les observations', 'add-note': 'Ajouter votre précision', 'write-workpaper': 'Écrire dans Excel', 'draw-sample': 'Tirer l’échantillon' };
    section('Ce que j’ai fait', (r.outcomes || []).map(function (o) {
      var label = names[o.action] || o.action;
      return label + (o.sample_id ? ' · ' + o.sample_id : '') + ' : ' +
        ({ done: 'réalisé', unchanged: 'travail existant conservé', blocked: 'non réalisé — ' + o.reason, 'needs-review': 'écriture à vérifier' }[o.status] || o.status) +
        (o.sheet ? ' · feuille « ' + o.sheet + ' »' : '') +
        (o.excel_written === false ? ' · préparation seulement, Excel non modifié' : '') +
        (o.cells != null ? ' · ' + o.cells + ' cellule(s) traitée(s)' : '') +
        ((o.conflicts || []).length ? ' · conflits : ' + o.conflicts.join(', ') : '');
    }));
    section('Pour avancer', (b.missing || []).concat((b.observed || []).flatMap(function (o) { return (o.missing || []).map(function (s) { return (o.sample_id ? o.sample_id + ' : ' : '') + s; }); })).concat(r.next ? [r.next] : []));
  }
  function column(n) { var s = ''; for (; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; }
  function render(data) {
    book = data; cell = null; $('audit-selection').textContent = 'Sélectionnez une cellule pour en parler avec l’agent.';
    var select = $('audit-sheet'); select.textContent = '';
    data.sheets.forEach(function (s) { var o = node('option', s); o.value = s; select.appendChild(o); }); select.value = data.sheet;
    var grid = $('audit-grid'); grid.textContent = '';
    var table = node('table'), head = node('thead'), line = node('tr'); line.appendChild(node('th', ''));
    for (var c = 1; c <= data.columns; c++) line.appendChild(node('th', column(c)));
    head.appendChild(line); table.appendChild(head); var body = node('tbody');
    data.rows.forEach(function (r) {
      var tr = node('tr'); tr.appendChild(node('th', r.number));
      r.cells.forEach(function (v) {
        var td = node('td'), b = node('button', (v.formula ? 'ƒ ' : '') + v.value);
        b.type = 'button'; b.setAttribute('aria-label', v.address + ' : ' + (v.formula && !v.value ? 'Formule sans résultat enregistré' : v.value || 'vide'));
        if (v.input) td.className = 'input';
        b.addEventListener('click', function () {
          grid.querySelectorAll('.selected').forEach(function (n) { n.classList.remove('selected'); }); td.classList.add('selected');
          cell = v.address; $('audit-selection').textContent = data.sheet + ' ! ' + cell + ' — ' + (v.value || (v.formula ? 'Formule sans résultat enregistré' : 'vide'));
        });
        td.appendChild(b); tr.appendChild(td);
      }); body.appendChild(tr);
    }); table.appendChild(body); grid.appendChild(table);
    $('audit-file-status').textContent = data.name + ' · lignes ' + data.start_row + '–' + data.end_row + ' sur ' + data.total_rows +
      (data.modified_at ? ' · version du ' + new Date(data.modified_at).toLocaleString('fr-FR') : '') + (data.columns === 40 ? ' · 40 premières colonnes' : '');
    $('audit-prev').disabled = data.start_row <= 1; $('audit-more').disabled = data.end_row >= data.total_rows;
  }
  function refresh(sheet, start) {
    var request = ++sequence;
    $('audit-file-status').textContent = 'Lecture du fichier enregistré…';
    // An old grid must not be presented as the current file when the reload fails.
    $('audit-grid').textContent = ''; cell = null;
    return post({ action: 'workbook-view', sheet: sheet || view.line.code, start_row: start || 1 })
      .then(function (r) { if (request === sequence) render(r); })
      .catch(function (e) { if (request === sequence) { book = null; $('audit-file-status').textContent = error(e); } });
  }
  async function completeSopReading(outcome) {
    var plan=outcome.pending_sop;
    while(plan.pending){
      $('audit-message').textContent='Lecture des pièces : '+plan.read+' / '+plan.total+(plan.current_document?' · '+plan.current_document:'')+(plan.total_pages?' · '+(plan.pages_read||[]).length+' page(s) lue(s) sur '+plan.total_pages:'')+'…';
      try{plan=await post({action:'step-plan',step:plan.step.n,operation:'document-review',incremental:true,read_job:plan.read_job});}
      catch(e){$('audit-message').textContent=error(e)+' La progression est conservée. ';var resume=node('button','Reprendre la lecture');resume.type='button';resume.onclick=function(){resume.disabled=true;completeSopReading(Object.assign({},outcome,{pending_sop:plan})).catch(function(err){$('audit-message').textContent=error(err);});};$('audit-message').appendChild(resume);return;}
    }
    var receipt=null;
    if(outcome.write_requested && plan.ready && !(plan.findings||[]).some(function(f){return f.target&&f.value;}))receipt=await post({action:'step-run',plan:{operation:'document-review',plan_id:plan.plan_id}});
    bubble('assistant',(plan.coverage?((plan.coverage.scope==='selected_document'?'Document sélectionné':'Documents rattachés à la mission')+' : '+plan.coverage.documents+' document(s), '+plan.coverage.pages_analysed+' / '+plan.coverage.pages+' page(s) analysée(s). '+(plan.exhaustive?'Toutes les pages ont été traitées.':'Lecture incomplète : voir les passages signalés.')+'\n'):'')+(plan.understood||'Préparation terminée.')+'\n'+(plan.findings||[]).map(function(f){return f.fact+(f.value?'\nValeur proposée à confirmer : '+f.value:'')+'\nSource : '+f.source+' — « '+f.quote+' »';}).join('\n\n')+'\n'+(receipt && receipt.verified?'Préparation inscrite et vérifiée dans Excel, feuille '+receipt.sheet+'.':'Préparation uniquement ; aucune écriture Excel. Confirmez les valeurs proposées dans les étapes du test avant de les inscrire.')+'\n'+(plan.questions||[]).join('\n'));
    brief(await post({action:'workspace-brief'}));
    window.dispatchEvent(new Event('workpaper-dialogue-updated'));
    if(receipt){refresh(receipt.sheet,1);}
    $('audit-message').textContent='';
  }
  $('audit-ask').addEventListener('submit', function (e) {
    e.preventDefault(); if (!view || $('audit-send').disabled) return;
    var message = $('audit-question').value.trim(); if (!message) return;
    bubble('user', message); $('audit-send').disabled = true; $('audit-message').textContent = 'L’agent examine le contexte de la procédure…';
    var scope=readingScope;readingScope=null;
    post({ action: 'ask-procedure', reading_scope:scope, message: message, history: history, cell: cell, sheet: book && book.sheet })
      .then(function (r) {
        bubble('assistant', r.answer); history.push({ role: 'user', text: message }, { role: 'assistant', text: r.answer }); history = history.slice(-8);
        if (r.brief) brief(r);
        if (r.work) window.dispatchEvent(new CustomEvent('procedure-assistant-updated', { detail: r }));
        if ((r.outcomes || []).length) refresh(book && book.sheet, book && book.start_row);
        if ($('audit-question').value.trim() === message) $('audit-question').value = '';
        $('audit-message').textContent = '';
        var pending=(r.outcomes||[]).find(function(o){return o.pending_sop;});if(pending)return completeSopReading(pending);
      }).catch(function (err) { $('audit-message').textContent = error(err); })
      .then(function () { $('audit-send').disabled = false; });
  });
  $('audit-next').addEventListener('click', function () {
    $('audit-question').value = 'Fais le point sur ce test : son objectif, les informations documentées, celles qui manquent, les questions à poser et la prochaine action à réaliser dans la procédure.';
    $('audit-ask').requestSubmit();
  });
  $('audit-continue').addEventListener('click', function () {
    readingScope='mission';
    $('audit-question').value = 'Continue selon le SOP : lis tous les documents rattachés à cette mission et toutes leurs pages, en utilisant la période déjà enregistrée. Prépare les observations sourcées, conserve les saisies existantes et écris la préparation dans Excel. Signale précisément les passages illisibles ; ne conclus pas le test.';
    $('audit-ask').requestSubmit();
  });
  $('audit-explain').addEventListener('click', function () {
    $('audit-question').value = 'Je ne comprends pas. Explique simplement le travail en cours, pourquoi on le fait, ce que tu as constaté et ce que tu me demandes. Ne modifie rien.';
    $('audit-ask').requestSubmit();
  });
  $('audit-write').addEventListener('click', function () { $('wp-write').click(); });
  var importButton=node('button','Importer les données client dans cette feuille');importButton.type='button';importButton.className='btn ghost';$('audit-refresh').parentNode.appendChild(importButton);
  importButton.onclick=async function(){
    if(!book)return;importButton.disabled=true;var prev=document.querySelector('.wf-import-panel');if(prev)prev.remove();var host=node('section');host.className='wf-import-panel';host.setAttribute('aria-label','Import des données client');importButton.parentNode.appendChild(host);
    try{var steps=await post({action:'steps'}),options=await post({action:'table-import-options',sheet:book.sheet}),sources=options.files;
      if(!sources.length){host.appendChild(node('p','Déposez le GL, le budget ou le tableau client dans les pièces de la mission, puis choisissez sa feuille de destination dans Excel.'));return;}
      var source=node('select'),step=node('select');source.setAttribute('aria-label','Fichier de données client');step.setAttribute('aria-label','Étape SOP de cet import');source.appendChild(new Option('Choisissez la source à confirmer',''));sources.forEach(function(s){var option=new Option(s.name+(s.recommended?' — GL/budget proposé pour cette destination':s.incompatible?' — autre type de données':''),s.file_id);source.appendChild(option);});steps.steps.forEach(function(s){step.appendChild(new Option(s.n+'. '+s.text,s.n));});host.appendChild(node('p','Destination : '+book.sheet+'. Les valeurs client seront conservées et les formules du modèle préservées.'));host.appendChild(source);var sourceSheet=node('select');sourceSheet.setAttribute('aria-label','Feuille du fichier source');sourceSheet.appendChild(new Option('Choisissez d’abord le fichier source',''));host.appendChild(sourceSheet);host.appendChild(step);[[source,'1. La pièce à importer (proposée par l’agent en premier)'],[sourceSheet,'2. La feuille de cette pièce'],[step,'3. L’étape du SOP qui demande cet import']].forEach(function(x){host.insertBefore(choices(x[0],x[1]),x[0]);});
      var preview=node('button','Examiner les colonnes et les lignes'),result=node('div');preview.type='button';preview.className='btn ghost';host.appendChild(preview);host.appendChild(result);step.onchange=function(){result.textContent='';};source.onchange=async function(){result.textContent='';sourceSheet.textContent='';sourceSheet.appendChild(new Option('Choisissez la feuille source',''));if(!source.value)return;preview.disabled=true;source.disabled=true;try{var info=await post({action:'table-import-options',sheet:book.sheet,source_file_id:source.value});info.sheets.forEach(function(s){sourceSheet.appendChild(new Option(s.name+' — '+s.role,s.name));});if(info.sheets.length===1){sourceSheet.value=info.sheets[0].name;sourceSheet.dispatchEvent(new Event('change'));}}catch(e){result.textContent=error(e);}finally{preview.disabled=false;source.disabled=false;}};sourceSheet.onchange=function(){result.textContent='';};var rec=sources.filter(function(x){return x.recommended;});if(rec.length===1){source.value=rec[0].file_id;source.dispatchEvent(new Event('change'));}var words=String(book.sheet||'').toLowerCase().split(/[^a-z0-9]+/).filter(function(w){return w.length>1;});var best=null,score=0;steps.steps.forEach(function(x){var t=String(x.text||'').toLowerCase(),n=words.filter(function(w){return t.indexOf(w)>=0;}).length+(/import|extrai|grand livre|budget|gl\b/.test(t)?1:0);if(n>score){score=n;best=x;}});if(best){step.value=String(best.n);step.dispatchEvent(new Event('change'));}
      preview.onclick=async function(){preview.disabled=true;source.disabled=true;sourceSheet.disabled=true;step.disabled=true;result.textContent='Lecture des données…';try{var request={source_file_id:source.value,source_sheet:sourceSheet.value,sheet:book.sheet,step:Number(step.value)},p=await post(Object.assign({action:'preview-table-import'},request));result.textContent='';result.appendChild(node('p',p.rows+' lignes à importer dans '+p.target_sheet+' à partir de la ligne '+p.start_row+'. Vérifiez la correspondance de chaque colonne.'));
        (p.totals||[]).forEach(function(t){result.appendChild(node('p','Total source — '+t.label+' : '+t.total.toLocaleString('fr-FR')));});if(p.gl_summary)result.appendChild(node('p','Lecture du GL : '+p.rows+' lignes ; débits '+p.gl_summary.debit.toLocaleString('fr-FR')+' ; crédits '+p.gl_summary.credit.toLocaleString('fr-FR')+' ; différence '+p.gl_summary.difference.toLocaleString('fr-FR')+'. Ces totaux restent à rapprocher des états de référence.'));var choices=[];p.columns.forEach(function(c){var label=node('label',c.label+' ← '),select=node('select');select.setAttribute('aria-label','Colonne source pour '+c.label);select.appendChild(new Option('Ne pas importer cette colonne',''));p.source_headers.forEach(function(h,i){select.appendChild(new Option(h,i));});if(c.suggested_source!=null)select.value=String(c.suggested_source);choices.push({column:c.column,select:select});label.appendChild(select);result.appendChild(label);result.appendChild(node('br'));});
        result.appendChild(node('pre',JSON.stringify(p.first_rows,null,2)));var go=node('button','Je confirme cette source et les colonnes : remplir Excel');go.type='button';go.className='btn';result.appendChild(go);go.onclick=async function(){go.disabled=true;preview.disabled=true;source.disabled=true;step.disabled=true;try{var mapping=choices.filter(function(c){return c.select.value!=='';}).map(function(c){return {column:c.column,source:Number(c.select.value)};});var r=await post(Object.assign({action:'run-table-import',revision:p.revision,mapping:mapping},request));bubble('assistant','J’ai importé '+r.rows+' lignes et renseigné '+r.cells+' cellules dans '+r.sheet+'. Les valeurs enregistrées ont été relues. Vérifions ensemble ce remplissage dans le compte rendu.');window.dispatchEvent(new Event('workpaper-dialogue-updated'));refresh(r.sheet,1);result.textContent='Import vérifié. Le compte rendu attend votre confirmation.';}catch(e){result.appendChild(node('p',error(e)));go.disabled=false;preview.disabled=false;source.disabled=false;sourceSheet.disabled=false;step.disabled=false;}};
      }catch(e){result.textContent=error(e);}preview.disabled=false;source.disabled=false;sourceSheet.disabled=false;step.disabled=false;};
    }catch(e){host.appendChild(node('p',error(e)));}finally{importButton.disabled=false;}
  };
  var modelButton=node('button','Choisir le modèle Excel du cabinet');modelButton.type='button';modelButton.className='btn ghost';$('audit-refresh').parentNode.appendChild(modelButton);
  modelButton.onclick=async function(){
    modelButton.disabled=true;var host=node('section');host.setAttribute('aria-label','Modèle du working file');modelButton.parentNode.appendChild(host);
    try{var options=await post({action:'template-options'});if(!options.candidates.length){host.appendChild(node('p',options.question||'Aucun modèle accessible dans le dossier de modèles enregistré.'));return;}
      var select=node('select');select.setAttribute('aria-label','Modèle Excel du cabinet');select.appendChild(new Option('Choisissez le modèle à examiner',''));options.candidates.forEach(function(c){select.appendChild(new Option(c.name,c.file_id));});host.appendChild(select);
      var info=node('p'),go=node('button','Créer une copie de ce modèle et la rattacher au cycle');go.type='button';go.className='btn';go.disabled=true;host.appendChild(info);host.appendChild(node('p','Le fichier actuel est conservé. Ses saisies ne sont pas transférées automatiquement. Le nouveau fichier servira à toutes les procédures de ce cycle.'));host.appendChild(go);var chosen=null;
      select.onchange=async function(){go.disabled=true;chosen=null;if(!select.value)return;select.disabled=true;info.textContent='Vérification du contenu du modèle…';try{chosen=await post({action:'inspect-template',template_id:select.value});info.textContent=chosen.name+' — feuilles : '+chosen.sheets.map(function(s){return s.name;}).join(', ');go.disabled=false;}catch(e){info.textContent=error(e);}select.disabled=false;};
      go.onclick=async function(){go.disabled=true;select.disabled=true;try{await post({action:'adopt-template',template_id:chosen.file_id,template_version:chosen.version});location.reload();}catch(e){info.textContent=error(e);go.disabled=false;select.disabled=false;}};
    }catch(e){host.appendChild(node('p',error(e)));}finally{modelButton.disabled=false;}
  };
  $('audit-refresh').addEventListener('click', function () { refresh(book && book.sheet, book && book.start_row); post({action:'workspace-brief'}).then(brief).catch(function(e){$('audit-message').textContent=error(e);}); });
  $('audit-sheet').addEventListener('change', function () { refresh(this.value, 1); });
  $('audit-prev').addEventListener('click', function () { if (book) refresh(book.sheet, Math.max(1, book.start_row - 100)); });
  $('audit-more').addEventListener('click', function () { if (book) refresh(book.sheet, book.end_row + 1); });
  window.addEventListener('procedure-ready', function (e) {
    view = e.detail; $('procedure-workspace').hidden = false;
    $('audit-context').textContent = view.line.code + ' — ' + view.line.title + ' · préparateur : ' + (view.preparer || 'à affecter');
    $('audit-write').disabled = view.editable === false || ['submitted', 'reviewed'].includes(view.work.status) || !view.workpaper;
    post({action:'workspace-brief'}).then(brief).catch(function(e){ $('audit-message').textContent=error(e); });
    refresh();
  });
  window.addEventListener('workpaper-dialogue-updated',function(){post({action:'workspace-brief'}).then(brief).catch(function(e){$('audit-message').textContent=error(e);});refresh(book&&book.sheet,book&&book.start_row);});
  window.addEventListener('procedure-written', function () { refresh(book && book.sheet, book && book.start_row); });
  window.addEventListener('procedure-updated', function (e) {
    view = e.detail;
    $('audit-write').disabled = view.editable === false || ['submitted', 'reviewed'].includes(view.work.status) || !view.workpaper;
  });
})();
