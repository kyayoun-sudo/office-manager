// « Ce que l'IA a retenu » (2026-11-01) : les décisions, corrections et annulations des personnes, et ce que l'IA a appris en ligne.
// Chaque ligne se confirme, se corrige ou se retire (la ligne est fermée, jamais supprimée). Tout se décide côté serveur (lib/ai-memory.js).
(function () {
  var OM = window.OfficeManager;
  var host = document.getElementById('sec-ai-memory');
  var missionId = new URLSearchParams(location.search).get('id');
  if (!OM || !host || !missionId) return;
  function el(tag, text, cls) { var n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }
  var ERR = { MANAGER_OR_PARTNER_ONLY: 'Seuls un manager ou un associé proposent une connaissance au cabinet.', CONFIRM_BEFORE_PROPOSING: 'Confirmez d’abord cette ligne.',
    ONLY_GENERAL_WEB_KNOWLEDGE_CAN_BE_PROPOSED: 'Seule une connaissance générale trouvée en ligne peut être proposée au cabinet.', ALREADY_PROPOSED: 'Déjà proposée au cabinet.',
    MEMORY_ITEM_CLOSED: 'Cette ligne est déjà retirée.', TEXT_REQUIRED: 'Écrivez la correction (5 caractères au moins).' };
  var ORIGIN = { web: 'Trouvé en ligne', personne: 'Décidé par une personne', agent: 'Noté par l’agent' };
  var say = el('p', null, 'note'); say.setAttribute('role', 'status'); say.setAttribute('aria-live', 'polite');
  var body = el('div', null, 'stack');
  host.appendChild(body); host.appendChild(say);
  function msg(e) { return ERR[e.code || e.message] || ('Impossible : ' + (e.message || e)); }
  function act(payload) {
    say.textContent = 'En cours…';
    return OM.api('/api/app?route=ai-memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ mission_id: missionId }, payload)) })
      .then(function () { say.textContent = 'Enregistré.'; load(); }).catch(function (e) { say.textContent = msg(e); });
  }
  function button(label, fn) { var b = el('button', label, 'btn ghost'); b.type = 'button'; b.onclick = fn; return b; }
  function line(it) {
    var box = el('div', null, 'note');
    box.appendChild(el('strong', (ORIGIN[it.origin] || 'Noté') + (it.about ? ' · ' + it.about : '') + (it.confirm === 'to_confirm' ? ' · à confirmer' : '')));
    box.appendChild(el('p', it.text));
    (it.sources || []).forEach(function (s) { var a = el('a', s.title || s.url); a.href = s.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; box.appendChild(a); box.appendChild(el('br')); });
    box.appendChild(el('small', (it.by ? it.by + ' · ' : '') + (it.at ? new Date(it.at).toLocaleString('fr-FR') : '') + (it.promoted ? ' · proposée au cabinet' : '')));
    if (it.status === 'closed') { box.appendChild(el('p', 'Retirée' + (it.closed_why ? ' — ' + it.closed_why : ''), 'meta')); return box; }
    var row = el('div');
    if (it.confirm === 'to_confirm') row.appendChild(button('Confirmer', function () { act({ op: 'confirm', id: it.id }); }));
    var input = el('input'); input.type = 'text'; input.hidden = true; input.value = it.text; input.setAttribute('aria-label', 'Texte corrigé');
    var fix = button('Corriger', function () { if (input.hidden) { input.hidden = false; input.focus(); fix.textContent = 'Enregistrer la correction'; return; } act({ op: 'correct', id: it.id, text: input.value }); });
    row.appendChild(fix); row.appendChild(input);
    row.appendChild(button('Retirer', function () { var why = window.prompt('Pourquoi retirer cette ligne ? (facultatif)') || ''; act({ op: 'retire', id: it.id, why: why }); }));
    if (it.origin === 'web' && it.confirm === 'confirmed' && !it.promoted && OM.isManager && OM.isManager()) row.appendChild(button('Proposer au cabinet', function () { act({ op: 'propose', id: it.id }); }));
    box.appendChild(row);
    return box;
  }
  function draw(v) {
    body.textContent = '';
    var items = v.items || [];
    if (!items.length) { body.appendChild(el('p', 'Rien pour l’instant. Les décisions, corrections et connaissances trouvées en ligne apparaîtront ici.', 'meta')); return; }
    items.forEach(function (it) { body.appendChild(line(it)); });
  }
  function load() {
    OM.api('/api/app?route=ai-memory&mission_id=' + encodeURIComponent(missionId)).then(draw).catch(function (e) { say.textContent = msg(e); });
  }
  load();
})();
