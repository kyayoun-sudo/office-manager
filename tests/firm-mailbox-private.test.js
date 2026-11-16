// Paul, 2026-11-16 : « les autres utilisateurs voient mes mails ». The mailbox connected in Paramètres is the owner's own
// address: its messages are shown only to that person, never to the other partners or managers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ownsFirmMailbox } from '../lib/mail-triage.js';
import { cockpit } from '../lib/cockpit.js';
import { ROUTES } from '../api/app.js';

test('only the owner of the connected mailbox reads it', () => {
  const box = { email: 'paulkomenan@taty.info' };
  assert.equal(ownsFirmMailbox({ email: 'PaulKomenan@taty.info' }, box), true);
  assert.equal(ownsFirmMailbox({ email: 'stephane@taty.info', role: 'partner' }, box), false);
  assert.equal(ownsFirmMailbox({ email: 'yvan@taty.info' }, null), false);
  assert.equal(ownsFirmMailbox({}, box), false);
});

test('another partner gets nothing from the mailbox route, and the dashboard never includes mails by default', async () => {
  const other = { email: 'stephane@taty.info', role: 'partner' };
  assert.deepEqual(await ROUTES['mail-triage'].GET('org', { account: other }), { items: [], total: 0, private: true });
  assert.throws(() => ROUTES['mail-triage'].POST('org', { account: other, body: { action: 'refresh' } }), /MAILBOX_PRIVATE/);
  let read = 0;
  const drive = { findFilesByExactName: async () => { read++; return []; } };
  const c = await cockpit('org', { fetchRows: async () => [], drive, folder: 'MEM' });
  assert.equal(c.kpis.find(k => k.key === 'mails')?.value ?? 0, 0);
});
