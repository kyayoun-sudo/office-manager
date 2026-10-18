import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const html = await readFile(new URL('../demarrer.html', import.meta.url), 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function wizard({ rejectGrant = false, introDone = true } = {}) {
  const nodes = new Map(), calls = [], state = { connected: true, email: 'owner@example.test', shared_drives: [{ id: 'drive1', name: 'TATY ET ASSOCIES PERSONNEL' }], firm_drive: null };
  function element() {
    const classes = new Set();
    return { value: '', textContent: '', hidden: false, disabled: false, children: [], listeners: {}, parentNode: {},
      classList: { toggle: (c, on) => on ? classes.add(c) : classes.delete(c), contains: c => classes.has(c) },
      appendChild(n) { this.children.push(n); }, addEventListener(k, fn) { this.listeners[k] = fn; } };
  }
  const get = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const OM = { getSession: () => ({ user: { display_name: 'Owner' } }), isOwner: () => true, getOwnerToken: () => 'test', getUserName: () => 'Owner',
    api: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.includes('agent-intro')) return { locked: introDone, agents: [] };
      if (!options.method) return state;
      if (url.includes('agent-permissions')) { if (rejectGrant) throw Object.assign(new Error('Permission refused'), { code: 'AGENTS_NOT_AUTHORIZED' }); return {}; }
      const b = JSON.parse(options.body); state.firm_drive = { id: b.home || b.link, name: 'Chosen drive' }; return { mapping_started: true };
    } };
  vm.runInNewContext(script, { window: { OfficeManager: OM }, document: { getElementById: get, createElement: element },
    location: { search: '', pathname: '/demarrer.html' }, history: { replaceState() {} }, URLSearchParams,
    fetch: async () => ({ json: async () => ({ google_login: true }) }) });
  return { get, calls, state, click: async id => { get(id).listeners.click(); await flush(); } };
}
test('a Drive visible in Google is not an automatically selected cabinet after a reset', async () => {
  const w = wizard(); await flush();
  assert.equal(w.get('home').value, '');
  assert.equal(w.get('home').children[0].value, '');
  assert.ok(w.get('home').children.some(o => o.textContent === 'TATY ET ASSOCIES PERSONNEL'));
  assert.match(w.get('s3-msg').textContent, /Aucun Drive enregistré/);
  assert.match(w.get('home-help').textContent, /owner@example.test/);
  await w.click('s3-save-all'); assert.equal(w.calls.filter(c => c.options.method === 'POST').length, 0);
  assert.match(w.get('s3-msg').textContent, /Choisissez/);
  await w.click('s3-save'); assert.match(w.get('s3-msg').textContent, /Collez une adresse/);
  w.get('home').value = 'drive1'; await w.click('s3-save-all');
  assert.equal(JSON.parse(w.calls.find(c => c.options.method === 'POST').options.body).home, 'drive1');
  assert.ok(w.get('st4').classList.contains('done'));
});
test('a failed agent grant is visible and does not announce setup completion', async () => {
  const w = wizard({ rejectGrant: true }); await flush(); w.get('home').value = 'drive1';
  await w.click('s3-save-all');
  assert.match(w.get('s3-msg').textContent, /enregistré, mais l’autorisation/);
  assert.ok(w.get('st4').classList.contains('off'));
  assert.equal(w.get('s3-save-all').disabled, false);
  assert.equal(w.get('s3-save').disabled, false);
});

test('choosing a Drive preserves the branch introduction step before setup is ready', async () => {
  const w = wizard({ introDone: false }); await flush(); w.get('home').value = 'drive1';
  await w.click('s3-save-all');
  assert.ok(w.get('st4').classList.contains('off'));
  assert.ok(w.calls.some(c => c.url.includes('agent-intro')));
});
