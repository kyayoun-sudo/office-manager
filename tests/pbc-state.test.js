import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePbcCompleteness, markVerified } from '../lib/pbc-state.js';

const banks = [{id:'SGCI'},{id:'BICICI'},{id:'NSIA'},{id:'ECOBANK'},{id:'BOA'}];

test('one bank statement out of five is PARTIAL, never complete', () => {
  const r = evaluatePbcCompleteness({
    expectedComponents:banks,receivedComponentIds:['SGCI'],populationConfirmed:true
  });
  assert.equal(r.state,'PARTIAL');
  assert.equal(r.received,1);
  assert.equal(r.expected,5);
});

test('unknown population stays POPULATION_TO_CONFIRM', () => {
  const r = evaluatePbcCompleteness({
    expectedComponents:null,receivedComponentIds:['SGCI'],populationConfirmed:false
  });
  assert.equal(r.state,'POPULATION_TO_CONFIRM');
  assert.equal(r.complete,false);
});

test('all documents received still need content verification', () => {
  const r = evaluatePbcCompleteness({
    expectedComponents:banks,receivedComponentIds:banks.map(x => x.id),populationConfirmed:true
  });
  assert.equal(r.state,'RECEIVED');
  assert.equal(r.complete,false);
  const v = markVerified(r,{contentRead:true,allChecksMatch:true});
  assert.equal(v.state,'VERIFIED');
  assert.equal(v.complete,true);
});
