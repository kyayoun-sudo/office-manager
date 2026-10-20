import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { verifyReceivedPiece } from '../lib/mission-quick.js';
const root = {};
vm.runInNewContext(readFileSync(new URL('../assets/procedure-upload.js', import.meta.url), 'utf8'), { window: root, URL });
const upload = root.ProcedureUpload.upload;
const session = { upload_url: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=test' };
const file = size => ({size,name:'convention.pdf',type:'application/pdf',slice:(start,end)=>({start,end})});

test('100 MiB goes straight to Drive in bounded chunks; completion requires a real final receipt', async () => {
  const progress = [], sent = [], size = 100 * 1024 * 1024;
  const receipt = await upload(file(size), {start:async info=>{assert.equal(info.size,size);return session;},
    small:()=>assert.fail('must not base64 encode a large file'), progress:n=>progress.push(n),
    fetch:async (url, req)=>{ sent.push(req); const last=req.body.end===size; return {status:last?200:308,ok:last,
      headers:{get:()=>`bytes=0-${req.body.end-1}`},json:async()=>({id:'FILE',name:'convention.pdf'})}; }});
  assert.equal(receipt.file_id,'FILE'); assert.equal(sent.length,13);
  assert.equal(sent[0].headers['Content-Range'],`bytes 0-8388607/${size}`);
  assert.equal(sent.at(-1).headers['Content-Range'],`bytes 100663296-104857599/${size}`);
  assert.ok(sent.every(r=>r.credentials==='omit' && r.body.end-r.body.start<=8*1024*1024));
  assert.equal(progress.at(-1),100);
});

test('empty, oversized, foreign session URLs and incomplete chunks never report success', async () => {
  await assert.rejects(upload(file(0),{}),/FILE_EMPTY/);
  await assert.rejects(upload(file(100*1024*1024+1),{}),/FILE_TOO_LARGE/);
  await assert.rejects(upload(file(9*1024*1024),{start:async()=>({upload_url:'https://evil.test/upload/drive/v3/files'})}),/INVALID_UPLOAD_SESSION/);
  await assert.rejects(upload(file(9*1024*1024),{start:async()=>session,fetch:async()=>({status:308,headers:{get:()=>null}})}),/UPLOAD_INCOMPLETE/);
  let usedSmall=false; await upload(file(1024),{small:async()=>{usedSmall=true;return {};}});assert.equal(usedSmall,true);
});

test('a direct upload must be verified inside this mission before attachment', async () => {
  const d={fetchRows:async()=>[{id:'M',drive_folder_id:'MISSION'}],
    tidy:{findOrCreateFolder:async()=>({id:'RECEIVED'})},
    drive:{getMeta:async()=>({name:'real.pdf',parents:['RECEIVED'],size:100*1024*1024})}};
  assert.equal((await verifyReceivedPiece('O','M','FILE',d)).name,'real.pdf');
  d.drive.getMeta=async()=>({name:'other.pdf',parents:['OTHER'],size:100});
  await assert.rejects(verifyReceivedPiece('O','M','FOREIGN',d),/PIECE_NOT_VERIFIED/);
  d.drive.getMeta=async()=>({parents:['RECEIVED'],size:100*1024*1024+1});
  await assert.rejects(verifyReceivedPiece('O','M','BIG',d),/FILE_TOO_LARGE/);
});
