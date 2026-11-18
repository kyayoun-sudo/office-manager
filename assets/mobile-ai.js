/* Firm Manager Lite E4 — requests to the SAME protected /api/agent used on desktop.
 * UI-only client: no independent AI provider, agent or persistence.
 * In-flight requests are never retried automatically: tools may already have acted. */
(function () {
  'use strict';
  var api = null;
  var submitting = false;
  var $ = function (id) { return document.getElementById(id); };
  var ALLOWED_AGENTS = ['auto', 'mission-controller', 'orpailleur', 'enhanced-auditor', 'sika'];
  function state(message, kind) {
    var el = $('mobile-ai-status');
    el.textContent = message;
    el.dataset.state = kind || 'neutral';
  }
  function showResult(data) {
    var card = $('mobile-ai-answer-card');
    card.hidden = false;
    var answer = (data && typeof data.answer === 'string' && data.answer.trim())
      ? data.answer.trim() : 'Aucune réponse fournie. Vérifiez le journal des demandes avant de relancer.';
    $('mobile-ai-answer').textContent = answer;
    var status = String(data && data.kernelStatus || '').toLowerCase();
    var desc = status === 'verified'
      ? 'Traitement marqué comme vérifié par le moteur. Contrôlez les éléments et pièces correspondants.'
      : status === 'awaiting_human'
        ? 'Une intervention ou une validation humaine peut être nécessaire.'
        : status === 'blocked'
          ? 'Le traitement est bloqué ; aucune réussite n’est présumée.'
          : 'État d’exécution à confirmer dans le suivi des agents.';
    var evidence = Array.isArray(data.toolsUsed) && data.toolsUsed.length
      ? ' · Outils sollicités : ' + data.toolsUsed.length : '';
    var run = data && data.runId ? ' · Référence : ' + String(data.runId) : '';
    $('mobile-ai-proof').textContent = desc + evidence + run;
  }
  function send(event) {
    event.preventDefault();
    if (submitting || !api) return;
    var message = $('mobile-ai-message').value.trim();
    var agent = $('mobile-ai-agent').value;
    if (!message) { state('Écrivez votre demande.', 'error'); return; }
    if (message.length > 4000 || ALLOWED_AGENTS.indexOf(agent) === -1) {
      state('Vérifiez la demande et l’agent choisi.', 'error'); return;
    }
    if (!navigator.onLine) {
      state('Hors ligne. Votre demande n’a pas été envoyée.', 'error'); return;
    }
    submitting = true;
    $('mobile-ai-send').disabled = true;
    $('mobile-ai-form').setAttribute('aria-busy', 'true');
    $('mobile-ai-answer-card').hidden = true;
    state('Analyse en cours sur le serveur… N’envoyez pas une deuxième fois. La demande peut prendre quelques minutes.', 'working');
    api.api('/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message, agent: agent, provider: 'auto', risk: 'normal' })
    }).then(function (data) {
      showResult(data);
      state('Réponse reçue de ' + (data.agentName || 'l’agent') + '.', 'success');
    }).catch(function (error) {
      var code = error && (error.code || error.message);
      if (code === 'EXTERNAL_AI_APPROVAL_REQUIRED' || code === 'CONTENT_PROCESSING_APPROVAL_REQUIRED') {
        state('Autorisation des agents nécessaire : demandez au propriétaire de la donner depuis la version complète. Rien n’a été relancé.', 'error');
      } else if (code === 'AGENT_DISABLED' || code === 'AGENT_NOT_CONFIGURED') {
        state('Cet agent n’est pas disponible pour votre cabinet. Choisissez un autre agent.', 'error');
      } else if (code === 'SESSION_EXPIRED' || code === 'UNAUTHORIZED') {
        state('Session expirée. Connectez-vous à nouveau avant toute autre demande.', 'error');
      } else {
        state('Réponse non confirmée (' + (error && error.message || 'réseau ou serveur') +
          '). Vérifiez le suivi des agents avant de renvoyer pour éviter une action en double.', 'error');
      }
    }).finally(function () {
      submitting = false;
      $('mobile-ai-send').disabled = false;
      $('mobile-ai-form').removeAttribute('aria-busy');
    });
  }
  function init(officeManager) {
    if (api) return;
    api = officeManager;
    $('mobile-ai-form').addEventListener('submit', send);
  }
  function prefill(message, agent) {
    var value = String(message || '').slice(0, 4000);
    $('mobile-ai-message').value = value;
    $('mobile-ai-agent').value = ALLOWED_AGENTS.includes(agent) ? agent : 'auto';
    $('mobile-ai-message').focus();
  }
  window.FirmMobileAI = { init: init, prefill: prefill };
})();
