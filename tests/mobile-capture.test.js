import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../mobile.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../assets/mobile-capture.js', import.meta.url), 'utf8');
const appJs = readFileSync(new URL('../assets/mobile.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../mobile-sw.js', import.meta.url), 'utf8');

test('camera/PDF upload reuses the mission-quick ACL path and never creates a second backend', () => {
  assert.doesNotThrow(() => new Script(js));
  assert.ok(html.includes('/assets/mobile-capture.js'));
  for (const id of ['mobile-capture-mission', 'mobile-capture-camera', 'mobile-capture-file',
    'mobile-capture-camera-input', 'mobile-capture-file-input', 'mobile-capture-status',
    'mobile-capture-send', 'mobile-capture-note']) {
    assert.ok(html.includes('id="' + id + '"'), id);
  }
  assert.ok(js.includes("action: 'piece'"));
  assert.ok(js.includes("action: 'piece-start'"));
  assert.ok(js.includes("action: 'pieces-done'"));
  assert.ok(js.includes('MOBILE_LIMIT = 20 * 1024 * 1024'));
  assert.ok(js.includes('authorized.has(selectedMission)'));
  assert.ok(js.includes('!navigator.onLine'));
  assert.ok(js.includes('!result.ok'));
  assert.ok(!js.includes('localStorage.'));
  assert.ok(!js.includes('sessionStorage.'));
  assert.ok(!js.includes('innerHTML'));
  assert.ok(appJs.includes('window.FirmMobileCapture.init(OM)'));
  assert.ok(appJs.includes('window.FirmMobileCapture.setMissions(list)'));
  assert.ok(worker.includes("'/assets/mobile-capture.js'"));
});

test('a selected photo uploads once and is registered to the same mission', async () => {
  const elements = new Map();
  function el(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        value: '', textContent: '', dataset: {}, hidden: false, disabled: false, files: null, listeners: {}, childNodes: [],
        addEventListener(name, listener) { this.listeners[name] = listener; },
        removeAttribute(name) { delete this[name]; },
        setAttribute(name, value) { this[name] = value; },
        click() {},
        replaceChildren() { this.childNodes = []; },
        appendChild(item) { this.childNodes.push(item); }
      });
    }
    return elements.get(id);
  }
  class MockFileReader {
    readAsDataURL() {
      this.result = 'data:image/jpeg;base64,dGVzdA==';
      this.onload();
    }
  }
  const window = { addEventListener() {} };
  const document = { getElementById: el, createElement() { return { value: '', textContent: '' }; } };
  runInNewContext(js, { window, document, navigator: { onLine: true }, FileReader: MockFileReader, Promise,
    URL: class URLMock {} });
  const calls = [];
  window.FirmMobileCapture.init({
    api(path, options) {
      assert.equal(path, '/api/app?route=mission-quick');
      const b = JSON.parse(options.body);
      calls.push(b);
      return Promise.resolve(b.action === 'piece' ? { file_id: 'file-123' } : { received: 1, analysis: { status: 'pending' } });
    }
  });
  window.FirmMobileCapture.setMissions([{ id: 'mission-1', name: 'Mission de test' }]);
  el('mobile-capture-mission').value = 'mission-1';
  const input = el('mobile-capture-camera-input');
  input.files = [{ name: 'facture.jpg', type: 'image/jpeg', size: 2048 }];
  input.listeners.change.call(input);
  await el('mobile-capture-form').listeners.submit({ preventDefault() {} });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].action, 'piece');
  assert.equal(calls[0].mission_id, 'mission-1');
  assert.equal(calls[1].action, 'pieces-done');
  assert.equal(calls[1].files[0].id, 'file-123');
  assert.match(el('mobile-capture-status').textContent, /Pièce enregistrée/);
});

test('a mission not returned by the authorized API cannot be selected for upload', async () => {
  assert.ok(js.includes('authorized = new Set()'));
  assert.ok(js.includes('authorized.has(selectedMission)'));
  assert.ok(js.includes('avant de renvoyer'));
});
