import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../mobile.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../assets/mobile-ai.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../mobile-sw.js', import.meta.url), 'utf8');

test('light mobile AI screen uses the same server agent endpoint', () => {
  assert.doesNotThrow(() => new Script(script));
  assert.match(html, /src="\/assets\/mobile-ai\.js"/);
  for (const id of ['mobile-ai-form','mobile-ai-agent','mobile-ai-message','mobile-ai-send','mobile-ai-answer','mobile-ai-proof','mobile-ai-status']) {
    assert.ok(html.includes('id="' + id + '"'), 'Missing ' + id);
  }
  assert.match(script, /api\.api\('\/api\/agent'/);
  assert.match(script, /provider: 'auto', risk: 'normal'/);
  assert.match(script, /EXTERNAL_AI_APPROVAL_REQUIRED/);
  assert.match(script, /CONTENT_PROCESSING_APPROVAL_REQUIRED/);
  assert.match(script, /data\.kernelStatus/);
  assert.doesNotMatch(script, /innerHTML\s*=/);
  assert.doesNotMatch(script, /localStorage\s*[.\[]/);
  assert.doesNotMatch(script, /sessionStorage\s*[.\[]/);
  assert.match(worker, /mobile-ai\.js/);
  assert.doesNotMatch(worker, /['"]\/api\/agent['"]/);
});

test('mobile AI submits one request while pending and shows returned answer without inventing execution', async () => {
  const elements = new Map();
  function el(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        value: '', textContent: '', dataset: {}, hidden: true, disabled: false, listeners: {},
        addEventListener(name, cb) { this.listeners[name] = cb; },
        setAttribute(name, value) { this[name] = value; },
        removeAttribute(name) { delete this[name]; }
      });
    }
    return elements.get(id);
  }
  const document = { getElementById: el };
  const window = {};
  runInNewContext(script, { document, window, navigator: { onLine: true }, Promise });
  let complete;
  let calls = 0;
  let payload = null;
  const remote = new Promise(resolve => { complete = resolve; });
  window.FirmMobileAI.init({
    api(path, options) {
      calls += 1;
      assert.equal(path, '/api/agent');
      payload = JSON.parse(options.body);
      return remote;
    }
  });
  el('mobile-ai-agent').value = 'auto';
  el('mobile-ai-message').value = 'Résume les tâches du cabinet';
  const submit = el('mobile-ai-form').listeners.submit;
  const event = { preventDefault() {} };
  submit(event);
  submit(event);
  assert.equal(calls, 1);
  assert.equal(payload.message, 'Résume les tâches du cabinet');
  assert.equal(payload.provider, 'auto');
  assert.equal(el('mobile-ai-send').disabled, true);
  complete({ answer: 'Résumé disponible', agentName: 'Assistant', kernelStatus: 'awaiting_human', runId: 'run_1', toolsUsed: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(el('mobile-ai-answer').textContent, 'Résumé disponible');
  assert.match(el('mobile-ai-proof').textContent, /validation humaine/);
  assert.match(el('mobile-ai-proof').textContent, /run_1/);
  assert.equal(el('mobile-ai-send').disabled, false);
});
