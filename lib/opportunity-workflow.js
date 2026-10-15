// Commercial progress is separate from acceptance/KYC. Existing statuses and decisions stay intact.
const fold = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function entryKind(value) {
  const s = fold(value);
  if (/\b(ddp|rfp|dp)\b|demande.*proposition|request.*proposal/.test(s)) return 'proposal';
  if (/\bami\b|avis.*manifestation|expression.*interest|manifestation.*interet/.test(s)) return 'ami';
  return 'unknown'; // TDR alone does not tell us which response is requested.
}
export const COMMERCIAL_LABELS = {
  identify: 'Confirmer la réponse attendue', mi_prepare: 'Préparer la manifestation d’intérêt', mi_waiting: 'Attendre la présélection', shortlisted: 'Obtenir la demande de proposition et les TDR',
  proposal_prepare: 'Préparer l’offre technique et financière', proposal_waiting: 'Attendre le résultat de l’offre',
  awarded: 'Finaliser le contrat ou la lettre de mission', lost: 'Dossier non retenu'
};
export function commercialState(o) {
  const kind = o.commercial?.entry_kind || entryKind(o.kind);
  const sent = (o.submissions || []).filter(x => x.status === 'sent');
  const stage = o.commercial?.stage || (o.won ? 'awarded' : sent.some(x => x.kind === 'proposition') ? 'proposal_waiting' : sent.some(x => x.kind === 'mi') ? 'mi_waiting' : kind === 'ami' ? 'mi_prepare' : kind === 'proposal' ? 'proposal_prepare' : 'identify');
  const document_kind = stage === 'mi_prepare' ? 'mi' : stage === 'proposal_prepare' ? 'proposition' : stage === 'awarded' ? 'lettre_mission' : null;
  return { ...(o.commercial || {}), entry_kind: kind, stage, label: COMMERCIAL_LABELS[stage], document_kind,
    href: document_kind ? '/secretariat.html?' + new URLSearchParams({ opportunity_id: o.id, kind: document_kind }) : '/opportunites.html?id=' + encodeURIComponent(o.id),
    awaiting_result: ['mi_waiting', 'proposal_waiting'].includes(stage) };
}
export function sendingProgress(o, sending) {
  const c = commercialState(o);
  if (sending.status !== 'sent' || !sending.proof) return o.commercial;
  const stage = sending.kind === 'mi' && c.stage === 'mi_prepare' ? 'mi_waiting' : sending.kind === 'proposition' && c.stage === 'proposal_prepare' ? 'proposal_waiting' : null;
  if (!stage) return o.commercial;
  return { ...(o.commercial || {}), entry_kind: c.entry_kind, stage, updated_at: sending.recorded_at || sending.sent_at };
}
export function parallelTasks(o) {
  const c = commercialState(o), team = o.team?.members || [];
  const declared = team.filter(m => !m.external && o.declarations?.[(m.email || m.name || '').toLowerCase()]).length;
  const internal = team.filter(m => !m.external).length;
  return [
    { id: 'team', label: 'Examiner l’équipe', state: o.team?.status === 'validated' ? 'Terminé' : 'À examiner', anchor: '#team-card' },
    { id: 'kyc', label: 'Vérifier le client', state: o.kyc_review?.status === 'accepted' ? 'Accepté par une personne' : o.phase1?.status === 'ready' ? 'Préparé — à examiner' : o.phase1?.status === 'preparing' ? 'Recherche en cours' : 'À préparer', anchor: '#kyc-card' },
    { id: 'independence', label: 'Recueillir les déclarations personnelles', state: declared + '/' + internal + ' reçues', anchor: '#team-card' },
    { id: 'documents', label: c.label, state: c.awaiting_result ? 'En attente du client' : 'À traiter', href: c.href },
    { id: 'quotation', label: 'Préparer le classeur de cotation financière', state: o.quotation?.status === 'prepared' ? 'Préparé — à relire' : 'À préparer', anchor: '#quotation-card' }
  ];
}
export function kycSummary(o) {
  const proposals = Object.entries(o.phase1?.proposals || {});
  const answered = new Set((o.answers || []).map(x => x.sheet + '!' + x.row));
  return { prepared: Math.max(Object.values(o.ai_filled || {}).filter(x => x.agent === 'mission-controller').length, Number(o.phase1?.written?.rows) || 0),
    remaining: proposals.filter(([key, p]) => p.for_team && !answered.has(key)).map(([key, p]) => ({ key, question: p.question || p.why || 'Information à compléter' })),
    risks: Object.values(o.phase1?.risk_proposals || {}).length };
}
