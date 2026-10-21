import {ocrDocument,toolGatewayEnabled,toolGatewayConfig} from './tool-gateway.js';
export function normalizeDockerOcr(raw,pages){
  if(!Array.isArray(raw))throw Error('DOCTR_RESPONSE_INVALID');
  const records=raw.flatMap(file=>Array.isArray(file.items)?file.items:[]);
  if(records.length!==pages.length)throw Error('DOCTR_PAGE_COUNT_MISMATCH');
  return {pages:records.map((p,i)=>{
    const lines=(p.blocks||[]).flatMap(b=>b.lines||[]),words=lines.flatMap(l=>l.words||[]);
    if(!words.length||words.some(w=>typeof w.value!=='string'||!Number.isFinite(w.confidence)||w.confidence<.5))throw Error('DOCTR_TEXT_UNCERTAIN');
    const text=lines.map(l=>(l.words||[]).map(w=>w.value).join(' ')).join('\n');
    return {page:pages[i],text,complete:true,blank:false,illegible:false};
  })};
}
export async function dockerOcrPages(bytes,pages){
  if(!toolGatewayEnabled()||process.env.DOCTR_OCR_ENABLED!=='true'||!toolGatewayConfig().doctr)return null;
  try{return {text:JSON.stringify(normalizeDockerOcr(await ocrDocument({bytes,filename:'pages.pdf'}),pages))};}
  catch{return null;} // A failed/uncertain local OCR never proves completeness; existing vision retries it.
}
