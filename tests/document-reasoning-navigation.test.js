import test from 'node:test';
import assert from 'node:assert/strict';
import { reasonWithDocuments } from '../lib/document-reasoning.js';

function harness(replies) {
  const view = {
    workpaper: { file_id: null },
    card: { code: 'TEST-01', steps: [] },
    work: { status: 'to_do', walkthrough: [] },
    mission_id: 'mission-1'
  };
  const queue = [...replies];
  const d = {
    permissions: async () => ({ granted: true }),
    ai: async () => ({ provider: 'test', text: JSON.stringify(queue.shift()) }),
    view: async () => view,
    save: async (_org, _row, changes) => {
      view.work = { ...view.work, ...changes };
      return view.work;
    }
  };
  const run = context => reasonWithDocuments({
    org: 'org-1', mission: 'mission-1', code: 'TEST-01', view,
    documents: [], drive: {}, task: 'test', context,
    schema: 'JSON STRICT', evidenceIds: () => [], body: {}, key: 'test:key', account: { email: 'a@b.c' }
  }, d);
  return { view, run };
}

test('repeated current context offset advances to next unseen window instead of looping', async () => {
  const h = harness([{ context_offset: 0 }]);
  const result = await h.run({ text: 'x'.repeat(65000) });
  assert.equal(result.pending, true);
  const job = h.view.work.walkthrough.find(x => x.kind === 'document-brain');
  assert.equal(job.context_offset, 30000);
  assert.equal(job.no_progress, 0);
  assert.equal(job.feedback.at(-1).refused, 'CONTEXT_OFFSET_ALREADY_VISIBLE');
});

test('repeated current catalog page advances to next unseen page instead of looping', async () => {
  const view = {
    workpaper: { file_id: null }, card: { code: 'TEST-01', steps: [] },
    work: { status: 'to_do', walkthrough: [] }, mission_id: 'mission-1'
  };
  const docs = Array.from({ length: 65 }, (_, i) => ({ id: 'doc-' + i, name: 'Doc ' + i }));
  const d = {
    permissions: async () => ({ granted: true }),
    ai: async () => ({ provider: 'test', text: JSON.stringify({ catalog_page: 0 }) }),
    view: async () => view,
    save: async (_org, _row, changes) => (view.work = { ...view.work, ...changes })
  };
  const result = await reasonWithDocuments({
    org: 'org-1', mission: 'mission-1', code: 'TEST-01', view,
    documents: docs, drive: {}, task: 'test', context: { short: true },
    schema: 'JSON STRICT', evidenceIds: () => [], body: {}, key: 'test:catalog', account: { email: 'a@b.c' }
  }, d);
  assert.equal(result.pending, true);
  const job = view.work.walkthrough.find(x => x.kind === 'document-brain');
  assert.equal(job.page, 1);
  assert.equal(job.feedback.at(-1).refused, 'CATALOG_PAGE_ALREADY_VISIBLE');
});

test('a genuinely complete repeated navigation request stops with AI_NO_PROGRESS', async () => {
  const h = harness([{ context_offset: 0 }, { context_offset: 0 }]);
  const first = await h.run({ short: true });
  assert.equal(first.pending, true);
  const second = await h.run({ short: true });
  assert.equal(second.pending, false);
  assert.match(second.ai_error || '', /AI_NO_PROGRESS/);
});
