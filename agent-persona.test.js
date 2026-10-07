import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePersona, presentPersona, isInternal, toneFor, internalStyleGuide, parseDraft, draftInternalMessage, savePersona
} from '../lib/agent-persona.js';
import { handleApp, ROUTES } from '../api/app.js';

const persona = presentPersona({
  agent_display_name: 'Office Manager TATY', sender_email: 'assistant@taty.info', aliases: ['pbc@taty.info'],
  internal_domains: ['taty.info'], internal_tone: 'nouchi_fun', humor_level: 2, internal_frequency: 'few_per_week'
});

test('persona: addresses, aliases and domains are validated and normalised', () => {
  const p = validatePersona({ agent_display_name: ' Agent ', sender_email: 'Assistant@TATY.info', aliases: 'pbc@taty.info\noffice@taty.info', internal_tone: 'nouchi_fun' });
  assert.equal(p.sender_email, 'assistant@taty.info');
  assert.deepEqual(p.internal_domains, ['taty.info'], 'sender domain is internal by default');
  assert.deepEqual(p.aliases, ['pbc@taty.info', 'office@taty.info']);
  assert.throws(() => validatePersona({ sender_email: 'pas-un-mail' }), /INVALID_SENDER_EMAIL/);
  assert.throws(() => validatePersona({ sender_email: 'a@taty.info', aliases: ['x@gmail.com'] }), /ALIAS_OUTSIDE_FIRM_DOMAINS/);
  assert.throws(() => validatePersona({ aliases: Array.from({ length: 11 }, (_, i) => i + '@taty.info') }), /INVALID_ALIASES/);
  assert.throws(() => validatePersona({ internal_tone: 'vulgaire' }), /INVALID_TONE/);
  assert.throws(() => validatePersona({ humor_level: 5 }), /INVALID_HUMOR_LEVEL/);
  assert.throws(() => validatePersona({ internal_domains: ['pas un domaine'] }), /INVALID_INTERNAL_DOMAINS/);
});

test('persona: colleagues get the chosen tone, clients always the formal tone', () => {
  assert.equal(isInternal('samira@taty.info', persona), true);
  assert.equal(toneFor('samira@taty.info', persona), 'nouchi_fun');
  assert.equal(toneFor('dg@client.com', persona), 'formal');
  assert.equal(toneFor('samira@taty.info.evil.com', persona), 'formal');
});

test('persona: style guide carries the Nouchi tone and the guardrails', () => {
  const g = internalStyleGuide(persona);
  assert.match(g, /nouchi/i);
  assert.match(g, /Jamais de moquerie/);
  assert.match(g, /sujet est sérieux/);
  assert.match(g, /N’invente rien/);
  assert.doesNotMatch(internalStyleGuide({ ...persona, internal_tone: 'professional' }), /nouchi/i);
});

test('draft: refuses recipients outside the firm and never sends', async () => {
  const deps = { getPersona: async () => persona, runAI: async () => ({ text: 'Objet : On dit quoi la team ?\n\nYa fohi, les pièces Nova arrivent vendredi.' }) };
  await assert.rejects(draftInternalMessage('org-1', { topic: 'Relance', recipients: 'dg@client.com' }, deps), /RECIPIENT_OUTSIDE_FIRM/);
  const d = await draftInternalMessage('org-1', { topic: 'Relance Nova', recipients: 'samira@taty.info' }, deps);
  assert.equal(d.subject, 'On dit quoi la team ?');
  assert.equal(d.sent, false);
  assert.equal(d.from, 'Office Manager TATY <assistant@taty.info>');
  await assert.rejects(draftInternalMessage('org-1', { topic: 'x' }, deps), /TOPIC_REQUIRED/);
  await assert.rejects(draftInternalMessage('org-1', { topic: 'Relance' }, { ...deps, getPersona: async () => presentPersona(null) }), /INTERNAL_DOMAINS_NOT_CONFIGURED/);
  assert.deepEqual(parseDraft('Sans objet'), { subject: 'Message du cabinet', body: 'Sans objet' });
});

test('persona: saved only to the new table, scoped to the organisation', async () => {
  const calls = [];
  const fake = async (path, o = {}) => { calls.push({ path, o }); return [JSON.parse(o.body)[0]]; };
  const p = await savePersona('org-1', { sender_email: 'assistant@taty.info' }, 'Paul', fake);
  assert.equal(p.sending_connected, false);
  assert.match(calls[0].path, /^office_agent_persona\?on_conflict=org_id$/);
  assert.equal(JSON.parse(calls[0].o.body)[0].org_id, 'org-1');
});

test('owner-only settings: pilot token alone is refused', async () => {
  process.env.OFFICE_MANAGER_ACCESS_TOKEN = 'pilot';
  process.env.OFFICE_MANAGER_OWNER_TOKEN = 'owner';
  process.env.DEFAULT_ORG_ID = 'org-1';
  const req = (route, method, headers) => ({ method, query: { route }, body: {}, headers: { 'x-office-manager-token': 'pilot', ...headers } });
  assert.equal(ROUTES['agent-persona'].GET.ownerOnly, true);
  assert.equal(ROUTES.branding.POST.ownerOnly, true);
  assert.ok(!ROUTES.branding.GET.ownerOnly, 'every screen can still read the branding');
  await assert.rejects(handleApp(req('agent-persona', 'GET', {})), /OWNER_ONLY/);
  await assert.rejects(handleApp(req('branding', 'POST', { 'x-office-manager-owner-token': 'wrong' })), /OWNER_ONLY/);
  await assert.rejects(handleApp(req('agent-persona', 'GET', { 'x-office-manager-token': 'bad', 'x-office-manager-owner-token': 'owner' })), /UNAUTHORIZED/);
  delete process.env.OFFICE_MANAGER_OWNER_TOKEN;
  await assert.rejects(handleApp(req('agent-persona', 'GET', { 'x-office-manager-owner-token': 'owner' })), /OWNER_SETTINGS_NOT_CONFIGURED/);
});
