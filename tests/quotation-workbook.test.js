import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { prepareQuotation } from '../lib/quotation-workbook.js';

async function world() {
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Devis');
  const yellow = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
  ws.getCell('B1').fill = yellow; ws.getCell('C1').value = 'Cellule à compléter';
  ws.getCell('B4').value = 'Client'; ws.getCell('C4').fill = yellow;
  ws.getCell('B5').value = 'Tarif validé'; ws.getCell('C5').value = 1000; ws.getCell('C5').fill = yellow;
  ws.getCell('B6').value = 'Jours'; ws.getCell('C6').fill = yellow;
  ws.getCell('C7').value = { formula: 'C5*C6' };
  const original = Buffer.from(await wb.xlsx.writeBuffer());
  const files = new Map([['master', { id: 'master', name: 'Devis.xlsx', buffer: original, parents: ['models'], mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', modifiedTime: 'v1' }]]);
  let copies = 0, writes = 0;
  const drive = {
    getMeta: async id => files.get(id), downloadBuffer: async id => files.get(id).buffer,
    findFilesByExactName: async (name, parent) => [...files.values()].filter(f => f.name === name && f.parents.includes(parent)),
    copyFile: async (id, name, parent) => { copies++; const file = { ...files.get(id), id: 'copy', name, parents: [parent] }; files.set(file.id, file); return file; },
    updateBinary: async (id, input) => { const file = files.get(id); assert.equal(input.expectedModifiedTime, file.modifiedTime); file.buffer = input.buffer; file.modifiedTime = 'v' + (++writes + 1); }
  };
  const d = { drive, permissions: async () => ({ granted: true }), locate: async () => ({ status: 'FOUND', reference: { file_id: 'master' } }), ai: async () => ({ text: JSON.stringify({ writes: [
    { sheet: 'Devis', cell: 'C4', value: 'Client connu', source: 'Dossier' },
    { sheet: 'Devis', cell: 'C5', value: 1, source: 'IA' },
    { sheet: 'Devis', cell: 'C7', value: 99, source: 'IA' },
    { sheet: 'Devis', cell: 'C6', value: 10 }
  ], questions: ['Combien de jours le manager prévoit-il ?'] }) }) };
  return { files, original, d, copies: () => copies };
}
test('quotation fills only empty sourced inputs in one copy, keeping original tariffs and formulas', async () => {
  const w = await world(), o = { id: 'opportunity', client: 'Client connu', folder: { id: 'opp' }, team: { status: 'validated', members: [] } };
  const result = await prepareQuotation('org', o, w.d);
  assert.equal(result.status, 'prepared'); assert.equal(result.written, 1); assert.equal(result.verified, 1);
  assert.deepEqual(w.files.get('master').buffer, w.original);
  const read = new ExcelJS.Workbook(); await read.xlsx.load(w.files.get('copy').buffer);
  const sheet = read.getWorksheet('Devis');
  assert.equal(sheet.getCell('C4').value, 'Client connu'); assert.equal(sheet.getCell('C5').value, 1000);
  assert.equal(sheet.getCell('C6').value, null); assert.equal(sheet.getCell('C7').value.formula, 'C5*C6');
  await prepareQuotation('org', { ...o, quotation: { file: result.file } }, w.d);
  assert.equal(w.copies(), 1);
});
test('missing quotation model asks for location and denied AI permission sends no context', async () => {
  const w = await world(); let called = false;
  const o = { id: 'a', folder: { id: 'opp' } };
  const result = await prepareQuotation('org', o, { ...w.d, locate: async () => ({ status: 'ASK_USER', configuration_href: '/secretariat.html#ref-card' }), ai: async () => { called = true; } });
  assert.equal(result.status, 'needs_file'); assert.equal(called, false); assert.equal(w.copies(), 0);
  await assert.rejects(prepareQuotation('org', o, { ...w.d, permissions: async () => ({ granted: false }), ai: async () => { called = true; } }), /AGENTS_NOT_AUTHORIZED/);
  assert.equal(called, false);
});
test('zero valid writes never reports a prepared budget; existing copy remains accessible', async () => {
 const w=await world();const result=await prepareQuotation('org',{id:'opp',folder:{id:'opp'}},{...w.d,ai:async()=>({text:JSON.stringify({writes:[],questions:['Où renseigner les noms ?']})})});
 assert.equal(result.status,'needs_review');assert.equal(result.written,0);assert.match(result.question,/Aucune cellule/);assert.ok(result.file.url.includes('copy'));assert.deepEqual(w.files.get('master').buffer,w.original);
});
test('pricing workbook without acceptance legend fills validated team dropdowns, preserves all formulas and reference sheets', async () => {
 const w=await world();const wb=new ExcelJS.Workbook();const ws=wb.addWorksheet('Budget');const ref=wb.addWorksheet('Staff');const roles=wb.addWorksheet('Roles');ref.getCell('D1').value={formula:'"Person A"',result:'Person A'};roles.getCell('A1').value='Engagement Manager';
 ws.getCell('J15').value='Collaborateur';ws.getCell('J16').value='Rôle sur la mission';ws.getCell('K15').dataValidation={type:'list',formulae:["Staff!$D$1:$D$1"]};ws.getCell('K16').dataValidation={type:'list',formulae:["Roles!$A$1:$A$1"]};ws.getCell('K19').value={formula:'1000*8'};
 w.files.get('master').buffer=Buffer.from(await wb.xlsx.writeBuffer());const original=w.files.get('master').buffer;
 const result=await prepareQuotation('org',{id:'a',folder:{id:'opp'},team:{status:'validated',members:[{name:'Person A',role:'Manager'}]}},{...w.d,ai:async()=>{throw Error('AI_MUST_NOT_BE_NEEDED');}});
 assert.equal(result.written,2);assert.equal(result.status,'prepared');const back=new ExcelJS.Workbook();await back.xlsx.load(w.files.get('copy').buffer);assert.equal(back.getWorksheet('Budget').getCell('K15').value,'Person A');assert.equal(back.getWorksheet('Budget').getCell('K16').value,'Engagement Manager');assert.equal(back.getWorksheet('Budget').getCell('K19').formula,'1000*8');assert.deepEqual(w.files.get('master').buffer,original);assert.equal(back.getWorksheet('Staff').getCell('D1').formula,'"Person A"');assert.equal(back.getWorksheet('Staff').getCell('D1').result,'Person A');const {describeQuotationInputs}=await import('../lib/quotation-inputs.js');assert.equal((await describeQuotationInputs(w.files.get('copy').buffer)).sheets[0].team_slots.length,1);
});
test('pricing mapper refuses names outside dropdown, protected cells and replacement of an existing human selection',async()=>{
 const {describeQuotationInputs,teamInputWrites}=await import('../lib/quotation-inputs.js');const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('Budget');ws.getCell('J15').value='Collaborateur';ws.getCell('J16').value='Rôle sur la mission';ws.getCell('K15').dataValidation={type:'list',formulae:['"Person A"']};ws.getCell('K16').dataValidation={type:'list',formulae:['"Manager"']};
 const structure=await describeQuotationInputs(Buffer.from(await wb.xlsx.writeBuffer()));
 assert.equal(teamInputWrites(structure,{team:{status:'validated',members:[{name:'Unknown',role:'Manager'}]}},{}).writes.length,0);
 assert.equal(teamInputWrites(structure,{team:{status:'validated',members:[{name:'Person A',role:'Manager'}]}},{'Budget!K15':'Manual choice'}).writes.length,0);
 ws.sheetProtection={sheet:true};const protectedStructure=await describeQuotationInputs(Buffer.from(await wb.xlsx.writeBuffer()));assert.equal(protectedStructure.sheets.length,0);
});
