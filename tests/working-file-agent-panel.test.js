import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

// Exercise the actual browser script with a small DOM boundary, not copied UI logic.
async function panel(respond) {
  class Element {
    constructor() { this.children = []; this.dataset = {}; this.listeners = {}; this.html = ''; }
    set textContent(text) { this.text = text; this.children = []; }
    get textContent() { return this.text || ''; }
    set innerHTML(html) { this.html = html; this.children = []; }
    get innerHTML() { return this.html; }
    appendChild(child) { this.children.push(child); }
    insertBefore(child) { this.children.push(child); }
    setAttribute() {}
    addEventListener(event, fn) { this.listeners[event] = fn; }
    querySelector() { return null; }
    querySelectorAll() { return this.children.filter(c => c.type === 'button'); }
  }
  const elements = new Map(), timers = new Map(), calls = [];
  const element = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const workspace = element('procedure-workspace'), dialogue = new Element();
  workspace.querySelector = () => dialogue;
  let timerId = 0;
  const document = { getElementById: element, createElement: () => new Element(), querySelector: () => null,
    documentElement: { dataset: {} }, addEventListener() {}, dispatchEvent() {} };
  const window = { OfficeManager: { api: async (_, options) => {
    const body = JSON.parse(options.body); calls.push(body);
    if (body.action === 'steps') return { steps: [{ n: 1, text: 'Comprendre la convention' }], runs: [] };
    return respond(body, calls);
  } } };
  vm.runInNewContext(await readFile(new URL('../assets/working-file-agent-panel.js', import.meta.url), 'utf8'), {
    window, document, location: { search: '?mission_id=M&code=X-01' }, URLSearchParams, console,
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id)
  });
  const settle = () => new Promise(resolve => setImmediate(resolve)); await settle();
  return { calls, timers, element, state: window.OfficeManager.workingFileAgent.state, settle };
}

test('opening a step starts one preparation; automatic resume carries the server checkpoint', async () => {
  const f = await panel(body => body.brain_job ? { blocked: true, questions: ['Préciser la période.'] } : { pending: true, brain_job: 'JOB', documents_read: [], documents_total: 20 });
  assert.deepEqual(f.calls.map(c => c.action), ['steps', 'step-plan']);
  assert.equal(f.timers.size, 1);
  const [id, fn] = f.timers.entries().next().value; f.timers.delete(id); fn(); await f.settle();
  assert.equal(f.calls.at(-1).brain_job, 'JOB'); assert.equal(f.calls.some(c => c.action === 'pipeline-plan'), false);
  assert.equal(f.element('wf-agent-status').textContent, 'À préciser'); assert.equal(f.timers.size, 0);
});

test('a network failure stops automatic retries without asking for missing evidence', async () => {
  const f = await panel(() => { throw new Error('Load failed'); });
  assert.equal(f.element('wf-agent-status').textContent, 'Préparation interrompue');
  assert.match(f.element('wf-agent-message').textContent, /connexion au serveur/);
  assert.deepEqual(f.element('wf-agent-actions').children.map(x => x.textContent), ['Réessayer']);
  assert.equal(f.timers.size, 0);
});

test('pause stops the next passage and retains the reading checkpoint', async () => {
  const f = await panel(() => ({ pending: true, read_job: 'READ', read: 1, total: 2 }));
  f.element('wf-agent-actions').children.find(x => x.textContent === 'Pause').listeners.click();
  assert.equal(f.timers.size, 0); assert.equal(f.state.plan.read_job, 'READ');
});
