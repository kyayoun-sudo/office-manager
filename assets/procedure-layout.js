// « Ma procédure » en deux colonnes (Paul, 2026-10-24 : « un truc à gauche, à droite le working file par feuille ; je veux pas deux
// fois les mêmes choses ; tu peux mettre à gauche ce que le SOP dit »).
//   À gauche : ce que dit le SOP, puis le travail de l'agent (étape, proposition sourcée, « Valider et écrire »), les pièces
//              (dépôt, mail) et le chat, en bas.
//   À droite : le working file, feuille par feuille (écran construit depuis le fichier), avec ses boutons d'import et de modèle.
// Rien n'est supprimé : les blocs existants sont DÉPLACÉS (mêmes éléments, mêmes fonctions) ; les vues qui faisaient doublon sont
// rangées dans « Vues détaillées », repliées en bas de la page.
(function () {
  'use strict';
  var main = document.querySelector('main.main');
  if (!main || !document.getElementById('procedure-workspace')) return;
  // Proposals sent before the working-file screen is ready are kept, so none is lost (the screen reads them when it starts).
  window.__wfProposals = window.__wfProposals || {};
  document.addEventListener('wf-proposals', function (e) { var d = e.detail || {}; window.__wfProposals[d.channel || 'step'] = d.cells || []; });
  document.addEventListener('wf-written', function () { window.__wfProposals = {}; });
  var link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/assets/procedure-layout.css'; document.head.appendChild(link);

  var layout = document.createElement('section'); layout.id = 'wf-layout'; layout.setAttribute('aria-label', 'Procédure avec l’agent et le working file');
  var left = document.createElement('div'); left.id = 'wf-left';
  var right = document.createElement('div'); right.id = 'wf-right';
  layout.appendChild(left); layout.appendChild(right);
  var workspace = document.getElementById('procedure-workspace');
  workspace.parentNode.insertBefore(layout, workspace);

  var details = document.createElement('details'); details.id = 'wf-older'; details.className = 'card';
  details.innerHTML = '<summary><h2 style="display:inline">Vues détaillées</h2> <span class="meta">population, échantillon, étapes : déjà repris par l’agent et le working file</span></summary>';
  var older = document.getElementById('revue') || null;

  function move(node, into, before) { if (node && into && node.parentNode !== into) { if (before) into.insertBefore(node, before); else into.appendChild(node); } }

  function arrange() {
    // Left: the SOP first.
    var sop = document.getElementById('card-box');
    var sopCard = sop && sop.closest('section.card');
    if (sopCard && sopCard.parentNode !== left) { move(sopCard, left, left.firstChild); sop.open = true; sopCard.classList.add('wf-sop'); }
    var dialogue = workspace.querySelector('.audit-dialogue') || document.querySelector('.audit-dialogue');
    if (dialogue && dialogue.parentNode !== left) move(dialogue, left);
    // The working-file board goes right; the agent's board stays in the dialogue (left).
    var guide = document.querySelector('.wf-understanding-board');
    if (guide && guide.parentNode !== right) move(guide, right, right.firstChild);
    // The file's own buttons (refresh, import client data, firm model) follow the working file; the old grid is not shown twice.
    var wb = document.querySelector('.audit-workbook');
    if (wb && wb.parentNode !== right) { move(wb, right); wb.classList.add('wf-buttons-only'); }
    // Pieces (deposit + mail) under the agent, then the chat stays at the bottom of the dialogue.
    var needs = document.getElementById('needs-card');
    if (needs && dialogue && needs.parentNode !== left) left.insertBefore(needs, dialogue.nextSibling);
    // Views that repeat what the agent and the sheet now show: folded at the bottom, still there.
    ['steps-card', 'pop-card', 'sample-card', 'items-card', 'wt-card'].forEach(function (id) { var n = document.getElementById(id); if (n && n.parentNode !== details) details.appendChild(n); });
    if (details.parentNode !== main) main.appendChild(details);
    // The agent's chat title becomes « Chat », at the bottom.
    var h = document.getElementById('h-dialogue'); if (h && h.textContent !== 'Chat avec l’agent') h.textContent = 'Chat avec l’agent';
  }

  arrange();
  // The agent that helps (what it already knows, the received pieces): at the top of the left column.
  var assist = document.createElement('script'); assist.src = '/assets/workfile-assist.js'; assist.defer = true; document.head.appendChild(assist);
  // The agent's board and the working-file board are added by their own scripts a moment later: place them when they appear.
  var obs = new MutationObserver(function () { arrange(); });
  obs.observe(main, { childList: true, subtree: true });
  setTimeout(function () { obs.disconnect(); arrange(); }, 20000);
  layout.hidden = false;
  var show = function () { layout.hidden = workspace.hidden; };
  new MutationObserver(show).observe(workspace, { attributes: true, attributeFilter: ['hidden'] }); show();
})();
