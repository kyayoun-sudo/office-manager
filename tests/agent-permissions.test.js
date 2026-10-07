import test from 'node:test';
import assert from 'node:assert/strict';
import { grantAgentPermissions, agentPermissions } from '../lib/agent-permissions.js';

const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
const tok = 'a'.repeat(40);

test('owner grants the agents: membership made, grant written WITH the owner session, sends stay off', async () => {
  const rows = [], http = [];
  const fetchRows = async (path, o = {}) => { rows.push([o.method || 'GET', path, o.body]); return path.startsWith('office_processing_permissions') ? [{ inventory_metadata_approved: true, selected_content_approved: true, external_ai_approved: true }] : []; };
  const fetchImpl = async (url, o) => { http.push([url, o]); return { ok: true, text: async () => '' }; };
  const req = { headers: { authorization: 'Bearer ' + tok }, account: { role: 'owner', auth_user_id: 'u1', display_name: 'Paul' } };
  const out = await grantAgentPermissions('org1', req, { fetchRows, fetchImpl, env });
  assert.equal(out.granted, true);
  assert.ok(rows.find(r => r[0] === 'POST' && r[1] === 'office_memberships'));
  assert.equal(http[0][1].headers.Authorization, 'Bearer ' + tok);
  const body = JSON.parse(http[0][1].body)[0];
  assert.equal(body.external_ai_approved, true); assert.equal(body.outbound_messaging_approved, false);
});

test('a collaborator cannot grant; status reads the flags', async () => {
  await assert.rejects(() => grantAgentPermissions('org1', { headers: {}, account: { role: 'collaborator' } }, { env }), /ROLE_NOT_ALLOWED/);
  const s = await agentPermissions('org1', async () => [{ inventory_metadata_approved: true, selected_content_approved: false, external_ai_approved: true }]);
  assert.equal(s.granted, false);
});
