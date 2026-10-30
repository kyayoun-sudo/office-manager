import test from 'node:test';
import assert from 'node:assert/strict';
import { introView, saveIntro, driveIdFromLink, AGENT_INTROS } from '../lib/agent-intro.js';

function store() {
  let settings = {}; const audits = [];
  return { audits, get: () => settings,
    // Like the database: the row comes back with its version; a write returns the row it wrote (firm-settings-store).
    d: { fetchRows: async (p, o) => { if (o?.method === 'POST' || o?.method === 'PATCH') { const b = JSON.parse(o.body); settings = (Array.isArray(b) ? b[0] : b).settings; return [{ settings }]; } return [{ settings, updated_at: 'v1' }]; },
      getMeta: async id => id === 'GOODFILEID1234567890ABC' ? { id, name: 'Liste PBC', mimeType: 'application/vnd.google-apps.spreadsheet' } : id === 'BINNEDFILE1234567890ABC' ? { id, trashed: true } : null,
      audit: async (o, ev) => { audits.push(...ev); } } };
}
const acc = { email: 'p@x.fr', display_name: 'Paul', role: 'owner' };

test('every agent introduces itself; Shadow asks for no file', async () => {
  const s = store(); const v = await introView('o', acc, s.d);
  assert.equal(v.agents.length, AGENT_INTROS.length); assert.deepEqual(v.agents.find(a => a.agent === 'shadow').needs, []);
  assert.equal(v.locked, false);
});

test('the IT person is only asked where things are; the link is checked by the agent, never taken on trust', async () => {
  const s = store(); await saveIntro('o', { action: 'role', as_it: true }, acc, s.d);
  const v = await introView('o', acc, s.d);
  assert.ok(v.agents.flatMap(a => a.needs).every(n => n.it === true));
  const ok = await saveIntro('o', { action: 'link', need: 'missions_root', link: 'https://drive.google.com/drive/folders/GOODFILEID1234567890ABC' }, acc, s.d);
  assert.equal(ok.agents.flatMap(a => a.needs).find(n => n.key === 'missions_root').answer.status, 'verified');
  const bad = await saveIntro('o', { action: 'link', need: 'inbox_folder', link: 'https://drive.google.com/drive/folders/BINNEDFILE1234567890ABC' }, acc, s.d);
  assert.equal(bad.agents.flatMap(a => a.needs).find(n => n.key === 'inbox_folder').answer.status, 'not_found');
  assert.ok(s.audits.some(a => a.action_type === 'FIRST_CONNECTION_LINK_NOT_FOUND'));
});

test('the step must be passed: finish refuses open needs; « plus tard » or skip lets it pass; skipped can be seen again, done never', async () => {
  const s = store();
  await assert.rejects(saveIntro('o', { action: 'finish' }, acc, s.d), /INTRO_NEEDS_OPEN/);
  await saveIntro('o', { action: 'skip' }, acc, s.d);
  let v = await introView('o', acc, s.d); assert.equal(v.status, 'skipped'); assert.equal(v.locked, false); assert.ok(v.agents.length);
  for (const n of AGENT_INTROS.flatMap(a => a.needs)) await saveIntro('o', { action: 'later', need: n.key }, acc, s.d);
  await saveIntro('o', { action: 'finish' }, acc, s.d);
  v = await introView('o', acc, s.d); assert.equal(v.locked, true); assert.equal(v.agents, undefined);
  await assert.rejects(saveIntro('o', { action: 'skip' }, acc, s.d), /INTRO_ALREADY_DONE/);
});

test('unknown need and unreadable link are refused', async () => {
  const s = store();
  await assert.rejects(saveIntro('o', { action: 'later', need: 'nope' }, acc, s.d), /UNKNOWN_NEED/);
  await assert.rejects(saveIntro('o', { action: 'link', need: 'pbc_master', link: 'abc' }, acc, s.d), /LINK_NOT_RECOGNISED/);
  assert.equal(driveIdFromLink('https://drive.google.com/drive/folders/GOODFILEID1234567890ABC?usp=sharing'), 'GOODFILEID1234567890ABC');
});

import { personView, answerPerson, screenIntro, dismissScreen, PERSON_QUESTIONS } from '../lib/agent-intro.js';
test('each person gets only the questions of their position, the work-style one first; answers are kept per person', async () => {
  const s = store(); const aud = { email: 'a@x.fr', role: 'auditor' }, sec = { email: 's@x.fr', role: 'secretary' };
  const v = await personView('o', aud, s.d);
  assert.equal(v.pending[0].key, 'work_style'); assert.ok(v.pending.every(q => PERSON_QUESTIONS.find(x => x.key === q.key).roles.includes('auditor')));
  assert.ok(!v.pending.some(q => q.key === 'billing_who'));
  const after = await answerPerson('o', aud, { key: 'work_style', answer: 'Autonomie' }, s.d);
  assert.ok(!after.pending.some(q => q.key === 'work_style'));
  assert.ok((await personView('o', sec, s.d)).pending.some(q => q.key === 'work_style'));   // the secretary's own answers are separate
  await assert.rejects(answerPerson('o', aud, { key: 'billing_who', answer: 'x' }, s.d), /UNKNOWN_QUESTION/);
  await assert.rejects(answerPerson('o', aud, { key: 'work_style', answer: 'n’importe quoi' }, s.d), /ANSWER_NOT_IN_OPTIONS/);
});
test('a screen presentation depends on the position and is shown until « Ne plus afficher »', async () => {
  const s = store(); const aud = { email: 'a@x.fr', role: 'auditor' }, par = { email: 'p@x.fr', role: 'partner' };
  assert.match((await screenIntro('o', aud, 'accueil', s.d)).text, /Mon travail/); assert.match((await screenIntro('o', par, 'accueil', s.d)).text, /Accueil du cabinet/);
  await dismissScreen('o', aud, 'accueil', s.d);
  assert.equal((await screenIntro('o', aud, 'accueil', s.d)).text, null); assert.ok((await screenIntro('o', par, 'accueil', s.d)).text);
  assert.equal((await screenIntro('o', aud, 'inconnu', s.d)).text, null);
});
