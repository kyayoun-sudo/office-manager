/* Firm Manager Lite E5 — photo / PDF into the EXISTING mission-quick workflow.
 * Uses the same mission ACL, Drive destination, document registration and Orpailleur path.
 * No local file storage, no extra upload service, no automatic retry of writes. */
(function () {
  'use strict';
  var om = null, file = null, previewUrl = null, uploading = false, authorized = new Set();
  var SMALL_LIMIT = 2.5 * 1024 * 1024;
  var MOBILE_LIMIT = 20 * 1024 * 1024;
  var $ = function (id) { return document.getElementById(id); };
  function status(message, error) {
    var box = $('mobile-capture-status');
    box.textContent = message || '';
    box.dataset.state = error ? 'error' : 'neutral';
  }
  function releasePreview() {
    if (previewUrl) {
      try { URL.revokeObjectURL(previewUrl); } catch (_) {}
      previewUrl = null;
    }
    $('mobile-capture-preview').hidden = true;
    $('mobile-capture-preview').removeAttribute('src');
  }
  function useFile(chosen) {
    if (!chosen || uploading) return;
    releasePreview();
    file = null;
    $('mobile-capture-selected').hidden = true;
    if (!chosen.size) return status('Ce fichier est vide.', true);
    if (chosen.size > MOBILE_LIMIT) return status('Pour un dépôt sur téléphone, utilisez un fichier de 20 Mo maximum.', true);
    var mime = String(chosen.type || '').toLowerCase();
    var acceptable = mime.startsWith('image/') || mime === 'application/pdf' ||
      /\.(pdf|jpg|jpeg|png|webp|heic|heif)$/i.test(chosen.name || '');
    if (!acceptable) return status('Seules les photos et les pièces PDF sont acceptées dans cet écran.', true);
    file = chosen;
    $('mobile-capture-selected').hidden = false;
    $('mobile-capture-filename').textContent = (chosen.name || 'Pièce') + ' · ' +
      (Math.round(chosen.size / 1024) || 1) + ' Ko';
    if (mime.startsWith('image/') && window.URL && URL.createObjectURL) {
      previewUrl = URL.createObjectURL(chosen);
      $('mobile-capture-preview').src = previewUrl;
      $('mobile-capture-preview').hidden = false;
    }
    status('Pièce prête. Choisissez la mission puis confirmez le dépôt.', false);
  }
  function toBase64(attachment) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var raw = String(reader.result || '');
        var part = raw.split(',')[1] || '';
        if (!part) return reject(new Error('Fichier illisible.'));
        resolve(part);
      };
      reader.onerror = function () { reject(new Error('Lecture du fichier impossible.')); };
      reader.readAsDataURL(attachment);
    });
  }
  async function transfer(missionId, attachment) {
    var mime = attachment.type || 'application/octet-stream';
    if (attachment.size <= SMALL_LIMIT) {
      var base64 = await toBase64(attachment);
      return om.api('/api/app?route=mission-quick', {
        method: 'POST', body: JSON.stringify({
          action: 'piece', mission_id: missionId, name: attachment.name, mime: mime, base64: base64
        })
      });
    }
    var session = await om.api('/api/app?route=mission-quick', {
      method: 'POST', body: JSON.stringify({
        action: 'piece-start', mission_id: missionId, name: attachment.name, mime: mime, size: attachment.size
      })
    });
    if (!session || !session.upload_url) throw new Error('SESSION_UPLOAD_MISSING');
    // Never transmit data to a non-Google URL even if a proxy is misconfigured.
    var target = new URL(session.upload_url);
    if (target.protocol !== 'https:' || target.hostname !== 'www.googleapis.com' || !target.pathname.startsWith('/upload/drive/')) {
      throw new Error('UPLOAD_URL_NOT_ALLOWED');
    }
    var result = await fetch(target.href, { method: 'PUT', body: attachment });
    if (!result.ok) throw new Error('Envoi refusé par Google (' + result.status + ')');
    var uploaded = await result.json();
    if (!uploaded || !uploaded.id) throw new Error('Identifiant du document non confirmé.');
    return { file_id: uploaded.id, name: uploaded.name || session.name };
  }
  async function send(event) {
    event.preventDefault();
    if (uploading) return;
    var selectedMission = $('mobile-capture-mission').value;
    if (!authorized.has(selectedMission)) return status('Choisissez une mission autorisée.', true);
    if (!file) return status('Prenez une photo ou choisissez une pièce.', true);
    if (!navigator.onLine) return status('Hors ligne : aucun dépôt effectué.', true);
    var attachment = file;
    uploading = true;
    $('mobile-capture-send').disabled = true;
    $('mobile-capture-form').setAttribute('aria-busy', 'true');
    var uploadedId = null;
    try {
      status('Envoi dans la mission… Ne quittez pas cet écran.', false);
      var transferred = await transfer(selectedMission, attachment);
      uploadedId = transferred && transferred.file_id;
      if (!uploadedId) throw new Error('Le dépôt n’a pas été confirmé.');
      status('Fichier déposé. Enregistrement et lancement du traitement…', false);
      var done = await om.api('/api/app?route=mission-quick', {
        method: 'POST', body: JSON.stringify({
          action: 'pieces-done', mission_id: selectedMission,
          note: $('mobile-capture-note').value.trim().slice(0, 400) ||
            'Pièce reçue depuis Firm Manager Lite, à vérifier et classer selon les règles du cabinet.',
          files: [{ id: uploadedId }]
        })
      });
      if (!done || !done.received) throw new Error('Enregistrement de la pièce non confirmé.');
      if (done.analysis && done.analysis.error) {
        status('Pièce enregistrée dans la mission, mais analyse non confirmée. Vérifiez le suivi avant de relancer.', true);
      } else {
        status('Pièce enregistrée dans la mission. Traitement documentaire demandé ; vérifiez son statut dans Firm Manager.', false);
      }
      file = null;
      $('mobile-capture-camera-input').value = '';
      $('mobile-capture-file-input').value = '';
      $('mobile-capture-note').value = '';
      $('mobile-capture-selected').hidden = true;
      releasePreview();
    } catch (error) {
      status(uploadedId
        ? 'Pièce probablement déposée (réf. ' + uploadedId + '), mais son enregistrement ou son analyse n’a pas été confirmé. Vérifiez la mission avant de renvoyer.'
        : 'Dépôt non confirmé (' + (error && error.message || 'erreur réseau') + '). Vérifiez la mission avant toute nouvelle tentative.',
        true);
    } finally {
      uploading = false;
      $('mobile-capture-send').disabled = false;
      $('mobile-capture-form').removeAttribute('aria-busy');
    }
  }
  function setMissions(missions) {
    var picker = $('mobile-capture-mission');
    if (!picker) return;
    var previous = picker.value;
    authorized = new Set();
    picker.replaceChildren();
    var blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Choisir une mission autorisée…';
    picker.appendChild(blank);
    (Array.isArray(missions) ? missions : []).forEach(function (mission) {
      if (!mission || typeof mission.id !== 'string') return;
      authorized.add(mission.id);
      var opt = document.createElement('option');
      opt.value = mission.id;
      opt.textContent = mission.name || mission.mission_code || 'Mission';
      picker.appendChild(opt);
    });
    picker.value = authorized.has(previous) ? previous : '';
  }
  function init(officeManager) {
    if (om) return;
    om = officeManager;
    $('mobile-capture-camera').addEventListener('click', function () { $('mobile-capture-camera-input').click(); });
    $('mobile-capture-file').addEventListener('click', function () { $('mobile-capture-file-input').click(); });
    $('mobile-capture-camera-input').addEventListener('change', function () { useFile(this.files && this.files[0]); });
    $('mobile-capture-file-input').addEventListener('change', function () { useFile(this.files && this.files[0]); });
    $('mobile-capture-form').addEventListener('submit', send);
    window.addEventListener('pagehide', releasePreview);
  }
  window.FirmMobileCapture = { init: init, setMissions: setMissions };
})();
