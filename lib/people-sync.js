import { rest } from './supabase.js';

// Everyone who works in the app is in Équipe (Paul, 2026-10-08: « Isabelle Gueguen et Walid ont été
// ajoutés comme membres du cabinet, et Équipe ne dit rien »). Each active user of the app gets a
// staff profile (same e-mail; or same name, then its e-mail is completed). Never removes anyone.
const q = encodeURIComponent;
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9@.]+/g, ' ').trim();
const ROLE = { owner: 'Associé', partner: 'Associé', manager: 'Manager', collaborator: 'Collaborateur' };
let last = { orgId: null, at: 0, out: null };

export async function syncStaffFromUsers(orgId, d = {}) {
  if (!d.force && last.orgId === orgId && Date.now() - last.at < 120000) return last.out;
  const fetchRows = d.fetchRows || rest;
  const users = await fetchRows('office_app_users?org_id=eq.' + q(orgId) + '&active=eq.true&select=email,display_name,role&limit=500').catch(() => []) || [];
  const staff = await fetchRows('office_staff_profiles?org_id=eq.' + q(orgId) + '&select=id,full_name,email,active&limit=1000').catch(() => []) || [];
  const out = { added: [], completed: [] };
  for (const u of users) {
    const email = String(u.email || '').toLowerCase().trim();
    if (!email) continue;
    const name = String(u.display_name || '').trim() || email.split('@')[0].replace(/[._-]+/g, ' ');
    const byMail = staff.find(s => String(s.email || '').toLowerCase() === email);
    if (byMail) continue;
    const byName = staff.find(s => !s.email && norm(s.full_name) === norm(name));
    try {
      if (byName) {
        await fetchRows('office_staff_profiles?org_id=eq.' + q(orgId) + '&id=eq.' + q(byName.id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ email }) });
        byName.email = email; out.completed.push(name);
      } else {
        const [row] = await fetchRows('office_staff_profiles', { method: 'POST', headers: { Prefer: 'return=representation' },
          body: JSON.stringify([{ org_id: orgId, full_name: name.slice(0, 120), email, role_title: ROLE[u.role] || null, active: true, profile_status: 'needs_review', skills: [] }]) }) || [];
        if (row) staff.push(row);
        out.added.push(name);
      }
    } catch { /* left for the owner */ }
  }
  last = { orgId, at: Date.now(), out };
  return out;
}
