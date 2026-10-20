import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,PDFRawStream,StandardFonts} from 'pdf-lib';
import {readSopPdf} from '../lib/sop-pdf-reading.js';
import {inspectDocument} from '../lib/document-inspector.js';
import {readerByteLimit} from '../lib/reader-limits.js';

test('a real PDF over 8 MB is accepted and a clause in the middle pages is read',async()=>{
  const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica);
  for(let i=1;i<=12;i++)doc.addPage().drawText(i===7?'Article 7 : Les fonds du projet sont eligibles du 1 janvier au 31 decembre.':`Page ${i} du contrat de financement, texte lisible pour verification.`,{font,size:12});
  doc.context.register(PDFRawStream.of(doc.context.obj({}),new Uint8Array(9*1024*1024)));
  const bytes=Buffer.from(await doc.save({useObjectStreams:false}));assert.ok(bytes.length>8000000);
  const r=await readSopPdf(bytes);
  assert.match(r.text,/Article 7/);assert.equal(r.pages_read.length,12);assert.equal(r.truncated,false);
  let called=false;
  const inspection=await inspectDocument({id:'PDF',mimeType:'application/pdf',size:bytes.length},async()=>{called=true;return r;},{maxChars:60000});
  assert.equal(called,true);assert.equal(inspection.status,'READ_SUCCESS');
  assert.equal(readerByteLimit({mimeType:'application/pdf'}),100*1024*1024);
  assert.equal(readerByteLimit({mimeType:'text/plain'}),8000000);
});

test('scanned pages are isolated, transcribed with original page numbers and marked unverified',async()=>{
  const doc=await PDFDocument.create();doc.addPage();doc.addPage();const bytes=Buffer.from(await doc.save());let calls=0;
  const pdfCache=new Map();
  const options={pdfCache,native:async()=>({text:'',sections:[],total_pages:2,needs_ocr_pages:[1,2],pages_read:[],missing_pages:[1,2],scanned:true}),
    ai:async(providers,o)=>{calls++;assert.equal((await PDFDocument.load(Buffer.from(o.files[0].base64,'base64'))).getPageCount(),2);assert.deepEqual(JSON.parse(o.input).original_pages,[1,2]);return {text:JSON.stringify({pages:[{page:1,text:'Article 1 : Le financement est affecte aux depenses du projet.'},{page:2,text:'Article 2 : Les fonds non utilises doivent etre restitues.'}]})};}};
  const r=await readSopPdf(bytes,options);assert.deepEqual(r.pages_read,[1,2]);assert.deepEqual(r.ocr_pages,[1,2]);assert.equal(r.partial,true);
  assert.equal(r.sections[0].source.unverified,true);
  const verified=await readSopPdf(bytes,{verifyFingerprintOnly:true,ai:()=>{throw new Error('must not rerun OCR');}});
  assert.equal(verified.source_fingerprint,r.source_fingerprint);
  await readSopPdf(bytes,options);assert.equal(calls,1,'identical duplicate documents reuse this preparation’s OCR');
});
