(function () {
  'use strict';

  var qs = new URLSearchParams(location.search);
  var missionId = qs.get('mission_id') || '';
  var code = qs.get('code') || '';
  var workspace = document.getElementById('procedure-workspace');
  var dialogue = workspace && workspace.querySelector('.audit-dialogue');
  if (!missionId || !code || !workspace || !dialogue || !window.OfficeManager) return;

  var state = { view: null, current: null, plan: null, busy: false };
  var board = document.createElement('section');
  board.className = 'wf-agent-board';
  board.setAttribute('aria-label', 'Travail autonome de l’Enhanced Auditor');
  board.innerHTML = '' +
    '<div class="wf-agent-head">' +
      '<div><h2>Travail de l’agent</h2><p class="meta" id="wf-agent-context">Working File · ' + esc(code) + '</p></div>' +
      '<span class="wf-agent-status" id="wf-agent-status" data-state="working">Analyse</span>' +
    '</div>' +
    '<div id="wf-agent-progress" class="wf-agent-progress" aria-label="Étapes du Working File"></div>' +
    '<div id="wf-agent-step" class="wf-agent-step"><strong>Lecture du Working File…</strong><p>L’agent identifie la prochaine étape et les sources de cette mission.</p></div>' +
    '<div id="wf-agent-body" class="wf-agent-body"></div>' +
    '<div id="wf-agent-actions" class="wf-agent-actions"></div>' +
    '<p id="wf-agent-message" class="status" role="status" aria-live="polite"></p>';
  dialogue.insertBefore(board, dialogue.firstChild);

  var separator = document.createElement('div');
  separator.className = 'wf-agent-chat-separator';
  separator.textContent = 'Chat facultatif';
  var chatTitle = dialogue.querySelector('#h-dialogue');
  if (chatTitle) dialogue.insertBefore(separator, chatTitle);

  var $ = function (id) { return document.getElementById(id); };

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function apiError(e) {
    var raw = String((e && (e.message || e.error || e.code)) || e || 'Erreur');
    var known = {
      PROPOSAL_CONFIRMATION_REQUIRED: 'Une validation humaine est nécessaire avant l’écriture.',
      HUMAN_CONFIRMATION_REQUIRED: 'Une autre validation humaine est déjà en attente dans ce Working File.',
      SOP_CHANGED_PREPARE_AGAIN: 'Le SOP a changé. L’agent doit préparer à nouveau cette étape.',
      WORK_CHANGED_PREPARE_AGAIN: 'Le Working File a changé. L’agent doit relire la version actuelle.',
      DOCUMENT_SOURCE_CHANGED: 'Une pièce source a changé. L’agent doit la relire avant de continuer.',
      PLAN_INCOMPLETE: 'Il manque une information pour exécuter cette étape.',
      NO_WORKPAPER_FOR_CYCLE: 'Aucun Working File n’est associé à ce cycle.',
      AGENTS_NOT_AUTHORIZED: 'Les agents ne sont pas autorisés pour ce cabinet.'
    };
    for (var k in known) if (raw.indexOf(k) >= 0) return known[k];
    return raw;
  }

  function setStatus(label, kind) {
    var n = $('wf-agent-status');
    n.textContent = label;
    n.dataset.state = kind || 'working';
  }

  function message(text) { $('wf-agent-message').textContent = text || ''; }

  function post(body, longRead) {
    function run(signal) {
      return window.OfficeManager.api('/api/app?route=procedure', {
        method: 'POST',
        signal: signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ mission_id: missionId, code: code }, body))
      });
    }
    if (longRead && window.OfficeManager.readingRequest) {
      return window.OfficeManager.readingRequest(run, function (seconds) {
        message('L’agent lit les pièces de la mission · ' + seconds + ' s.');
      });
    }
    return run();
  }

  function completedSteps(view) {
    var done = {};
    (view.runs || []).forEach(function (r) {
      if (r && r.stale) return;
      var m = String(r.step || '').match(/^\s*(\d+)/);
      if (m) done[Number(m[1])] = true;
    });
    return done;
  }

  function currentStep(view) {
    var done = completedSteps(view);
    var steps = view.steps || [];
    for (var i = 0; i < steps.length; i++) if (!done[steps[i].n]) return steps[i];
    return steps[steps.length - 1] || null;
  }

  function renderProgress() {
    var box = $('wf-agent-progress');
    box.textContent = '';
    if (!state.view) return;
    var done = completedSteps(state.view);
    (state.view.steps || []).forEach(function (step) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = done[step.n] ? '✓ ' + step.n : String(step.n);
      if (done[step.n]) b.className = 'done';
      if (state.current && state.current.n === step.n) b.setAttribute('aria-current', 'step');
      b.title = step.text || ('Étape ' + step.n);
      b.addEventListener('click', function () {
        state.current = step;
        state.plan = null;
        renderStep();
        prepare(step, false);
      });
      box.appendChild(b);
    });
  }

  function renderStep() {
    var step = state.current;
    var steps = (state.view && state.view.steps) || [];
    var index = step ? steps.findIndex(function (x) { return x.n === step.n; }) + 1 : 0;
    $('wf-agent-step').innerHTML = step
      ? '<strong>Étape ' + esc(step.n) + (steps.length ? ' / ' + steps.length : '') + '</strong><p>' + esc(step.text) + '</p>'
      : '<strong>Aucune étape détectée</strong><p>Le SOP ou le Working File ne fournit pas d’étape exploitable.</p>';
    $('wf-agent-body').textContent = '';
    $('wf-agent-actions').textContent = '';
    if (index) setStatus('Analyse de l’étape', 'working');
    renderProgress();
  }

  function addAction(label, fn, primary) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn' + (primary ? '' : ' ghost');
    b.textContent = label;
    b.disabled = state.busy;
    b.addEventListener('click', fn);
    $('wf-agent-actions').appendChild(b);
    return b;
  }

  function block(title, html, cls) {
    var section = document.createElement('section');
    section.className = 'wf-agent-block' + (cls ? ' ' + cls : '');
    section.innerHTML = '<h3>' + esc(title) + '</h3>' + html;
    $('wf-agent-body').appendChild(section);
    return section;
  }

  function scrollNeeds() {
    var target = document.getElementById('needs-card');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function focusChat() {
    var input = document.getElementById('audit-question');
    if (input) { input.focus(); input.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }

  function showFallback(plan) {
    var ops = (state.view && state.view.operations) || {};
    var sources = (state.view && state.view.sources) || [];
    var wrap = document.createElement('div');
    wrap.className = 'wf-agent-fallback';
    var op = document.createElement('select');
    op.setAttribute('aria-label', 'Opération de l’étape');
    op.innerHTML = '<option value="">Choisir le travail à réaliser</option>' + Object.keys(ops).map(function (k) {
      return '<option value="' + esc(k) + '"' + (plan && plan.operation === k ? ' selected' : '') + '>' + esc(ops[k]) + '</option>';
    }).join('');
    var src = document.createElement('select');
    src.setAttribute('aria-label', 'Fichier source');
    src.innerHTML = '<option value="">Choisir la source de cette mission</option>' + sources.map(function (s) {
      return '<option value="' + esc(s.file_id) + '"' + (plan && plan.source_file_id === s.file_id ? ' selected' : '') + '>' + esc(s.name || s.document || s.file_id) + '</option>';
    }).join('');
    var bal = document.createElement('select');
    bal.setAttribute('aria-label', 'Balance de rapprochement');
    bal.innerHTML = '<option value="">Balance / seconde source si nécessaire</option>' + sources.map(function (s) {
      return '<option value="' + esc(s.file_id) + '">' + esc(s.name || s.document || s.file_id) + '</option>';
    }).join('');
    wrap.appendChild(op); wrap.appendChild(src); wrap.appendChild(bal);
    var host = block('Information à préciser', '', '');
    host.appendChild(wrap);
    addAction('Continuer avec ces éléments', function () {
      prepare(state.current, true, { operation: op.value, source_file_id: src.value, balance_file_id: bal.value });
    }, true);
  }

  function renderFindings(plan) {
    var findings = plan.findings || [];
    if (!findings.length) return;
    var shown = findings.slice(0, 12).map(function (f) {
      var target = f.target ? '<div><code>' + esc(f.target) + '</code></div>' : '';
      var ref = [f.source, f.reference].filter(Boolean).join(' · ');
      return '<div class="wf-agent-finding"><strong>' + esc(f.value || f.fact || 'Fait identifié') + '</strong>' + target +
        (ref ? '<div class="wf-agent-source">' + esc(ref) + '</div>' : '') +
        (f.quote ? '<div class="wf-agent-source">« ' + esc(f.quote) + ' »</div>' : '') + '</div>';
    }).join('');
    block('Faits sourcés trouvés' + (plan.findings_total > findings.length ? ' · ' + plan.findings_total : ''), '<div class="wf-agent-findings">' + shown + '</div>');
  }

  function renderQuestions(plan) {
    var questions = plan.questions || [];
    if (!questions.length) return;
    block('Décision / information nécessaire', '<ul class="wf-agent-list">' + questions.slice(0, 10).map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('') + '</ul>');
  }

  function renderPlan(plan) {
    state.plan = plan;
    $('wf-agent-body').textContent = '';
    $('wf-agent-actions').textContent = '';
    message('');

    if (plan && plan.pending) {
      setStatus('Lecture des pièces', 'working');
      block('Lecture en cours', '<p>L’agent poursuit la lecture exhaustive des documents nécessaires à cette étape.</p>');
      addAction('Continuer la lecture', function () { prepare(state.current, false); }, true);
      return;
    }

    var label = plan.operation_label || (plan.operation === 'document-review' ? 'Lire les pièces et préparer les faits sourcés' : null);
    if (plan.understood || label) {
      block('Ce que l’agent va faire', (plan.understood ? '<p>' + esc(plan.understood) + '</p>' : '') + (label ? '<p class="wf-agent-source">' + esc(label) + '</p>' : ''));
    }
    if (plan.source_name || plan.balance_name || (plan.reading && plan.reading.length)) {
      var names = [];
      if (plan.source_name) names.push(plan.source_name);
      if (plan.balance_name) names.push(plan.balance_name);
      (plan.reading || []).forEach(function (x) { if (x.name && names.indexOf(x.name) < 0) names.push(x.name); });
      block('Sources de cette mission', '<ul class="wf-agent-list">' + names.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>');
    }

    renderFindings(plan);
    renderQuestions(plan);

    if (plan.unread && plan.unread.length) {
      block('Pièces non entièrement exploitables', '<ul class="wf-agent-list">' + plan.unread.slice(0, 10).map(function (x) {
        return '<li>' + esc(x.name || 'Document') + (x.reason ? ' — ' + esc(x.reason) : '') + '</li>';
      }).join('') + '</ul>');
    }

    if (plan.missing && plan.missing.length) {
      setStatus('Action requise', 'action');
      block('Il manque', '<p>' + esc(plan.missing.join(', ')) + '</p>');
      showFallback(plan);
      addAction('Voir / demander les pièces', scrollNeeds, false);
      return;
    }

    if (plan.operation === 'document-review') {
      var writes = (plan.findings || []).filter(function (f) { return f.target && f.value; });
      if (plan.ready) {
        if (writes.length) {
          setStatus('Validation auditeur', 'action');
          block('Avant écriture', '<p>' + writes.length + ' proposition(s) peuvent renseigner des cellules autorisées. Rien n’est écrit tant que vous ne validez pas.</p>');
          addAction('Valider et écrire les propositions', function () { runPlan(true); }, true);
          addAction('Ne pas écrire / corriger', focusChat, false);
        } else {
          setStatus('Prêt à enregistrer', 'action');
          block('Préparation prête', '<p>Les faits sourcés seront conservés dans le Working File sans remplacer une conclusion ou une signature humaine.</p>');
          addAction('Enregistrer cette préparation', function () { runPlan(false); }, true);
        }
      } else {
        setStatus((plan.questions || []).length ? 'Action requise' : 'Preuve manquante', 'blocked');
        addAction('Voir / demander les pièces', scrollNeeds, true);
        if ((plan.questions || []).length) addAction('Apporter une information', focusChat, false);
        addAction('Rechercher à nouveau', function () { prepare(state.current, false); }, false);
      }
      return;
    }

    if (plan.ready) {
      setStatus('Prêt à exécuter', 'action');
      block('Contrôle', '<p>L’opération est déterministe et s’exécutera sur les sources de cette mission. Le résultat sera tracé dans une feuille séparée du Working File.</p>');
      addAction('Exécuter cette étape', function () { runPlan(false); }, true);
      addAction('Changer les sources', function () { showFallback(plan); }, false);
      return;
    }

    setStatus('Action requise', 'action');
    showFallback(plan || {});
    addAction('Voir / demander les pièces', scrollNeeds, false);
  }

  async function prepare(step, explicit, overrides) {
    if (!step || state.busy) return;
    state.busy = true;
    state.current = step;
    renderProgress();
    setStatus('Recherche et lecture', 'working');
    message('L’agent prépare l’étape à partir du SOP, du Working File et des pièces de cette mission…');
    try {
      var body = Object.assign({ action: 'step-plan', step: step.n }, overrides || {});
      var plan = await post(body, true);
      renderPlan(plan || {});
      if (explicit) message('Préparation mise à jour.');
    } catch (e) {
      setStatus('Action requise', 'blocked');
      message(apiError(e));
      $('wf-agent-body').textContent = '';
      $('wf-agent-actions').textContent = '';
      addAction('Réessayer', function () { prepare(step, true, overrides); }, true);
      addAction('Voir / demander les pièces', scrollNeeds, false);
    } finally {
      state.busy = false;
    }
  }

  async function runPlan(confirm) {
    if (!state.plan || state.busy) return;
    state.busy = true;
    setStatus('Exécution', 'working');
    message('L’agent exécute l’étape et vérifie le Working File enregistré…');
    try {
      var plan = state.plan;
      var payload;
      if (plan.operation === 'document-review') {
        payload = { operation: 'document-review', plan_id: plan.plan_id, confirm_proposals: confirm === true };
      } else {
        payload = plan;
      }
      var result = await post({ action: 'step-run', plan: payload }, false);
      $('wf-agent-body').textContent = '';
      $('wf-agent-actions').textContent = '';
      setStatus(result && result.verified === false ? 'À vérifier' : 'Étape exécutée', result && result.verified === false ? 'action' : 'done');
      var html = '<p>' + (result && result.verified === false ? 'Le résultat a été produit mais sa persistance doit être vérifiée.' : 'Le résultat a été écrit puis relu dans le Working File.') + '</p>';
      if (result && result.sheet) html += '<p><strong>Feuille :</strong> ' + esc(result.sheet) + '</p>';
      if (result && result.count != null) html += '<p><strong>Éléments :</strong> ' + esc(result.count) + '</p>';
      if (result && result.totals) html += '<p><strong>Totaux :</strong> ' + esc(JSON.stringify(result.totals)) + '</p>';
      if (result && result.analysis && result.analysis.text) html += '<p>' + esc(result.analysis.text) + '</p>';
      block('Résultat', html, 'wf-agent-result');
      addAction('Actualiser le Working File', function () {
        var b = document.getElementById('audit-refresh');
        if (b) b.click();
      }, true);
      addAction('Passer à la suite', function () { load(true); }, false);
      await refreshStepsOnly();
    } catch (e) {
      setStatus('Action requise', 'blocked');
      message(apiError(e));
      $('wf-agent-actions').textContent = '';
      addAction('Réessayer', function () { runPlan(confirm); }, true);
      addAction('Apporter une information', focusChat, false);
    } finally {
      state.busy = false;
    }
  }

  async function refreshStepsOnly() {
    try {
      state.view = await post({ action: 'steps' }, false);
      renderProgress();
    } catch (_) {}
  }

  function autoKey(step) { return 'wf-agent-prepared:' + missionId + ':' + code + ':' + (step ? step.n : 'none'); }

  async function load(forcePrepare) {
    if (state.busy) return;
    state.busy = true;
    setStatus('Analyse du Working File', 'working');
    message('');
    try {
      state.view = await post({ action: 'steps' }, false);
      state.current = currentStep(state.view);
      state.plan = null;
      renderStep();
      if (!state.current) {
        setStatus('Aucune étape', 'blocked');
        return;
      }
      var done = completedSteps(state.view);
      var allDone = (state.view.steps || []).length && (state.view.steps || []).every(function (s) { return done[s.n]; });
      if (allDone) {
        setStatus('Prêt pour revue', 'done');
        block('Travail', '<p>Toutes les étapes identifiées ont un résultat enregistré. L’auditeur peut maintenant revoir les travaux et les points ouverts.</p>');
        return;
      }
      var shouldPrepare = forcePrepare;
      try {
        if (!sessionStorage.getItem(autoKey(state.current))) {
          sessionStorage.setItem(autoKey(state.current), '1');
          shouldPrepare = true;
        }
      } catch (_) { shouldPrepare = true; }
      if (shouldPrepare) {
        state.busy = false;
        await prepare(state.current, false);
      } else {
        setStatus('Étape prête', 'action');
        addAction('Préparer cette étape', function () { prepare(state.current, true); }, true);
        addAction('Voir les pièces nécessaires', scrollNeeds, false);
      }
    } catch (e) {
      setStatus('Indisponible', 'blocked');
      message(apiError(e));
      $('wf-agent-actions').textContent = '';
      addAction('Réessayer', function () { load(true); }, true);
    } finally {
      state.busy = false;
    }
  }

  window.OfficeManager.workingFileAgent = {
    refresh: function () { return load(true); },
    prepareCurrent: function () { return prepare(state.current, true); },
    state: state
  };

  load(false);
})();
