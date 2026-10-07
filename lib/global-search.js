import { rest } from './supabase.js';

// Global search across the firm: Drive documents (Orpailleur inventory),
// missions and people. Read-only: no write, no AI call, no Drive call.
// Private HR data (questionnaires, management profiles) is never searched.

export const SEARCH_SCOPES = Object.freeze(['all', 'documents', 'missions', 'people']);
const MAX_PER_GROUP = 20;

// Keeps letters (accents included), digits, spaces and a few safe separators.
// Characters that carry meaning in PostgREST filters ( , ( ) * . : ) are removed.
export function sanitizeQuery(value) {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s_\-'&]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

export function normalizeScope(value) {
  const scope = String(value || 'all').toLowerCase();
  if (!SEARCH_SCOPES.includes(scope)) {
    throw Object.assign(new Error('INVALID_SCOPE'), { statusCode: 400 });
  }
  return scope;
}

function pattern(term) {
  return encodeURIComponent('*' + term + '*');
}
function orFilter(columns, term) {
  return 'or=(' + columns.map(c => c + '.ilike.' + pattern(term)).join(',') + ')';
}

export function buildSearchPaths(orgId, term) {
  const org = 'org_id=eq.' + encodeURIComponent(orgId);
  return {
    documents: 'orpailleur_inventory?' + org + '&is_folder=eq.false&' +
      orFilter(['name', 'folder_path', 'document_type', 'client_name'], term) +
      '&select=file_id,name,folder_path,web_url,mime_type,modified_at,document_type,client_name,decision_status,office_mission_id' +
      '&order=modified_at.desc&limit=' + MAX_PER_GROUP,
    missions: 'office_missions?' + org + '&' + orFilter(['name', 'mission_code'], term) +
      '&select=id,mission_code,name,status,planned_start,planned_end&order=created_at.desc&limit=' + MAX_PER_GROUP,
    people: 'office_staff_profiles?' + org + '&active=eq.true&' +
      orFilter(['full_name', 'role_title', 'department'], term) +
      '&select=id,full_name,role_title,grade_title,department&order=full_name.asc&limit=' + MAX_PER_GROUP
  };
}

export async function globalSearch(orgId, rawQuery, rawScope = 'all', fetchRows = rest) {
  const query = sanitizeQuery(rawQuery);
  const scope = normalizeScope(rawScope);
  if (query.length < 2) {
    throw Object.assign(new Error('QUERY_TOO_SHORT'), { statusCode: 400 });
  }
  const paths = buildSearchPaths(orgId, query);
  const groups = scope === 'all' ? ['documents', 'missions', 'people'] : [scope];
  const settled = await Promise.allSettled(groups.map(g => fetchRows(paths[g])));
  const results = {};
  const unavailable = [];
  groups.forEach((g, i) => {
    if (settled[i].status === 'fulfilled') results[g] = settled[i].value || [];
    else { results[g] = []; unavailable.push(g); }
  });
  const total = Object.values(results).reduce((n, rows) => n + rows.length, 0);
  return { query, scope, total, results, unavailable, read_only: true };
}
