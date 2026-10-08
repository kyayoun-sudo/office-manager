import { rest } from './supabase.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { loadScan } from './mapping-scan.js';
import { firstAvailable, parseJsonLoose } from './ai-plus.js';
import { engagementMissions, engagementState } from './engagement-prep.js';
import { auditorState } from './enhanced-auditor.js';
import { missionDocuments } from './mission-files.js';

// WORK FILES IN EXCEL — the Office Manager panel inside Excel (branch « amelioration »,
// Paul 2026-10-08). The team opens its work files from Google Drive for desktop, works, saves.
// The panel (excel/taskpane.html) is in the open Excel, so it can:
//   - say which file is open, by whom, for which mission, and when someone actually works on it
//     (sessions, heartbeat every 2 minutes) → actual time per mission, overlaps, files that stall;
//   - have the Enhanced Auditor review the open sheet or workbook, with the mission's risks, and
//     write the remarks INTO the file (« Revue IA » sheet + cell comments) from the user's own Excel
//     (no conflict of versions); remarks are answered there and are also in the application;
//   - save and close a file left open overnight, after its user said yes in the application:
//     the Orpailleur notices it and proposes « veux-tu que je l'enregistre et le ferme ? ».
// What is measured is told to the team; time is a process indicator (budget, files that stall),
// never minute-by-minute surveillance.

const q = encodeURIComponent;
const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });
const BEAT_MAX = 180;                 // seconds counted at most between two beats
const ALIVE_MS = 15 * 60 * 1000;      // panel considered alive if seen within 15 minutes
export const IDLE_MS = 3 * 3600 * 1000; // no activity for 3 hours: « left open »
const SEV = { haute: 'high', élevée: 'high', high: 'high', moyenne: 'medium', medium: 'medium', faible: 'low', basse: 'low', low: 'low' };
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const words = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !/^(audit|mission|missions|des|les|pour|and|the|drive|partages|shared|drives|mon|my)$/.test(w));
const tableMissing = e => /42P01|does not exist|office_workfile/.test(String(e.message || e)) ? fail('WORKFILE_TABLES_MISSING', 503) : e;

async function session(orgId, clientSession, fetchRows) {
  return (await fetchRows('office_workfile_sessions?org_id=eq.' + q(orgId) + '&client_session=eq.' + q(clientSession) + '&select=*&limit=1'))?.[0] || null;
}

// Which Drive file and which mission, from the file name and the path on the computer
// (G:\Drive partagés\TATY\01_CLIENTS\Mines du Sud\CAC 2026\WP_stocks.xlsx).
export function identify(fileName, localPath, items, missions) {
  const name = String(fileName || '').split(/[\\/]/).pop();
  const segs = String(localPath || '').split(/[\\/]/).filter(Boolean).map(s => s.toLowerCase());
  const candidates = (items || []).filter(i => i.name === name);
  const score = i => { const p = String(i.path || '').toLowerCase().split('/').filter(Boolean); let k = 0; for (let a = p.length - 1, b = segs.length - 1; a >= 0 && b >= 0 && p[a] === segs[b]; a--, b--) k++; return k; };
  const file = candidates.sort((a, b) => score(b) - score(a))[0] || null;
  const pathWords = new Set(words((file?.path || '') + ' ' + localPath));
  const ranked = (missions || []).map(m => { const mw = words(m.name + ' ' + (m.mission_code || '')); const hit = mw.filter(w => pathWords.has(w)).length; return { m, hit, all: mw.length && hit === mw.length }; })
    .filter(x => x.hit > 0).sort((a, b) => (b.all - a.all) || (b.hit - a.hit));
  const sure = ranked[0] && (ranked[0].all || ranked[0].hit >= 2) && !(ranked[1] && ranked[1].hit === ranked[0].hit);
  return { file_id: file?.id || null, drive_path: file?.path || null, mission: sure ? { id: ranked[0].m.id, name: ranked[0].m.name } : null,
    mission_candidates: ranked.slice(0, 5).map(x => ({ id: x.m.id, name: x.m.name })) };
}

export async function startSession(orgId, account, body = {}, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const cs = String(body.session || '');
  if (cs.length < 8) throw fail('SESSION_ID_REQUIRED');
  const name = String(body.file_name || '').slice(0, 300);
  if (!name) throw fail('FILE_NAME_REQUIRED');
  const { state: scan } = await loadScan(d.drive || driveAdapter, d.folder || memoryFolderId()).catch(() => ({ state: null }));
  const missions = await (d.engagementMissions || engagementMissions)(orgId, d).catch(() => []);
  const who = identify(name, body.path, scan?.items || [], missions);
  const missionId = ID.test(body.mission_id || '') ? body.mission_id : who.mission?.id || null;
  const row = { org_id: orgId, client_session: cs, user_email: account?.email || null, user_name: account?.display_name || account?.email || null,
    file_id: who.file_id, file_name: name, file_path: String(body.path || '').slice(0, 1000) || null, mission_id: missionId };
  await fetchRows('office_workfile_sessions?on_conflict=org_id,client_session', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([row]) }).catch(e => { throw tableMissing(e); });
  return { ...who, mission_id: missionId, missions: missions.map(m => ({ id: m.id, name: m.name })) };
}

// Heartbeat: active time counted only when the person did something since the previous beat.
export async function beat(orgId, account, body = {}, d = {}) {
  const fetchRows = d.fetchRows || rest, now = d.now ? d.now() : new Date();
  const s = await session(orgId, String(body.session || ''), fetchRows).catch(e => { throw tableMissing(e); });
  if (!s) throw fail('SESSION_NOT_FOUND', 404);
  const since = Math.max(0, Math.round((now - new Date(s.last_seen_at)) / 1000));
  const patch = { last_seen_at: now.toISOString() };
  if (body.active) { patch.last_activity_at = now.toISOString(); patch.active_seconds = (s.active_seconds || 0) + Math.min(since, BEAT_MAX); }
  if (Number(body.edits) > 0) patch.edits = (s.edits || 0) + Math.min(10000, Number(body.edits));
  if (typeof body.dirty === 'boolean') patch.dirty = body.dirty;
  if (ID.test(body.mission_id || '')) patch.mission_id = body.mission_id;
  if (s.closed_at) { patch.closed_at = null; patch.close_reason = null; }   // the panel came back (PC woke up)
  await fetchRows('office_workfile_sessions?org_id=eq.' + q(orgId) + '&id=eq.' + q(s.id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
  return { ok: true, save_close: Boolean(s.save_close_requested), active_seconds: patch.active_seconds ?? s.active_seconds };
}

export async function endSession(orgId, body = {}, d = {}) {
  const fetchRows = d.fetchRows || rest, now = new Date().toISOString();
  const s = await session(orgId, String(body.session || ''), fetchRows);
  if (!s) return { ok: true };
  const reason = body.reason === 'saved_closed' ? 'saved_closed' : 'closed';
  await fetchRows('office_workfile_sessions?org_id=eq.' + q(orgId) + '&id=eq.' + q(s.id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ closed_at: now, close_reason: reason, save_close_requested: false }) });
  if (reason === 'saved_closed' && s.save_close_action_id) {
    await fetchRows('office_action_queue?org_id=eq.' + q(orgId) + '&id=eq.' + q(s.save_close_action_id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ work_state: 'executed', executed_at: now }) }).catch(() => null);
  }
  return { ok: true };
}

// ---- Files left open: noticed at each scheduler tick (and the Orpailleur's passes) ----
export async function checkIdleWorkfiles(orgId, d = {}) {
  const fetchRows = d.fetchRows || rest, now = d.now ? d.now() : new Date();
  let open;
  try { open = await fetchRows('office_workfile_sessions?org_id=eq.' + q(orgId) + '&closed_at=is.null&select=id,user_email,user_name,file_name,mission_id,last_seen_at,last_activity_at,dirty,save_close_requested,save_close_action_id&limit=500') || []; }
  catch { return { checked: false, reason: 'tables_missing' }; }
  let proposed = 0, timedOut = 0;
  for (const s of open) {
    const seen = now - new Date(s.last_seen_at), idle = now - new Date(s.last_activity_at);
    if (seen > ALIVE_MS) {   // Excel closed or the computer asleep: the panel no longer answers
      await fetchRows('office_workfile_sessions?org_id=eq.' + q(orgId) + '&id=eq.' + q(s.id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ closed_at: s.last_seen_at, close_reason: 'timeout' }) }).catch(() => null);
      timedOut++; continue;
    }
    if (idle < IDLE_MS || s.save_close_requested || s.save_close_action_id) continue;
    const hours = Math.round(idle / 3600000);
    const rows = await fetchRows('office_action_queue?on_conflict=org_id,idempotency_key', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify([{ org_id: orgId, agent_key: 'orpailleur', action_type: 'WORKFILE_SAVE_CLOSE', office_mission_id: s.mission_id || null, status: 'proposed', work_state: 'requested', requested_at: now.toISOString(),
        idempotency_key: 'workfile-idle:' + s.id,
        summary: ((s.user_name || 'Quelqu’un') + ' a laissé « ' + s.file_name + ' » ouvert dans Excel, sans activité depuis ' + hours + ' h. Veux-tu que je l’enregistre et le ferme ?').slice(0, 500),
        payload: { session_id: s.id, user_email: s.user_email, user_name: s.user_name, file_name: s.file_name, idle_hours: hours, dirty: s.dirty ?? null },
        evidence: { source: 'panneau Excel', last_activity_at: s.last_activity_at } }]) }).catch(() => []);
    if (rows?.[0]?.id) {
      await fetchRows('office_workfile_sessions?org_id=eq.' + q(orgId) + '&id=eq.' + q(s.id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ save_close_action_id: rows[0].id }) }).catch(() => null);
      proposed++;
    }
  }
  return { checked: true, open: open.length, proposed, timed_out: timedOut };
}

// The proposals that concern me (my files left open), and my answer — also from my phone.
export async function myWorkfileActions(orgId, account, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const rows = await fetchRows('office_action_queue?org_id=eq.' + q(orgId) + '&action_type=eq.WORKFILE_SAVE_CLOSE&status=in.(proposed,awaiting_approval)&select=id,summary,payload,requested_at&order=requested_at.desc&limit=50') || [];
  const me = String(account?.email || '').toLowerCase();
  return { actions: rows.filter(r => String(r.payload?.user_email || '').toLowerCase() === me) };
}

export async function decideWorkfileAction(orgId, account, body = {}, d = {}) {
  const fetchRows = d.fetchRows || rest, now = new Date().toISOString();
  const [a] = await fetchRows('office_action_queue?org_id=eq.' + q(orgId) + '&id=eq.' + q(String(body.action_id || '')) + '&action_type=eq.WORKFILE_SAVE_CLOSE&select=id,status,payload&limit=1') || [];
  if (!a) throw fail('ACTION_NOT_FOUND', 404);
  const mine = String(a.payload?.user_email || '').toLowerCase() === String(account?.email || '').toLowerCase();
  if (!mine && !['owner', 'partner', 'manager'].includes(account?.role)) throw fail('ROLE_NOT_ALLOWED', 403);
  if (!['proposed', 'awaiting_approval'].includes(a.status)) return { done: false, effect: 'Déjà décidé.' };
  const yes = body.decision === 'approve';
  await fetchRows('office_action_queue?org_id=eq.' + q(orgId) + '&id=eq.' + q(a.id), { method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(yes ? { status: 'approved', approved_at: now, work_state: 'requested' } : { status: 'rejected' }) });
  if (yes) await requestSaveClose(orgId, a.payload?.session_id, fetchRows);
  return { done: true, effect: yes ? 'Le panneau Excel enregistre et ferme le fichier dès qu’il répond (ordinateur allumé).' : 'Le fichier reste ouvert.' };
}

export async function requestSaveClose(orgId, sessionId, fetchRows = rest) {
  if (!sessionId) return;
  await fetchRows('office_workfile_sessions?org_id=eq.' + q(orgId) + '&id=eq.' + q(sessionId), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ save_close_requested: true }) });
}

// ---- Review of the open workbook by the Enhanced Auditor ----
const BENFORD = [0, 30.1, 17.6, 12.5, 9.7, 7.9, 6.7, 5.8, 5.1, 4.6];
const colName = n => { let s = ''; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const colIndex = s => String(s).toUpperCase().split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;

// Patterns computed on the grid read by the panel (values + formulas), like workbookPatterns.
export function gridPatterns(sheets) {
  return (sheets || []).map(sh => {
    const [, c0 = 'A', r0 = '1'] = String(sh.address || 'A1').split('!').pop().match(/^\$?([A-Z]+)\$?(\d+)/i) || [];
    const base = { c: colIndex(c0), r: Number(r0) };
    const nums = [], cols = {};
    let formulas = 0, errors = 0, external = 0;
    (sh.values || []).forEach((row, i) => row.forEach((v, j) => {
      const f = sh.formulas?.[i]?.[j];
      const at = colName(base.c + j) + (base.r + i);
      const col = (cols[j] ||= { formulas: 0, hard: 0, cells: [] });
      if (typeof f === 'string' && f.startsWith('=')) { formulas++; col.formulas++; if (/\[[^\]]+\.xls/i.test(f)) external++; }
      else if (typeof v === 'number') { col.hard++; if (col.cells.length < 8) col.cells.push(at); }
      if (typeof v === 'string' && /^#(REF!|DIV\/0!|N\/A|VALUE!|NAME\?|NUM!)/.test(v)) errors++;
      if (typeof v === 'number') nums.push({ v, at });
    }));
    const big = nums.filter(n => Math.abs(n.v) >= 100);
    const count = {}; for (const n of big) count[n.v] = (count[n.v] || 0) + 1;
    const first = Array(10).fill(0); for (const n of big) { const g = Number(String(Math.abs(n.v)).replace(/^0+\.?0*/, '')[0]); if (g >= 1) first[g]++; }
    const total = first.reduce((a, b) => a + b, 0);
    const mad = total >= 100 ? Math.round(first.slice(1).reduce((s, k, i) => s + Math.abs(100 * k / total - BENFORD[i + 1]), 0) / 9 * 100) / 100 : null;
    return { sheet: sh.name, numbers: nums.length, formulas, errors, external_links: external,
      hard_coded_in_computed_columns: Object.entries(cols).filter(([, x]) => x.formulas >= 5 && x.hard > 0 && x.hard <= x.formulas / 3).map(([j, x]) => ({ column: colName(base.c + Number(j)), cells: x.cells })).slice(0, 10),
      round_thousands_pct: big.length ? Math.round(100 * big.filter(n => Math.abs(n.v) % 1000 === 0).length / big.length) : null,
      repeated_amounts: Object.entries(count).filter(([, k]) => k >= 3).map(([v, k]) => ({ value: Number(v), times: k })).slice(0, 8),
      benford_mad_pct: mad };
  });
}

const REVIEW = `Tu es l'Enhanced Auditor. Tu relis un fichier de travail d'audit OUVERT dans Excel par un collaborateur, avec le contexte de la mission (risques du Grand Contrôleur et de l'auditeur, couverture déjà évaluée, documents rattachés) et les motifs calculés sur les cellules.
Écris des remarques de revue comme un manager d'audit : précises, actionnables, rattachées à une feuille et une cellule (ou une plage). Couvre : erreurs et incohérences (totaux, formules, liens, chiffres saisis en dur dans des colonnes calculées), procédures manquantes au regard des risques, éléments probants insuffisants ou non référencés, conclusion absente ou non étayée, références croisées manquantes.
Ne modifie rien, ne conclus pas à la place de l'auditeur, ne répète pas une remarque. Au plus 25 remarques, les plus importantes d'abord.
JSON STRICT : {"remarks":[{"sheet":"","cell":"A1","remark":"","severity":"haute|moyenne|faible"}],"summary":""}`;

export async function reviewWorkbook(orgId, account, body = {}, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const sheets = (Array.isArray(body.sheets) ? body.sheets : []).slice(0, 12).map(s => ({ name: String(s.name || '').slice(0, 120), address: String(s.address || 'A1'),
    values: (s.values || []).slice(0, 400).map(r => (r || []).slice(0, 60)), formulas: (s.formulas || []).slice(0, 400).map(r => (r || []).slice(0, 60)) }));
  if (!sheets.length) throw fail('SHEETS_REQUIRED');
  const fileName = String(body.file_name || 'Classeur').slice(0, 300);
  const missionId = ID.test(body.mission_id || '') ? body.mission_id : null;
  const patterns = gridPatterns(sheets);
  let context = {};
  if (missionId) {
    const [eng, aud, docs] = await Promise.all([(d.engagementState || engagementState)(missionId, d).catch(() => ({})), (d.auditorState || auditorState)(missionId, d).catch(() => ({})), (d.missionDocuments || missionDocuments)(missionId, d).catch(() => [])]);
    context = { risk_brief: String(eng.risk_brief?.text || '').slice(0, 8000), coverage: (aud.coverage || []).map(c => ({ risk: c.risk, level: c.level, verdict: c.verdict, missing: c.missing_procedures })), documents: docs.slice(0, 15).map(x => ({ name: x.name, role: x.role, summary: x.summary })) };
  }
  const grid = sheets.map(s => '### Feuille « ' + s.name + ' » (à partir de ' + s.address.split('!').pop().split(':')[0] + ')\n' +
    s.values.map((r, i) => r.map((v, j) => { const f = s.formulas[i]?.[j]; return typeof f === 'string' && f.startsWith('=') ? '{' + f + '}=' + v : v; }).join('\t')).join('\n')).join('\n\n').slice(0, 120000);
  const r = await (d.ai || firstAvailable)(['anthropic', 'openai', 'gemini'], { instructions: REVIEW, maxTokens: 8000,
    input: 'FICHIER : ' + fileName + '\nCONTEXTE DE LA MISSION : ' + JSON.stringify(context).slice(0, 30000) + '\n\nMOTIFS CALCULÉS : ' + JSON.stringify(patterns) + '\n\nCONTENU (les formules entre accolades) :\n' + grid });
  const out = parseJsonLoose(r.text);
  const remarks = (out.remarks || []).slice(0, 25).map(x => ({ org_id: orgId, file_id: body.file_id || null, file_name: fileName, mission_id: missionId,
    sheet: String(x.sheet || '').slice(0, 120) || null, cell: String(x.cell || '').replace(/\$/g, '').slice(0, 40) || null, remark: String(x.remark || '').slice(0, 4000),
    severity: SEV[String(x.severity || '').toLowerCase()] || 'medium', source: 'enhanced-auditor', author: 'Enhanced Auditor (' + r.provider + ')', status: 'open' })).filter(x => x.remark);
  let saved = remarks;
  if (remarks.length) saved = await fetchRows('office_workfile_remarks', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(remarks) }).catch(e => { throw tableMissing(e); }) || remarks;
  return { summary: out.summary || '', remarks: saved, patterns, reviewed_by: r.provider };
}

// Remarks of a file (panel) or of a mission (application).
export async function listRemarks(orgId, query = {}, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const filter = query.file_id ? '&file_id=eq.' + q(query.file_id) : query.mission_id && ID.test(query.mission_id) ? '&mission_id=eq.' + q(query.mission_id) : query.file_name ? '&file_name=eq.' + q(query.file_name) : null;
  if (!filter) throw fail('FILE_OR_MISSION_REQUIRED');
  const rows = await fetchRows('office_workfile_remarks?org_id=eq.' + q(orgId) + filter + '&select=*&order=created_at.desc&limit=300').catch(e => { throw tableMissing(e); });
  return { remarks: rows || [] };
}

export async function updateRemark(orgId, account, body = {}, d = {}) {
  const fetchRows = d.fetchRows || rest, now = new Date().toISOString();
  const id = String(body.remark_id || '');
  if (!ID.test(id)) throw fail('VALID_REMARK_ID_REQUIRED');
  const patch = {};
  if (body.written) patch.written_in_file_at = now;
  if (body.reply) { patch.reply = String(body.reply).slice(0, 4000); patch.replied_by = account?.display_name || account?.email || null; patch.replied_at = now; patch.status = 'answered'; }
  if (body.status === 'closed') patch.status = 'closed';
  if (!Object.keys(patch).length) throw fail('NOTHING_TO_UPDATE');
  await fetchRows('office_workfile_remarks?org_id=eq.' + q(orgId) + '&id=eq.' + q(id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
  return { ok: true };
}

// ---- Indicators: actual time per mission, overlaps, files that stall ----
const day = iso => String(iso || '').slice(0, 10);
export function workfileKpisFrom({ sessions, staff, assignments, missions }, now = new Date(), days = 30) {
  const since = now - days * 86400000;
  const recent = (sessions || []).filter(s => new Date(s.started_at) >= since);
  const mName = new Map((missions || []).map(m => [m.id, m.name]));
  const who = s => s.user_name || s.user_email || 'Inconnu';
  const hours = sec => Math.round(sec / 360) / 10;
  const add = (map, k, f) => { const e = map.get(k) || f(); map.set(k, e); return e; };
  const perPerson = new Map(), perMission = new Map(), perFile = new Map(), perPersonDay = new Map(), perFileDay = new Map();
  for (const s of recent) {
    const sec = s.active_seconds || 0;
    const p = add(perPerson, who(s), () => ({ person: who(s), email: s.user_email, seconds: 0, files: new Set(), missions: new Set(), days: new Set() }));
    p.seconds += sec; p.files.add(s.file_name); if (s.mission_id) p.missions.add(s.mission_id); p.days.add(day(s.started_at));
    const m = add(perMission, s.mission_id || 'none', () => ({ mission_id: s.mission_id || null, mission: mName.get(s.mission_id) || (s.mission_id ? 'Mission' : 'Sans mission'), seconds: 0, people: new Set(), last: null }));
    m.seconds += sec; m.people.add(who(s)); m.last = !m.last || s.last_activity_at > m.last ? s.last_activity_at : m.last;
    const f = add(perFile, s.file_id || s.file_name, () => ({ file: s.file_name, mission: mName.get(s.mission_id) || null, seconds: 0, people: new Set(), sessions: 0, last: null }));
    f.seconds += sec; f.people.add(who(s)); f.sessions++; f.last = !f.last || s.last_activity_at > f.last ? s.last_activity_at : f.last;
    if (s.mission_id && sec > 0) add(perPersonDay, who(s) + '|' + day(s.started_at), () => new Set()).add(s.mission_id);
    add(perFileDay, (s.file_id || s.file_name) + '|' + day(s.started_at), () => []).push(s);
  }
  const overlaps = [];
  // Several missions the same day for one person (switching cost, real load).
  for (const [k, set] of perPersonDay) if (set.size >= 2) { const [person, d0] = k.split('|'); overlaps.push({ type: 'plusieurs missions le même jour', person, day: d0, missions: [...set].map(id => mName.get(id) || id) }); }
  // Several people on the same file the same day, at overlapping times (risk of conflicting copies).
  for (const [k, list] of perFileDay) {
    const people = [...new Set(list.map(who))];
    if (people.length < 2) continue;
    const clash = list.some((a, i) => list.some((b, j) => j > i && who(a) !== who(b) && new Date(a.started_at) <= new Date(b.last_seen_at) && new Date(b.started_at) <= new Date(a.last_seen_at)));
    if (clash) overlaps.push({ type: 'même fichier ouvert en même temps', file: list[0].file_name, day: k.split('|')[1], people });
  }
  // Planned (assignments) versus actual (time in the files).
  const today = day(now.toISOString()), week = now - 7 * 86400000;
  const staffById = new Map((staff || []).map(s => [s.id, s]));
  const activeByEmailMission = new Set(recent.filter(s => new Date(s.last_activity_at) >= week && s.active_seconds > 0).map(s => String(s.user_email || '').toLowerCase() + '|' + s.mission_id));
  const users = new Set(recent.map(s => String(s.user_email || '').toLowerCase()));
  const plannedNoWork = (assignments || []).filter(a => a.planned_start <= today && a.planned_end >= today && !['rejected', 'cancelled', 'completed'].includes(a.status))
    .map(a => ({ a, s: staffById.get(a.staff_profile_id) })).filter(x => x.s?.email && users.has(String(x.s.email).toLowerCase()) && !activeByEmailMission.has(String(x.s.email).toLowerCase() + '|' + x.a.office_mission_id))
    .map(x => ({ person: x.s.full_name, mission: mName.get(x.a.office_mission_id) || 'Mission', role: x.a.mission_role }));
  const assigned = new Set((assignments || []).map(a => String(staffById.get(a.staff_profile_id)?.email || '').toLowerCase() + '|' + a.office_mission_id));
  const workNoPlan = [...new Map(recent.filter(s => s.mission_id && s.active_seconds > 600 && !assigned.has(String(s.user_email || '').toLowerCase() + '|' + s.mission_id))
    .map(s => [who(s) + '|' + s.mission_id, { person: who(s), mission: mName.get(s.mission_id) || 'Mission' }])).values()];
  const stalled = [...perFile.values()].filter(f => f.last && now - new Date(f.last) > 7 * 86400000).map(f => ({ file: f.file, mission: f.mission, last: f.last }));
  return {
    period_days: days,
    people: [...perPerson.values()].map(p => ({ person: p.person, hours: hours(p.seconds), files: p.files.size, missions: p.missions.size, days: p.days.size })).sort((a, b) => b.hours - a.hours),
    missions: [...perMission.values()].map(m => ({ mission_id: m.mission_id, mission: m.mission, hours: hours(m.seconds), people: [...m.people], last_activity: m.last })).sort((a, b) => b.hours - a.hours),
    files: [...perFile.values()].map(f => ({ file: f.file, mission: f.mission, hours: hours(f.seconds), people: [...f.people], sessions: f.sessions, last_activity: f.last })).sort((a, b) => b.hours - a.hours).slice(0, 50),
    overlaps: overlaps.slice(0, 50), planned_without_work: plannedNoWork.slice(0, 50), work_without_assignment: workNoPlan.slice(0, 50), stalled_files: stalled.slice(0, 30),
    coverage: 'Temps actif mesuré par le panneau Office Manager dans Excel (activité constatée entre deux signaux de 2 minutes), seulement pour les personnes qui l’utilisent. Repère pour le processus et le budget des missions, pas une surveillance.'
  };
}

export async function workfileKpis(orgId, d = {}) {
  const fetchRows = d.fetchRows || rest, org = 'org_id=eq.' + q(orgId);
  const since = new Date(Date.now() - 31 * 86400000).toISOString();
  const [sessions, staff, assignments, missions] = await Promise.all([
    fetchRows('office_workfile_sessions?' + org + '&started_at=gte.' + q(since) + '&select=*&limit=5000').catch(e => { throw tableMissing(e); }),
    fetchRows('office_staff_profiles?' + org + '&active=eq.true&select=id,full_name,email&limit=500'),
    fetchRows('office_mission_assignments?' + org + '&select=office_mission_id,staff_profile_id,mission_role,planned_start,planned_end,status&limit=2000'),
    fetchRows('office_missions?' + org + '&select=id,name&limit=1000')
  ]);
  return workfileKpisFrom({ sessions, staff, assignments, missions });
}
