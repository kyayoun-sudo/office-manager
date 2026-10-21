import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestColumn,headerRow,tableRole,sourceSuggestions} from '../lib/client-table-understanding.js';
import {validateFindings} from '../lib/sop-document-work.js';
test('GL columns use accounting synonyms without guessing ambiguous references',()=>{
  const columns=['Date comptable','Numéro compte','Montant débit','Montant crédit','Libellé écriture'];
  assert.equal(suggestColumn('Date',columns),0);assert.equal(suggestColumn('Compte',columns),1);
  assert.equal(suggestColumn('Débit',columns),2);assert.equal(suggestColumn('Crédit',columns),3);
  assert.equal(suggestColumn('Pièce / référence',['Pièce','Référence']),null);
  assert.equal(suggestColumn('Libellé', ['Libellé de l’écriture']), 0);
  assert.equal(suggestColumn('Compte', ['Numéro de compte']), 0);
  assert.equal(tableRole(columns),'gl');assert.equal(tableRole(['Catégorie budgétaire','Budget approuvé']),'budget');
});
test('a title page does not become the GL header and a budget is not the default GL source',()=>{
  assert.equal(headerRow([['Projet','Année','Client'],[],['Date','Compte','Débit','Crédit'],['2024',601,100,0]]),2);
  const files=sourceSuggestions([{name:'PTBA Budget.xlsx',file_id:'B'},{name:'GL 2023.xlsx',file_id:'G1'},{name:'GL 2024.xlsx',file_id:'G2'}],'D1_GL_PROJET');
  assert.equal(files[0].recommended,true);assert.equal(files.find(f=>f.file_id==='B').incompatible,true);
  assert.equal(files.filter(f=>f.recommended).length,2,'both years remain choices, no arbitrary GL selected');
});
test('a donor name is proposed only with a verified literal quote and a permitted destination',()=>{
  const quote='Le bailleur du projet est la Banque Exemple.',docs=[{file_id:'DOC',name:'Accord',text:quote}],map={targets:['PG0!C5']};
  const draft={fact:'Bailleur identifié : Banque Exemple',value:'Banque Exemple',file_id:'DOC',quote,target:'PG0!C5'};
  assert.equal(validateFindings([draft],docs,map).findings[0].value,'Banque Exemple');
  assert.equal(validateFindings([{...draft,value:'Bailleur inventé'}],docs,map).findings.length,0);
  assert.equal(validateFindings([{...draft,target:'PG0!X99'}],docs,map).findings[0].target,null);
});
