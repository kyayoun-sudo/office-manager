// L'écran construit depuis le working file (Paul, 2026-10-24 : « l'interface et le travail se mettent en place en fonction du
// working file »). Chaque feuille du fichier devient l'écran de ce qu'elle demande, d'après la carte lue par le code
// (route procedure, action workfile-map) : feuilles en pastilles dans l'ordre du guide, formulaire construit colonne par
// colonne (calculé = affiché, fait = à remplir, décision = Oui / Non / N/A, résultat = calculé par le fichier), pastilles
// d'action calculées sans IA, et la même feuille ouverte dans « Mon fichier Excel ». Ce qu'une personne saisit est écrit
// dans le fichier (action workfile-cells : cases vides du modèle seulement, relu, tracé). Rien d'autre n'est retiré.
(function () {
  'use strict';
  var OM = window.OfficeManager;
  var ROLE = { guide: 'Parcours', synthesis: 'Synthèse', programme: 'Programme', risks: 'Risques', lead: 'Lead', data: 'Données à déposer',
    reconciliation: 'Contrôles', test: 'Test', anomalies: 'Anomalies', pbc: 'Pièces', review: 'Revue', signoff: 'Signatures', agent: 'Préparation de l’agent', other: 'Feuille' };
  var COLROLE = { calc: 'calculé', result: 'résultat', fixed: 'du modèle', key: 'clé', fact: 'à remplir', free: 'à remplir', judgment: 'votre décision' };

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function $(id) { return document.getElementById(id); }

  function css() {
    if (document.querySelector('link[data-workfile-guide]')) return;
    var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/assets/workfile-guide.css'; l.dataset.workfileGuide = '1'; document.head.appendChild(l);
  }

  function mount(board, opts) {
    css();
    document.documentElement.dataset.workfileGuide = 'on'; // the agent panel then shows its proposals here, not twice
    var st = { map: null, view: null, filled: {}, editable: false, sheet: null, offset: 0, busy: false, say: '', proposals: {} };
    // (2026-10-24) What the agent proposes to write is shown in the sheet itself, before anything is written.
    document.addEventListener('wf-proposals', function (e) {
      st.proposals = {}; ((e.detail && e.detail.cells) || []).forEach(function (c) { st.proposals[c.sheet + '!' + c.address] = c; });
      var first = (e.detail && e.detail.cells || [])[0];
      if (first && first.sheet !== st.sheet) load(first.sheet, 0); else render();
    });
    document.addEventListener('wf-written', function () { st.proposals = {}; if (st.sheet) load(st.sheet, st.offset); });
    function proposal(addr) { return st.proposals[st.sheet + '!' + addr] || null; }
    function api(action, extra) {
      return OM.api('/api/app?route=procedure', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ mission_id: opts.missionId, code: opts.code, action: action }, extra || {})) });
    }
    function load(sheet, offset) {
      st.busy = true; render();
      return api('workfile-map', { sheet: sheet || null, offset: offset || 0 }).then(function (d) {
        st.map = d.summary; st.view = d.sheet_view; st.filled = d.filled || {}; st.editable = !!d.editable;
        st.sheet = d.sheet_view ? d.sheet_view.name : null; st.offset = offset || 0; st.test = d.procedure && d.procedure.test; st.file = d.file;
        st.busy = false; st.say = ''; render(); showInExcel(st.sheet); return true;
      }).catch(function (e) { st.busy = false; st.say = 'Lecture du fichier impossible : ' + (e && e.message || e); render(); throw e; });
    }

    function showInExcel(name) {
      var sel = $('audit-sheet'); if (!sel || !name) return;
      for (var i = 0; i < sel.options.length; i++) if (sel.options[i].value === name) { if (sel.value !== name) { sel.value = name; sel.dispatchEvent(new Event('change')); } return; }
    }
    function importButton() {
      var r = $('audit-refresh'); if (!r) return null;
      var bs = r.parentNode.querySelectorAll('button');
      for (var i = 0; i < bs.length; i++) if (/^Importer les données/.test(bs[i].textContent)) return bs[i];
      return null;
    }

    function sheetsInOrder() {
      var m = st.map; if (!m) return [];
      var byName = {}; (m.sheets || []).forEach(function (s) { byName[s.name] = s; });
      return (m.order || []).map(function (n) { return byName[n]; }).filter(Boolean);
    }

    function field(col, row, value) {
      var addr = col.col + row.row, v = value == null ? '' : value;
      if (['calc', 'result', 'fixed', 'key'].indexOf(col.role) >= 0) {
        var shown = value == null ? 'calculé dans Excel' : (v === '' ? '—' : v);
        return '<div class="wfg-f wfg-ro"><span class="wfg-h">' + esc(col.header) + ' <em>' + esc(COLROLE[col.role]) + '</em></span><span class="wfg-v' + (value == null ? ' wfg-calc' : '') + '">' + esc(shown) + '</span></div>';
      }
      var dis = st.editable ? '' : ' disabled', p = !v ? proposal(addr) : null;
      if (p) return '<div class="wfg-f wfg-prop"><span class="wfg-h">' + esc(col.header) + ' <em>proposé par l’agent</em></span><span class="wfg-v">' + esc(p.value) + '</span>' +
        (p.source || p.quote ? '<span class="wfg-src">' + esc(p.source || '') + (p.quote ? ' — « ' + esc(String(p.quote).slice(0, 160)) + ' »' : '') + '</span>' : '') + '</div>';
      if (col.role === 'judgment' && col.list && col.list.length) {
        return '<div class="wfg-f wfg-judg"><span class="wfg-h">' + esc(col.header) + ' <em>votre décision</em></span><div class="wfg-opts" role="group" aria-label="' + esc(col.header) + '">' +
          col.list.map(function (o) { return '<button type="button" class="wfg-opt" data-cell="' + esc(addr) + '" data-expected="' + esc(v) + '" data-value="' + esc(o) + '" aria-pressed="' + (o === v ? 'true' : 'false') + '"' + dis + '>' + esc(o) + '</button>'; }).join('') + '</div></div>';
      }
      return '<label class="wfg-f' + (col.role === 'judgment' ? ' wfg-judg' : ' wfg-fact') + '"><span class="wfg-h">' + esc(col.header) + ' <em>' + esc(COLROLE[col.role]) + '</em></span>' +
        '<input type="text" data-cell="' + esc(addr) + '" data-expected="' + esc(v) + '" value="' + esc(v) + '"' + dis + '></label>';
    }

    function testScreen(v) {
      var t = v.table, cols = t.columns.filter(function (c) { return c.role !== 'key'; }), key = t.columns.filter(function (c) { return c.role === 'key'; })[0];
      var rows = v.rows.filter(function (r) { return t.columns.some(function (c) { return (c.role === 'calc' || c.role === 'fact' || c.role === 'judgment') && r.cells[c.col] != null && r.cells[c.col] !== ''; }); });
      var noValues = !rows.length;
      if (noValues) rows = v.rows.slice(0, 3);
      var html = noValues ? '<p class="wfg-note">Aucune valeur calculée n’est encore enregistrée dans le fichier pour ces lignes (échantillon non tiré ou fichier non recalculé dans Excel). Le formulaire de ' + esc(v.name) + ' est prêt : ' + t.capacity + ' lignes.</p>' : '';
      html += rows.slice(0, 8).map(function (r) {
        var title = (key ? (r.cells[key.col] || r.row) : r.row);
        // Calculated columns whose value Excel has not saved yet: one line, not ten empty boxes.
        var ro = ['calc', 'result', 'fixed'];
        var pending = cols.filter(function (c) { return ro.indexOf(c.role) >= 0 && r.cells[c.col] == null; });
        var shownCols = cols.filter(function (c) { return pending.indexOf(c) < 0; });
        return '<article class="wfg-item" data-row="' + r.row + '"><h4>Élément ' + esc(title) + ' <span class="wfg-meta">ligne ' + r.row + '</span></h4>' +
          (pending.length ? '<p class="wfg-pending">Calculé par le fichier (valeur visible après recalcul dans Excel) : ' + esc(pending.map(function (c) { return c.header; }).join(' · ')) + '</p>' : '') +
          '<div class="wfg-grid">' + shownCols.map(function (c) { return field(c, r, r.cells[c.col]); }).join('') + '</div>' +
          (st.editable ? '<div class="wfg-row"><button type="button" class="btn" data-save="' + r.row + '">Enregistrer dans le fichier</button></div>' : '') + '</article>';
      }).join('');
      if (v.rows.length > 8 || v.offset) html += '<div class="wfg-row"><button type="button" class="btn ghost" data-page="' + Math.max(0, v.offset - 8) + '"' + (v.offset ? '' : ' disabled') + '>Éléments précédents</button><button type="button" class="btn ghost" data-page="' + (v.offset + 8) + '">Éléments suivants</button></div>';
      return html;
    }

    function tableScreen(v) {
      var t = v.table, last = -1;
      // (the table's last row is often its total line: it does not count as a used row)
      v.rows.forEach(function (r, i) { if (r.row < t.last_row && t.columns.some(function (c) { return ['fact', 'free', 'judgment'].indexOf(c.role) >= 0 && r.cells[c.col]; })) last = i; });
      // The rows already used, plus a few empty ones: not a wall of empty boxes.
      var show = v.rows.slice(0, v.role === 'data' ? 8 : Math.max(5, last + 4));
      var examples = (t.prefilled_rows || []).filter(function (r) { return r < t.first_row + 10; });
      return (examples.length && v.role === 'lead' ? '<p class="wfg-pending">Lignes ' + examples.join(', ') + ' : texte déjà mis par le modèle (exemples de rubriques). Remplacez-les par les comptes de la balance.</p>' : '') +
        '<div class="wfg-wrap"><table class="wfg-table"><thead><tr>' + t.columns.map(function (c) { return '<th scope="col">' + esc(c.header) + '<small>' + esc(COLROLE[c.role] || '') + '</small></th>'; }).join('') + '</tr></thead><tbody>' +
        show.map(function (r) {
          return '<tr data-row="' + r.row + '">' + t.columns.map(function (c) {
            var val = r.cells[c.col], editable = st.editable && v.role !== 'data' && ['fact', 'free', 'judgment'].indexOf(c.role) >= 0, pr = !val ? proposal(c.col + r.row) : null;
            if (pr) return '<td class="wfg-r-prop" title="' + esc((pr.source || '') + (pr.quote ? ' — ' + pr.quote : '')) + '">' + esc(pr.value) + '</td>';
            if (!editable) return '<td class="wfg-r-' + c.role + '">' + esc(val == null ? 'ƒ' : val) + '</td>';
            if (c.role === 'judgment' && c.list && c.list.length) return '<td class="wfg-r-judgment"><select data-cell="' + c.col + r.row + '" data-expected="' + esc(val || '') + '"><option value=""></option>' + c.list.map(function (o) { return '<option' + (o === val ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select></td>';
            return '<td class="wfg-r-' + c.role + '"><input type="text" data-cell="' + c.col + r.row + '" data-expected="' + esc(val || '') + '" value="' + esc(val || '') + '"></td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>' +
        (st.editable && v.role !== 'data' ? '<div class="wfg-row"><button type="button" class="btn" data-save="table">Enregistrer les modifications dans le fichier</button></div>' : '');
    }

    function chips(v) {
      var out = [], order = sheetsInOrder(), idx = order.map(function (s) { return s.name; }).indexOf(v.name), next = order[idx + 1];
      var t = v.table;
      if (v.role === 'test' && t) {
        (t.reads || []).forEach(function (n) { if (st.filled[n] === 0) out.push({ kind: 'Suite', label: 'D’abord : remplir ' + n + ' (cette feuille en dépend)', go: n }); });
        var tt = st.test && st.test.sheet === v.name ? st.test : null;
        if (tt && tt.pbc_required && tt.pbc_required.length) out.push({ kind: 'Pièce', label: 'Pièces du test : ' + tt.pbc_required.join(', ') + ' — déposer ou demander', scroll: 'needs-card' });
        var open = 0; v.rows.forEach(function (r) { t.columns.forEach(function (c) { if (c.role === 'judgment' && r.cells[c.col] === '' && r.cells[t.columns[1] && t.columns[1].col] != null && r.cells[t.columns[1].col] !== '') open++; }); });
        if (open) out.push({ kind: 'Décision', label: open + ' décision(s) à prendre dans ce test' });
      }
      if (v.role === 'lead') out.push({ kind: 'Pièce', label: 'La balance (pièce qui remplit les comptes) : déposer ou demander', scroll: 'needs-card' });
      if (v.role === 'data') {
        if (!v.filled) out.push({ kind: 'Proposition', label: 'Importer les données client dans ' + v.name, importer: true });
        out.push({ kind: 'Pièce', label: 'Déposer la pièce qui remplit cette feuille', scroll: 'needs-card' });
      }
      if (t && v.filled >= t.capacity && t.capacity > 0) out.push({ kind: 'Attention', label: 'Tableau plein (' + t.capacity + ' lignes) : il faudra l’agrandir' });
      if (next) out.push({ kind: 'Suite', label: 'Feuille suivante : ' + next.name, go: next.name });
      return out;
    }

    function screen() {
      var v = st.view; if (!v) return '<p class="wfg-note">Aucune feuille à afficher.</p>';
      var t = v.table, n = function (r) { return t ? t.columns.filter(function (c) { return r.indexOf(c.role) >= 0; }).length : 0; };
      var built = t ? 'Écran construit depuis la feuille : ' + t.columns.length + ' colonnes — ' + n(['calc', 'fixed', 'key']) + ' reprises ou calculées, ' + n(['fact', 'free']) + ' à remplir, ' + n(['judgment']) + ' décision(s), ' + n(['result']) + ' résultat(s) · ' + v.filled + ' / ' + t.capacity + ' lignes remplies.' : 'Feuille sans tableau de travail : consignes ci-dessous.';
      var html = '<div class="wfg-screen"><span class="wfg-kicker">' + esc(ROLE[v.role] || v.role) + ' · feuille ' + esc(v.name) + '</span><h3>' + esc(v.title || v.name) + '</h3>';
      var ins = (v.instructions || []).slice(0, 3);
      if (ins.length) html += '<p class="wfg-instr">« ' + esc(ins[0].text) + ' »</p>';
      if (ins.length > 1) html += '<details class="wfg-more"><summary>Consignes de la feuille</summary>' + ins.slice(1).map(function (i) { return '<p class="wfg-instr">« ' + esc(i.text) + ' »</p>'; }).join('') + '</details>';
      html += '<p class="wfg-built">' + esc(built) + '</p>';
      if (v.role === 'guide') html += '<ol class="wfg-order">' + sheetsInOrder().map(function (s) { return '<li><button type="button" class="wfg-link" data-go="' + esc(s.name) + '">' + esc(s.name) + '</button> <span class="wfg-meta">' + esc(ROLE[s.role] || s.role) + '</span></li>'; }).join('') + '</ol>';
      else if (t && v.role === 'test') html += testScreen(v);
      else if (t) html += tableScreen(v);
      html += '<div class="wfg-chips"><span class="wfg-meta">Ce que je vous propose maintenant</span><div>' + chips(v).map(function (c, i) {
        return '<button type="button" class="wfg-chip wfg-k-' + esc(c.kind.toLowerCase()) + '" data-chip="' + i + '"><b>' + esc(c.kind) + '</b> ' + esc(c.label) + '</button>';
      }).join('') + '</div></div>';
      var qs = (st.map.questions || []).filter(function (q) { return !q.sheet || q.sheet === v.name; });
      if (qs.length) html += '<div class="wfg-q"><b>Je ne peux pas le déduire du fichier :</b><ul>' + qs.map(function (q) { return '<li>' + esc(q.question) + '</li>'; }).join('') + '</ul></div>';
      return html + '</div>';
    }

    function render() {
      var m = st.map, sheets = sheetsInOrder();
      var tpl = m ? (m.template && m.template.id ? m.template.id + (m.template.version ? ' v' + m.template.version : '') + ' (AUDIT_META)' : 'modèle reconnu par sa forme') : '';
      board.innerHTML = '<div class="wf-agent-head"><div><h2>Le working file, feuille par feuille</h2><p class="meta">' + (m ? esc(tpl) + ' · lu par le code, sans IA' + (st.file && st.file.name ? ' · ' + esc(st.file.name) : '') : 'Lecture du fichier…') + '</p></div>' +
        '<span class="wf-agent-status" data-state="' + (st.busy ? 'working' : (m ? 'done' : 'blocked')) + '">' + (st.busy ? 'Lecture' : (m ? 'Fichier compris' : 'À relire')) + '</span></div>' +
        (sheets.length ? '<nav class="wfg-nav" aria-label="Feuilles du working file">' + sheets.map(function (s, i) {
          var done = (st.filled[s.name] || 0) > 0;
          return '<button type="button" class="wfg-sheet" data-go="' + esc(s.name) + '"' + (s.name === st.sheet ? ' aria-current="page"' : '') + '><span>' + (done ? '✓' : (i + 1)) + '</span>' + esc(s.name) + '<small>' + esc(ROLE[s.role] || s.role) + '</small></button>';
        }).join('') + ((m && m.agent_sheets || []).length ? '<span class="wfg-sep">Préparations de l’agent</span>' + m.agent_sheets.map(function (n) {
          return '<button type="button" class="wfg-sheet wfg-agent" data-go="' + esc(n) + '"' + (n === st.sheet ? ' aria-current="page"' : '') + '>' + esc(n) + '</button>'; }).join('') : '') + '</nav>' : '') +
        (m && st.view ? screen() : '') + '<p class="status wfg-say" role="status" aria-live="polite">' + esc(st.say) + '</p>';
    }

    function save(scope) {
      var nodes = scope.querySelectorAll('[data-cell]'), cells = [];
      nodes.forEach(function (n) {
        if (n.tagName === 'BUTTON') { if (n.dataset.picked === '1') cells.push({ sheet: st.sheet, address: n.dataset.cell, value: n.dataset.value, expected: n.dataset.expected }); return; }
        if (n.value !== n.dataset.expected) cells.push({ sheet: st.sheet, address: n.dataset.cell, value: n.value, expected: n.dataset.expected });
      });
      if (!cells.length) { st.say = 'Rien de modifié.'; render(); return; }
      st.say = 'Écriture dans le fichier…'; render();
      api('workfile-cells', { cells: cells }).then(function (r) {
        var refused = (r.refused || []).map(function (x) { return x.address + ' (' + x.reason + ')'; });
        return load(st.sheet, st.offset).then(function () {
          st.say = (r.written || []).length + ' case(s) écrite(s) et relue(s) dans le fichier.' + (refused.length ? ' Refusé : ' + refused.join(', ') + '.' : '');
          render(); var ref = $('audit-refresh'); if (ref) ref.click();
        });
      }).catch(function (e) { st.say = 'Écriture refusée : ' + (e && e.message || e) + '. Rien n’a été forcé.'; render(); });
    }

    board.addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b || b.disabled) return;
      if (b.dataset.go) return void load(b.dataset.go, 0);
      if (b.dataset.page) return void load(st.sheet, Number(b.dataset.page));
      if (b.classList.contains('wfg-opt')) {
        b.parentNode.querySelectorAll('.wfg-opt').forEach(function (o) { o.setAttribute('aria-pressed', 'false'); o.dataset.picked = ''; });
        b.setAttribute('aria-pressed', 'true'); b.dataset.picked = '1'; return;
      }
      if (b.dataset.save) return void save(b.dataset.save === 'table' ? board : b.closest('.wfg-item'));
      if (b.dataset.chip != null) {
        var c = chips(st.view)[Number(b.dataset.chip)]; if (!c) return;
        if (c.go) return void load(c.go, 0);
        if (c.excel) { showInExcel(c.excel); var wbk = document.querySelector('.audit-workbook'); if (wbk) wbk.scrollIntoView({ behavior: 'smooth' }); return; }
        if (c.scroll) { var n = $(c.scroll); if (n) n.scrollIntoView({ behavior: 'smooth' }); return; }
        if (c.importer) { var ib = importButton(); if (ib) { showInExcel(st.sheet); ib.click(); } return; }
      }
    });

    render();
    return load(opts.sheet || null, 0);
  }

  OM.workfileGuide = { mount: mount };
})();
