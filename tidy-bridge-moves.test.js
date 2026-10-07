import test from 'node:test';
import assert from 'node:assert/strict';
import { tidyMoveAction } from '../supabase/functions/taty-google-bridge/tidy-moves.ts';

const requestId = '66666666-6666-6666-6666-666666666666';
const itemId = '77777777-7777-7777-7777-777777777777';
function fixture() {
  const item = { status: 'approved', error: 'EN_COURS', file_id: 'doc', current_parent_id: 'ROOT', dest_folder_id: 'templates' };
  const request = { status: 'executing' };
  const file = { id: 'doc', name: 'Synthetic budget.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', driveId: 'ROOT', parents: ['ROOT'] };
  const target = { id: 'templates', mimeType: 'application/vnd.google-apps.folder', driveId: 'ROOT' };
  const moves = [];
  const deps = { orgId: 'org-1', driveId: 'ROOT', getItem: async () => item, getRequest: async () => request,
    getMetadata: async id => id === 'doc' ? file : target,
    move: async (id, from, to) => { moves.push({ id, from, to }); file.parents = file.parents.filter(p => p !== from).concat(to); }
  };
  const body = { org_id: 'org-1', request_id: requestId, item_id: itemId };
  return { item, request, file, target, moves, deps, body };
}
test('bridge moves only the approved internal item and verifies parents, then supports undo to the root', async () => {
  const f = fixture();
  const r = await tidyMoveAction(f.deps, { ...f.body, file_id: 'ATTACKER', dest_folder_id: 'ATTACKER' });
  assert.deepEqual(r.parents, ['templates']);
  assert.deepEqual(f.moves, [{ id: 'doc', from: 'ROOT', to: 'templates' }]);
  Object.assign(f.item, { status: 'moved', previous_parent_id: 'ROOT' });
  await tidyMoveAction(f.deps, { ...f.body, undo: true });
  assert.deepEqual(f.file.parents, ['ROOT']);
});
test('bridge refuses cross-tenant, unapproved, stopped, foreign drive and memory file moves', async () => {
  for (const scenario of ['tenant', 'unapproved', 'stopped', 'foreign', 'memory', 'changed-parent']) {
    const f = fixture();
    if (scenario === 'tenant') f.body.org_id = 'org-2';
    if (scenario === 'unapproved') f.item.status = 'planned';
    if (scenario === 'stopped') f.request.status = 'stopped';
    if (scenario === 'foreign') f.target.driveId = 'foreign';
    if (scenario === 'memory') f.file.name = 'OFFICE_MANAGER_REGISTER.xlsx';
    if (scenario === 'changed-parent') f.file.parents = ['elsewhere'];
    await assert.rejects(tidyMoveAction(f.deps, f.body));
    assert.equal(f.moves.length, 0, scenario);
  }
});
test('bridge requires parent readback and preserves unrelated parents', async () => {
  const f = fixture();
  f.file.parents.push('other-parent');
  await tidyMoveAction(f.deps, f.body);
  assert.deepEqual(f.file.parents, ['other-parent', 'templates']);
  const noMove = fixture();
  noMove.deps.move = async () => {};
  await assert.rejects(tidyMoveAction(noMove.deps, noMove.body), /MOVE_NOT_VERIFIED/);
});
