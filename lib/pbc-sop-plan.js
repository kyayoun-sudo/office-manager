import { excerptFoundIn, normalizeForMatch } from './mission-engine.js';

// The model interprets the documents; this layer checks its source chain.
export function planPbcFromSops({ programmeText, sops, controls, manager, clientRecipient }) {
  const requests = new Map();
  const review = [];
  for (const control of controls) {
    const sop = sops.find(s => s.file_id === control.sop_file_id);
    const valid = sop && !sop.truncated && sop.supported &&
      normalizeForMatch(sop.cycle) === normalizeForMatch(control.cycle) &&
      excerptFoundIn(control.programme_excerpt, programmeText) &&
      excerptFoundIn(control.sop_excerpt, sop.text) &&
      ['objective_excerpt', 'risk_excerpt', 'assertion_excerpt'].every(k => excerptFoundIn(control[k], sop.text));
    if (!valid || !control.documents.length) {
      review.push({ control: control.name, status: 'SOP_MATCH_REVIEW_REQUIRED' });
      continue;
    }
    for (const document of control.documents) {
      if (!excerptFoundIn(document.sop_excerpt, sop.text)) {
        review.push({ control: control.name, document: document.name, status: 'PBC_SOURCE_REQUIRED' });
        continue;
      }
      const key = `${normalizeForMatch(document.name)}:${document.after_selection ? 'selection' : 'initial'}`;
      const link = { cycle: control.cycle, control: control.name, programme_excerpt: control.programme_excerpt, sop_file_id: sop.file_id, sop_excerpt: control.sop_excerpt, document_excerpt: document.sop_excerpt, objective_excerpt: control.objective_excerpt, risk_excerpt: control.risk_excerpt, assertion_excerpt: control.assertion_excerpt };
      const existing = requests.get(key);
      if (existing) existing.controls.push(link);
      else requests.set(key, { document: document.name, completeness_criteria: document.completeness_criteria, timing: document.after_selection ? 'AFTER_SELECTION' : 'INITIAL', status: document.after_selection ? 'EN ATTENTE SELECTION' : 'A DEMANDER', controls: [link] });
    }
  }
  const items = [...requests.values()];
  const initial = items.filter(i => i.timing === 'INITIAL');
  return {
    status: review.length ? 'REVIEW_REQUIRED' : 'DRAFT_FOR_MANAGER',
    requests: items, review,
    email: { status: 'DRAFT_NOT_SENT', to: manager || null, proposed_client_recipient: clientRecipient || null, requires_manager_approval: true, subject: 'Validation de la demande PBC', body: `Merci de valider la demande des pieces suivantes et le destinataire client avant tout envoi :\n${initial.map(i => `- ${i.document}`).join('\n')}` },
    remote_writes: 0
  };
}
