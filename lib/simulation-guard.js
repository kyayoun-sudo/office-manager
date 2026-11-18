import { rest } from './supabase.js';
import { currentOrgId } from './firm-context.js';

// Simulation firms (2026-11-18): the type of the firm of the request is read ONCE per request (primeOrgKind, called where the
// firm is fixed) and kept 60 s; the guards below are synchronous and FAIL CLOSED: a firm whose type could not be read counts
// as a simulation; Drive writes of a firm never primed are refused too.
const q = encodeURIComponent;
const fail = (code, statusCode) => Object.assign(new Error(code), { statusCode });
const kinds = new Map();
const TTL = 60 * 1000;

export async function primeOrgKind(orgId, d = {}) {
  if (!orgId) return null;
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
      folder = id.startsWith('folder:') ? id.slice(7) : id || null;
    }
    next = { kind: o.account_kind === 'simulation' ? 'simulation' : 'real', parent: o.parent_org_id || null, folder, at: Date.now() };
  } catch { next = { kind: 'unknown', parent: null, folder: null, at: Date.now() }; }
  kinds.set(orgId, next);
  return next;
}

const here = () => kinds.get(currentOrgId());
export const isSimulation = () => { const v = here(); return !v || v.kind !== 'real'; };
export const isSimulationKnown = () => here()?.kind === 'simulation';
export const simulationParent = () => here()?.parent || null;
export const simulationFolderId = () => here()?.folder || null;
export const resetSimulationGuardCache = () => kinds.clear();

// Outbound: refuses a simulation or a firm whose type could not be read; a firm never primed (tests, scripts) is not blocked.
export function assertNoOutbound() { const v = here(); if (v && v.kind !== 'real') throw fail('SIMULATION_NO_OUTBOUND', 409); }

export async function assertSimulationDriveWrite(id, meta = null) {
  const v = here();
  if (v && v.kind === 'real') return;
  const folder = v?.folder;
  if (!folder || !id) throw fail('SIMULATION_WRITE_OUTSIDE_FOLDER', 409);
  const { insideFolder } = await import('./google-drive.js');
  if (!(await insideFolder(id, folder, meta))) throw fail('SIMULATION_WRITE_OUTSIDE_FOLDER', 409);
}
