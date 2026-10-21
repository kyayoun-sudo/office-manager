import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createToolRelay} from '../connectors/tool-relay/server.mjs';
import {normalizeDockerOcr} from '../lib/docker-document-ocr.js';
test('relay authenticates first, pins the destination, denies dangerous routes and drops its own key',async t=>{
  const token='synthetic-test-token-'.repeat(3),seen=[];
  const upstream=http.createServer((req,res)=>{seen.push({path:req.url,headers:req.headers});res.end('{"ok":true}');});upstream.listen(0,'127.0.0.1');await once(upstream,'listening');t.after(()=>new Promise(resolve=>upstream.close(resolve)));
  const relay=createToolRelay({token,request:(options,cb)=>{assert.equal(options.hostname,'127.0.0.1');assert.equal(options.port,11434);return http.request({...options,port:upstream.address().port},cb);}});
  relay.listen(0,'127.0.0.1');await once(relay,'listening');t.after(()=>new Promise(resolve=>relay.close(resolve)));
  const root='http://127.0.0.1:'+relay.address().port,headers={'X-Office-Relay-Token':token};
  assert.equal((await fetch(root+'/ollama/api/tags')).status,401);
  assert.equal((await fetch(root+'/ollama/api/pull',{method:'POST',headers})).status,403);
  assert.equal((await fetch(root+'/meilisearch/indexes',{method:'DELETE',headers})).status,403);
  assert.equal((await fetch(root+'/ollama/api/tags',{headers})).status,200);
  assert.equal(seen.length,1);assert.equal(seen[0].path,'/api/tags');assert.equal(seen[0].headers['x-office-relay-token'],undefined);
});
test('docTR must return each original page and confident words; no empty page is invented as blank',()=>{
  const raw=[{items:[{blocks:[{lines:[{words:[{value:'Banque',confidence:.99},{value:'Exemple',confidence:.95}]}]}]}]}];
  assert.equal(normalizeDockerOcr(raw,[17]).pages[0].page,17);assert.equal(normalizeDockerOcr(raw,[17]).pages[0].text,'Banque Exemple');
  assert.throws(()=>normalizeDockerOcr(raw,[17,18]),/PAGE_COUNT/);
  assert.throws(()=>normalizeDockerOcr([{items:[{blocks:[]}]}],[17]),/UNCERTAIN/);
});
