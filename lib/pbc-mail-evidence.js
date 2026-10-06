import { createHash } from 'node:crypto';
import PDFDocument from 'pdfkit';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// Interpretation is supplied by the agent after reading content, not filenames.
export function planMailEvidence({ message, missionId, knownReferences, matches, evidence }) {
  if (!message.messageId || !message.from || !message.sentAt || !message.bodyText || !missionId) throw new Error('MAIL_PROVENANCE_REQUIRED');
  const extractions = [], review = [], seen = new Set();
  for (const match of matches) {
    const attachment = message.attachments.find(a => a.id === match.attachmentId);
    if (!attachment || !knownReferences.includes(match.reference) || !match.contentChecked || match.missionId !== missionId || !match.rationale) {
      review.push({ attachmentId: match.attachmentId, status: 'REVIEW_REQUIRED' });
      continue;
    }
    const key = `${attachment.id}:${match.reference}`;
    if (!seen.has(key)) extractions.push({ ...match, originalName: attachment.name, status: 'RECEIVED_REVIEW_REQUIRED' });
    seen.add(key);
  }
  for (const a of message.attachments) if (!extractions.some(e => e.attachmentId === a.id)) review.push({ attachmentId: a.id, status: 'UNMATCHED_ATTACHMENT' });
  const archivePdf = Boolean(evidence && ['CONFIRMATION','EXPLANATION','AUDIT_EVIDENCE'].includes(evidence.kind) && evidence.rationale && typeof evidence.excerpt === 'string' && evidence.excerpt.trim().length >= 12 && message.bodyText.includes(evidence.excerpt));
  return { messageId: message.messageId, missionId, idempotencyKey: hash(`${missionId}:${message.messageId}`), extractions, review, archivePdf, evidence: archivePdf ? evidence : null, remoteWrites: 0 };
}

export async function renderAuditMailPdf(message, plan) {
  if (!plan.archivePdf || plan.messageId !== message.messageId) throw new Error('AUDIT_EVIDENCE_REQUIRED');
  const doc = new PDFDocument({ size:'A4', margin:48 });
  const chunks = [];
  const done = new Promise((resolve,reject) => {
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  doc.fontSize(16).text('Audit email evidence').moveDown().fontSize(10);
  for (const [label,value] of Object.entries({ Mission:plan.missionId, 'Message-ID':message.messageId, Thread:message.threadId || '', From:message.from, To:(message.to || []).join(', '), Cc:(message.cc || []).join(', '), Date:message.sentAt, Subject:message.subject || '' })) doc.text(`${label}: ${value}`);
  doc.moveDown().text('Full message body').moveDown().text(message.bodyText);
  doc.moveDown().text('Attachments retained separately:');
  for (const a of message.attachments) doc.text(`${a.name} [${a.id}]`);
  doc.moveDown().text('Readable representation only; not authentication of the sender or an audit conclusion.');
  doc.end();
  return done;
}

export async function prepareMailEvidenceFiles(message, plan, getAttachmentBytes) {
  if (plan.messageId !== message.messageId) throw new Error('MESSAGE_MISMATCH');
  if (plan.archivePdf && !Buffer.isBuffer(message.rawEml)) throw new Error('ORIGINAL_MAIL_REQUIRED');
  const files = [];
  for (const id of new Set(plan.extractions.map(e => e.attachmentId))) {
    const attachment = message.attachments.find(a => a.id === id);
    const buffer = await getAttachmentBytes(id);
    if (!Buffer.isBuffer(buffer) || buffer.length > 10 * 1024 * 1024) throw new Error('ATTACHMENT_BYTES_INVALID');
    files.push({ attachmentId:id, originalName:attachment.name, buffer, sha256:hash(buffer) });
  }
  if (plan.archivePdf) {
    files.push({ name:`${plan.idempotencyKey}.eml`, buffer:message.rawEml, sha256:hash(message.rawEml) });
    const pdf = await renderAuditMailPdf(message,plan);
    files.push({ name:`${plan.idempotencyKey}.pdf`, buffer:pdf, sha256:hash(pdf) });
  }
  return { files, messageId:message.messageId, missionId:plan.missionId, idempotencyKey:plan.idempotencyKey, remoteWrites:0 };
}
