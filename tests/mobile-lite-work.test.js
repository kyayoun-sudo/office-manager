import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../mobile.html', import.meta.url), 'utf8');
const tasks = readFileSync(new URL('../assets/mobile-tasks.js', import.meta.url), 'utf8');
const mail = readFileSync(new URL('../assets/mobile-mail.js', import.meta.url), 'utf8');
const ai = readFileSync(new URL('../assets/mobile-ai.js', import.meta.url), 'utf8');
const boot = readFileSync(new URL('../assets/mobile.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../mobile-sw.js', import.meta.url), 'utf8');

function dom() {
  const nodes = new Map();
  function make(tag) {
    return {
      tagName: tag, value: '', textContent: '', dataset: {}, children: [], hidden: false,
      disabled: false, listeners: {}, href: '',
      appendChild(n) { this.children.push(n); return n; },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = [...children]; },
      addEventListener(name, fn) { this.listeners[name] = fn; },
      setAttribute(name, v) { this[name] = v; },
      removeAttribute(name) { delete this[name]; },
      click() { if (this.listeners.click) this.listeners.click.call(this); }
    };
  }
  return {
    nodes, make,
    get(id) { if (!nodes.has(id)) nodes.set(id, make(id)); return nodes.get(id); },
    document: { hidden: false, createElement: make }
  };
}
test('Lite loads tasks and private email without extended work editor or its precache', () => {
  assert.doesNotThrow(() => new Script(tasks));
  assert.doesNotThrow(() => new Script(mail));
  assert.ok(html.includes('src="/assets/mobile-tasks.js"'));
  assert.ok(html.includes('src="/assets/mobile-mail.js"'));
  assert.ok(!html.includes('src="/assets/mobile-work.js"'));
  assert.ok(worker.includes("'/assets/mobile-tasks.js'"));
  assert.ok(worker.includes("'/assets/mobile-mail.js'"));
  assert.ok(!worker.includes("'/assets/mobile-work.js'"));
  assert.ok(boot.includes('FirmMobileTasks.init(OM)'));
  assert.ok(boot.includes('FirmMobileMail.init(OM)'));
  assert.ok(ai.includes('prefill: prefill'));
});
test('task list asks the same AI with an explicit user action, never auto-signs', async () => {
  const d = dom();
  d.document.getElementById = d.get.bind(d);
  let switched = false, instruction = '';
  d.document.querySelector = function () {
    return { click() { switched = true; } };
  };
  const w = { FirmMobileAI: { prefill(text) { instruction = text; } } };
  const nav = { onLine: true };
  const loc = { origin: 'https://firm.example.test' };
  runInNewContext(tasks, { document: d.document, window: w, navigator: nav,
    location: loc, URL, Promise });
  const seen = [];
  w.FirmMobileTasks.init({ api(path) {
    seen.push(path);
    return Promise.resolve({ questions: [{ title: 'Audit A', question: 'Répondre au point de revue', href: '/procedure.html?code=A' }] });
  } });
  await w.FirmMobileTasks.refresh(true);
  const card = d.get('mobile-my-tasks').children[0];
  assert.equal(card.children[0].textContent, 'Audit A');
  const delegate = card.children[card.children.length-1].children.at(-1);
  delegate.click();
  assert.ok(switched);
  assert.match(instruction, /Répondre au point de revue/);
  assert.match(instruction, /Ne signe jamais à ma place/);
  assert.deepEqual(seen, ['/api/app?route=my-questions']);
  assert.doesNotMatch(tasks, /innerHTML\s*=/);
});
test('personal email access is bound to owned account endpoint, AI only drafts', async () => {
  const d = dom();
  d.document.getElementById = d.get.bind(d);
  const w = { confirm() { return true; } };
  runInNewContext(mail, { document: d.document, window: w,
    navigator: { onLine: true }, URL, URLSearchParams, Promise, location: { origin: 'https://firm.example.test' } });
  const calls = [];
  const mailboxId = 'mailbox-owned';
  const messageId = 'message-owned';
  const client = { api(path, options) {
    const post = options?.method === 'POST' ? JSON.parse(options.body) : null;
    calls.push({ path, post });
    if (post?.action === 'draft') return Promise.resolve({ id: 'draft-saved' });
    if (post?.action === 'send') return Promise.resolve({ status: 'sent' });
    if (post?.action === 'ai-draft') return Promise.resolve({ recipient:'client@example.org', subject:'Re: Question', body:'Brouillon IA', reply_to_id:messageId, needs_confirmation:true });
    if (path.includes('action=accounts')) return Promise.resolve({ accounts: [{ id: mailboxId, email: 'user@example.org', provider:'google', ai_enabled:true, status:'active' }] });
    if (path.includes('action=list')) return Promise.resolve({ items: [{ id:messageId, sender:'Client', subject:'Question', sender_email:'client@example.org', snippet:'À répondre' }] });
    if (path.includes('action=message')) return Promise.resolve({ item:{ id:messageId, sender:'Client', sender_email:'client@example.org', subject:'Question' }, body:'Bonjour' });
    throw Error('unexpected API call: '+path);
  } };
  w.FirmMobileMail.init(client);
  await w.FirmMobileMail.refresh(false);
  assert.equal(d.get('mobile-mail-no-account').hidden, true);
  assert.equal(d.get('mobile-mail-list').children.length, 1);
  d.get('mobile-mail-list').children[0].click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(d.get('mobile-mail-body').textContent, 'Bonjour');
  d.get('mobile-mail-ai-reply').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(d.get('mobile-mail-reply-body').value, 'Brouillon IA');
  assert.equal(calls.filter(c => c.post?.action === 'send').length, 0);
  d.get('mobile-mail-composer').listeners.submit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  const drafts = calls.filter(c => c.post?.action === 'draft');
  const sends = calls.filter(c => c.post?.action === 'send');
  assert.equal(drafts.length, 1);
  assert.equal(sends.length, 1);
  assert.equal(drafts[0].post.mailbox_id, mailboxId);
  assert.equal(drafts[0].post.reply_to_id, messageId);
  assert.equal(sends[0].post.draft_id, 'draft-saved');
  assert.equal(sends[0].post.confirm, true);
  assert.doesNotMatch(mail, /innerHTML\s*=/);
  assert.doesNotMatch(mail, /localStorage\s*[.\[]|sessionStorage\s*[.\[]/);
});
