import { rest } from './supabase.js';
import { currentOrgId, multiCabinet } from './firm-context.js';

// Simulation firms (2026-11-18): the type of the firm of the request is read ONCE per request (primeOrgKind, called where the
// firm is fixed) and kept 60 s; the guards below are synchronous and FAIL CLOSED: a firm whose type could not be read counts
// as a simulation; Drive writes of a firm never primed are refused too.
const q = encodeURIComponent;
const fail = (code, statusCode) => Object.assign(new Error(code), { statusCode });
const kinds = new Map();
const TTL = 60 * 1000;

export async function primeOrgKind(orgId, d = {}) {
  if (!orgId) return null;
  // One firm per installation (several firms off): there is no simulation, nothing to read or to guard.
  if (!multiCabinet()) return null;
  const known = kinds.get(orgId);
  if (known && Date.now() - known.at < TTL) return known;
  const fetchRows = d.fetchRows || rest;
  let next;
  try {
    const o = (await fetchRows('office_organizations?id=eq.' + q(orgId) + '&select=account_kind,parent_org_id&limit=1'))?.[0];
    if (!o) throw new Error('FIRM_NOT_FOUND');
    let folder = null;
    if (o.account_kind === 'simulation') {
      const f = (await fetchRows('office_firm_drive?org_id=eq.' + q(orgId) + '&select=drive_id&limit=1'))?.[0];
      const id = String(f?.drive_id || '').split('|')[0];
      folder = id.startsWith('folder:') ? id.slice(7) || null : null;
    }
    // Only a real folder: id confines a simulation; a plain drive id (the parent's shared drive) gives no folder = writes refused.
    next = { kind: o.account_kind === 'simulation' ? 'simulation' : 'real', parent: o.parent_org_id || null, folder, at: Date.now() };
  } catch { next = known && known.kind === 'simulation' ? { ...known, at: Date.now() } : { kind: 'unknown', parent: null, folder: null, at: Date.now() }; }
  kinds.set(orgId, next);
  return next;
}

const here = () => kinds.get(currentOrgId());
export const isSimulation = () => { const v = here(); return !v || v.kind !== 'real'; };
export const isSimulationKnown = () => here()?.kind === 'simulation';
// A firm primed as anything but real (simulation, or type unreadable): Drive writes confined, nothing outbound.
export const isNotRealKnown = () => { const v = here(); return Boolean(v) && v.kind !== 'real'; };
export const simulationParent = () => here()?.parent || null;
export const simulationFolderId = () => here()?.folder || null;
export const resetSimulationGuardCache = () => kinds.clear();

// The Google connection and Drive choice of a simulation are the PARENT's: a simulation never changes them (2026-11-18 review).
export function assertNotSimulation() { if (isNotRealKnown()) throw fail('SIMULATION_GOOGLE_IS_PARENTS', 409); }

// Outbound: refuses a simulation or a firm whose type could not be read; a firm never primed (tests, scripts) is not blocked.
export function assertNoOutbound() { const v = here(); if (v && v.kind !== 'real') throw fail('SIMULATION_NO_OUTBOUND', 409); }

async function confined(id, meta, code) {
  const v = here();
  if (v && v.kind === 'real') return;
  const folder = v?.folder;
  if (!folder || !id) throw fail(code, 409);
  const { insideFolder } = await import('./google-drive.js');
  if (!(await insideFolder(id, folder, meta))) throw fail(code, 409);
}
export const assertSimulationDriveWrite = (id, meta = null) => confined(id, meta, 'SIMULATION_WRITE_OUTSIDE_FOLDER');
// Reads too: the borrowed credential of the parent sees the whole real Drive, a simulation sees only its folder.
export const assertSimulationDriveRead = (id, meta = null) => confined(id, meta, 'SIMULATION_READ_OUTSIDE_FOLDER');
