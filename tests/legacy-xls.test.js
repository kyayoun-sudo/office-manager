import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { legacySheets } from '../lib/legacy-xls.js';
import { tableImportOptions } from '../lib/workfile-table-import.js';
import { headerRow, tableRole } from '../lib/client-table-understanding.js';
test('real binary XLS GL appears as a source and exposes its actual accounting headers and values', async () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Grand livre 2024'], [], ['Date','Compte','Débit','Crédit'], ['2024-01-01','601',125.5,0], ['2024-01-02','401',0,125.5]]), 'GL');
  const bytes = XLSX.write(book, { type: 'buffer', bookType: 'biff8' });
  assert.equal(bytes.readUInt32LE(0), 0xe011cfd0);
  const sheets = legacySheets(bytes), rows = sheets[0].rows;
  assert.equal(headerRow(rows),2);assert.equal(tableRole(rows[2]),'gl');assert.equal(rows[3][2],125.5);
  const d = { view:async()=>({workpaper:{file_id:'WP'}}), sources:async()=>[{file_id:'GL',name:'02042026 GL AUXIL.2024.xls'},{file_id:'LOCK',name:'~$GL.xls'}], drive:{getMeta:async()=>({name:'GL.xls',size:bytes.length}),downloadBuffer:async()=>bytes} };
  const options = await tableImportOptions('ORG','MISSION','PRJ-01',{sheet:'D1_GL_PROJET',source_file_id:'GL'}, {}, d);
  assert.equal(options.files.length,1);assert.equal(options.files[0].recommended,true);assert.equal(options.sheets[0].role,'gl');assert.equal(options.sheets[0].name,'GL');
});
