import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../mobile.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../assets/mobile-work.js', import.meta.url), 'utf8');
const boot = readFileSync(new URL('../assets/mobile.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/mobile.css', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../mobile-sw.js', import.meta.url), 'utf8');

test('E6 keeps procedure work in the canonical Firm Manager app', () => {
  assert.doesNotThrow(() => new Script(js));
  assert.match(html, /src="\/assets\/mobile-work\.js"/);
  for (const id of ['mobile-work-list', 'mobile-work-mine', 'mobile-work-reviews',
    'mobile-work-detail', 'mobile-work-conclusion-form', 'mobile-work-review-form',
    'mobile-work-detail-status', 'mobile-work-points']) {
    assert.ok(html.includes('id="' + id + '"'), id);
  }
  assert.match(js, /route=procedure&mine=1/);
  assert.match(js, /route=procedure&reviews=1/);
  assert.match(js, /commit\('answer-point'/);
  assert.match(js, /commit\('conclusion'/);
  assert.match(js, /commit\('return'/);
  assert.match(js, /commit\('clear-point'/);
  assert.match(js, /if \(!window\.confirm/);
  assert.match(boot, /FirmMobileWork\.init\(OM\)/);
  assert.match(boot, /FirmMobileWork\.refresh\(force\)/);
  assert.match(css, /\.mobile-work-section/);
  assert.match(worker, /mobile-work\.js/);
  assert.doesNotMatch(js, /\.innerHTML\s*=/);
  assert.doesNotMatch(js, /localStorage\s*[.\[]|sessionStorage\s*[.\[]/);
  // Professional WP signatures are retained in the full page after examination.
  assert.doesNotMatch(js, /commit\('sign'/);
});

test('a preparer sees their procedures and saves a conclusion through the same server API', async () => {
  const elements = new Map();
  function factory() {
    return {
      textContent: '', value: '', hidden: false, dataset: {}, disabled: false, listeners: {}, children: [],
      appendChild(child) { this.children.push(child); return child; },
      append(...items) { this.children.push(...items); },
      replaceChildren(...items) { this.children = [...items]; },
      setAttribute(name, v) { this[name] = v; },
      removeAttribute(name) { delete this[name]; },
      addEventListener(name, fn) { this.listeners[name] = fn; },
      querySelectorAll() { return []; }
    };
  }
  function get(id) {
    if (!elements.has(id)) elements.set(id, factory());
    return elements.get(id);
  }
  const window = { confirm() { return true; } };
  const document = { getElementById: get, createElement() { return factory(); }, hidden: false };
  const navigator = { onLine: true };
  runInNewContext(js, { window, document, navigator, Promise });
  let posts = [];
  const client = {
    api(path, opts) {
      if (opts?.method === 'POST') {
        posts.push(JSON.parse(opts.body));
        return Promise.resolve({ work: { status: 'in_progress' } });
      }
      if (path.includes('&mine=1')) return Promise.resolve({ procedures: [{
        mission_id: '11111111-1111-4111-8111-111111111111', code: 'A.01',
        title: 'Contrôler les comptes', mission_name: 'Audit test', status: 'in_progress'
      }] });
      if (path.includes('&reviews=1')) return Promise.resolve({ reviews: [] });
      if (path.includes('&review=1')) return Promise.resolve({ status: 'in_progress', points: [], me: { is_preparer: true, may_review: false } });
      return Promise.resolve({ editable: true, work: { status: 'in_progress', conclusion: '' } });
    }
  };
  window.FirmMobileWork.init(client);
  await window.FirmMobileWork.refresh(true);
  assert.equal(get('mobile-work-mine').children.length, 1);
  get('mobile-work-mine').children[0].listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(get('mobile-work-conclusion-form').hidden, false);
  assert.equal(get('mobile-work-review-form').hidden, true);
  get('mobile-work-conclusion').value = 'Conclusion courte documentée';
  get('mobile-work-conclusion-form').listeners.submit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(posts.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(posts[0])), {
    action: 'conclusion', mission_id: '11111111-1111-4111-8111-111111111111',
    code: 'A.01', conclusion: 'Conclusion courte documentée'
  });
});

test('E6 never sends a signature or bypasses permissions from the mobile app', () => {
  assert.ok(js.includes('review.me && review.me.is_preparer'));
  assert.ok(js.includes('review.me && review.me.may_review'));
  assert.ok(js.includes('detail.editable'));
  assert.ok(js.includes('server'));
  assert.ok(js.includes('if (!om || busy || !current)'));
  assert.ok(!js.includes("method: 'DELETE'"));
});
