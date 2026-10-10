// ONE list of mission statuses for the whole application (2026-10-08: « uniformise les statuts,
// évite que chaque module les interprète différemment »). The status column stays free text and
// existing values are NOT rewritten: older values (active, completed, planned…) are understood
// through LEGACY. New statuses are written only from this list.

export const STATUSES = Object.freeze(['opportunity', 'acceptance', 'planning', 'fieldwork', 'review', 'partner_review', 'report_issued', 'closed', 'archived', 'cancelled']);

export const LABELS = Object.freeze({
  opportunity: 'Opportunité', acceptance: 'Acceptation', planning: 'Planification', fieldwork: 'Terrain', review: 'Revue',
  partner_review: 'Revue associé', report_issued: 'Rapport émis', closed: 'Clôturée', archived: 'Archivée', cancelled: 'Annulée'
});

const LEGACY = Object.freeze({
  active: 'fieldwork', actif: 'fieldwork', en_cours: 'fieldwork', execution: 'fieldwork', in_progress: 'fieldwork', confirmed: 'fieldwork',
  planned: 'planning', planification: 'planning', to_start: 'planning', pending: 'planning', initialisee: 'planning', initialise: 'planning',
  proposal: 'opportunity', prospect: 'opportunity', tender: 'opportunity', draft: 'opportunity',
  won: 'acceptance', accepted: 'acceptance',
  en_revue: 'review', in_review: 'review',
  issued: 'report_issued', rapport_emis: 'report_issued',
  completed: 'closed', complete: 'closed', termine: 'closed', terminee: 'closed', done: 'closed', finished: 'closed', cloturee: 'closed',
  canceled: 'cancelled', annule: 'cancelled', annulee: 'cancelled', merged: 'cancelled',
  archivee: 'archived'
});

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/[\s-]+/g, '_');

// Any stored value → the common status (unknown or empty → fieldwork, as « active » before).
export function canonicalStatus(s) {
  const v = norm(s);
  if (STATUSES.includes(v)) return v;
  return LEGACY[v] || 'fieldwork';
}

export const NOT_STARTED = Object.freeze(['opportunity', 'acceptance', 'planning']);
export const ENDED = Object.freeze(['closed', 'archived', 'cancelled']);
export const isLive = s => !ENDED.includes(canonicalStatus(s));
export const isNotStarted = s => NOT_STARTED.includes(canonicalStatus(s));
export const isClosed = s => canonicalStatus(s) === 'closed';
export const isArchived = s => canonicalStatus(s) === 'archived';
export const isCancelled = s => canonicalStatus(s) === 'cancelled';

// Every stored value that means « ended » (common + older spellings), for database filters.
const variants = targets => [...new Set([...targets, ...Object.entries(LEGACY).filter(([, c]) => targets.includes(c)).map(([k]) => k)])];
export const ENDED_VALUES = Object.freeze(variants(ENDED));
export const ARCHIVED_OR_CANCELLED_VALUES = Object.freeze(variants(['archived', 'cancelled']));

// PostgREST filters. Active context: no closed, archived or cancelled mission.
export const LIVE_FILTER = 'status=not.in.(' + ENDED_VALUES.join(',') + ')';
// Lists where a closed mission is still shown (mission page, search): only archived / cancelled out.
export const NOT_ARCHIVED_FILTER = 'status=not.in.(' + ARCHIVED_OR_CANCELLED_VALUES.join(',') + ')';

// Allowed manual moves (a proposal validated in « À valider »). Archive only after closing.
export function canMove(from, to) {
  const a = canonicalStatus(from), b = canonicalStatus(to);
  if (!STATUSES.includes(to) || a === b) return false;
  if (b === 'archived') return a === 'closed';
  if (a === 'archived') return false;           // an archived mission is reopened by an owner only (outside this flow)
  return true;
}
