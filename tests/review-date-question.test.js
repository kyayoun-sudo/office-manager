import test from 'node:test';
import assert from 'node:assert/strict';
import { myQuestions } from '../lib/opportunities.js';
import { readFileSync } from 'node:fs';

test('a business date question exposes its Excel input cell to the popup', async () => {
  const state={opportunities:{o1:{id:'o1',title:'TDR',status:'phase0',workbook:{id:'wb'},created_by:'Paul',proposals:{'01_OPPORTUNITE!48':{for_team:true,question:'Date de réception ?'}}}}};
  const drive={findFilesByExactName:async()=>[{id:'memory'}],downloadBuffer:async()=>Buffer.from(JSON.stringify(state))};
  const structure={sheets:[{name:'01_OPPORTUNITE',rows:[{row:48,label:'Date de réception',fields:[{cell:'C48',type:'date',header:'Information à saisir'}]}]}]};
  const result=await myQuestions('org',{role:'owner',display_name:'Paul'},{drive,folder:'MEM',fetchRows:async()=>[],templateStructure:async()=>({structure})});
  const question=result.questions.find(q=>q.kind==='question');
  assert.equal(question.date_cell,'C48');assert.equal(question.note_cell,null);
});

test('popup script remains valid and includes an accessible validated date input', () => {
  const source=readFileSync(new URL('../assets/brand-theme.js',import.meta.url),'utf8');
  new Function(source);
  assert.match(source,/date.type = 'date'/);assert.match(source,/date.setAttribute\('aria-label'/);assert.match(source,/values\[q.date_cell\] = date.value/);
});


test('administrative preparation dates are not presented as additional business questions', async () => {
  const state={opportunities:{o1:{id:'o1',title:'TDR',status:'phase0',workbook:{id:'wb'},proposals:{'01_OPPORTUNITE!48':{for_team:true,question:'Qui est le client ?'}}}}};
  const structure={sheets:[{name:'01_OPPORTUNITE',rows:[{row:48,label:'Client',fields:[{cell:'C48',type:'text',header:'Résultat'},{cell:'L48',type:'date',header:'Date'}]}]}]};
  const drive={findFilesByExactName:async()=>[{id:'memory'}],downloadBuffer:async()=>Buffer.from(JSON.stringify(state))};
  const result=await myQuestions('org',{role:'owner',display_name:'Paul'},{drive,folder:'MEM',fetchRows:async()=>[],templateStructure:async()=>({structure})});
  assert.equal(result.questions[0].date_cell,null);assert.equal(result.questions[0].note_cell,'C48');
});
