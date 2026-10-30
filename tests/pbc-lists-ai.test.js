import test from 'node:test';
import assert from 'node:assert/strict';
import { findPbcLists, recognizePbcText, tableShaped } from '../lib/pbc-lists.js';

// Plan B5 (2026-10-30): a request list the code's header words miss (other words, another language) is read by the AI,
// which may declare it — header row and columns — through the common brain. Checked by the code; always « à confirmer ».
const LIST = ['Pièces que le client doit nous remettre', 'Ce qu’il faut | Qui | Pour quand | Arrivé ?',
  'Relevés bancaires 2025 | DAF | 15/01 | non', 'Grand livre 2025 | Comptable | 15/01 | oui', 'Contrats fournisseurs | Achats | 20/01 | non',
  'Inventaire de clôture | DAF | 20/01 | non', 'PV de conseil | DG | 31/01 | non'].join('\n');
const registry = () => { let st = { files: {} }; return { get: () => st, load: async () => st, update: async fn => { st = fn(structuredClone(st)); return st; } }; };
const files = [{ id: 'L1', name: 'suivi.xlsx', path: 'Missions/X/suivi.xlsx', mimeType: 'application/vnd.ms-excel', modifiedTime: 't1' }];
const batch = [{ id: 'B', path: 'Missions/X/doc.pdf' }];

test('the code alone does not recognise this list (its header words are others), but it is shaped like a table', () => {
  assert.equal(recognizePbcText(LIST).is_pbc_list, false);
  assert.equal(tableShaped(LIST), true);
});

test('the AI declares it, the code checks the header and the rows: kept « à confirmer »', async () => {
  const reg = registry();
  const think = async ({ actions, read }) => {
    const t = read.tables[0];
    const order = { file_id: t.file_id, header_row: 1, columns: { document: 0, responsible: 1, due: 2, received: 3 } };
    const c = actions.declare_pbc_list.check(order);
    assert.ok(c.ok, c.why);
    await actions.declare_pbc_list.run(c.params);
    return { done: [{}] };
  };
  const out = await findPbcLists(files, batch, async () => LIST, { pbcRegistry: reg, think, pbcPermissions: async () => ({ granted: true }), pbcSearch: async () => [] });
  const rec = reg.get().pbc_lists.L1;
  assert.equal(rec.level, 'ai'); assert.equal(rec.status, 'to_confirm');
  assert.equal(rec.columns.document.label, 'Ce qu’il faut');
  assert.equal(out.missions[0].file_id, 'L1');
});

test('a wrong order is refused by the code (empty column, missing document column, no rows below)', async () => {
  let checks = [];
  const think = async ({ actions, read }) => {
    const id = read.tables[0].file_id;
    checks = [actions.declare_pbc_list.check({ file_id: id, header_row: 1, columns: { document: 9 } }),
      actions.declare_pbc_list.check({ file_id: id, header_row: 1, columns: { reference: 1 } }),
      actions.declare_pbc_list.check({ file_id: id, header_row: 6, columns: { document: 0 } }),
      actions.declare_pbc_list.check({ file_id: 'OTHER', header_row: 1, columns: { document: 0 } })];
    return { done: [] };
  };
  const reg = registry();
  await findPbcLists(files, batch, async () => LIST, { pbcRegistry: reg, think, pbcPermissions: async () => ({ granted: true }), pbcSearch: async () => [] });
  assert.deepEqual(checks.map(c => c.why), ['colonne « document » vide ou absente à cette ligne', 'colonne du document demandé manquante', 'moins de deux lignes de documents sous l’en-tête', 'tableau inconnu']);
  assert.ok(!reg.get().pbc_lists?.L1, 'nothing declared');
});

test('agents not allowed by the firm: the AI is never asked', async () => {
  let asked = false;
  await findPbcLists(files, batch, async () => LIST, { pbcRegistry: registry(), think: async () => { asked = true; return {}; }, pbcPermissions: async () => ({ granted: false }), pbcSearch: async () => [] });
  assert.equal(asked, false);
});
