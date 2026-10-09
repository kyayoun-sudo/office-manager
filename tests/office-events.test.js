import test from 'node:test';
import assert from 'node:assert/strict';
import { makeOfficeEvent, consumersForEvent } from '../lib/office-events.js';

test('PBC document event routes to Mission Controller and Orpailleur', () => {
  const event = makeOfficeEvent({
    type:'PBC_DOCUMENT_RECEIVED',tenantId:'firm-1',engagementId:'eng-1',
    objectType:'document',objectId:'file-1',payload:{pbc_id:'CASH-004'}
  });
  assert.equal(event.event_type,'PBC_DOCUMENT_RECEIVED');
  assert.deepEqual(consumersForEvent(event.event_type),['mission-controller','orpailleur']);
});

test('event refuses large document payloads', () => {
  assert.throws(() => makeOfficeEvent({
    type:'WP_CHANGED',tenantId:'firm-1',payload:{full_document:'x'.repeat(9000)}
  }), /EVENT_PAYLOAD_TOO_LARGE/);
});
