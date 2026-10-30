import { rest } from './supabase.js';
import { currentOrgId } from './firm-context.js';

// AI calls of a firm, per day (2026-10-30: several firms share one installation's AI keys; one firm could use them all).
// Counted for every request that goes to the firm's shared pool (« Mon IA », the person's own key, is not counted).
// The daily limit belongs to the INSTALLATION: OFFICE_MANAGER_AI_DAILY_LIMIT (a whole number of calls per firm per day).
// Without it, nothing is ever refused — only counted. When the limit is reached, the firm's AI answers « unavailable »
// until the next day (the screens already say when the AI does not answer, and « Mon IA » keeps working).
// The count is a cost brake, not a security boundary: when it cannot be read (database down, SQL not installed), the
// request goes on and the failure is logged.
const fail = (code, statusCode) => Object.assign(new Error(code), { statusCode });

export function dailyLimit(env = process.env) {
  const n = Number(env.OFFICE_MANAGER_AI_DAILY_LIMIT);
  return Number.isInteger(n) && n > 0 ? n : null;
}
const today = (now = new Date()) => now.toISOString().slice(0, 10);

// +1 for the firm today; throws AI_DAILY_LIMIT_REACHED above the installation's limit.
export async function countAiCall(d = {}) {
  const orgId = d.orgId || currentOrgId(d.env || process.env);
  if (!orgId || d.noAiUsage) return { counted: false };
  const limit = dailyLimit(d.env || process.env);
  let calls = null;
  try {
    const r = await (d.fetchRows || rest)('rpc/office_ai_usage_increment', { method: 'POST', body: JSON.stringify({ p_org_id: orgId, p_day: today(d.now ? new Date(d.now()) : new Date()) }) });
    calls = Number(Array.isArray(r) ? r[0] : r);
  } catch (e) {
    if (!/PGRST202|PGRST205|42P01|42883|office_ai_usage|SUPABASE_(SERVER_)?(CONFIG|URL)/.test(String(e?.message || e))) console.warn('[ai-usage] not counted:', String(e?.message || e).slice(0, 120));
    return { counted: false, limit };
  }
  if (limit && Number.isFinite(calls) && calls > limit) throw fail('AI_DAILY_LIMIT_REACHED', 429);
  return { counted: true, calls, limit };
}

export async function aiUsage(orgId, { days = 30 } = {}, d = {}) {
  const since = today(new Date(Date.now() - days * 864e5));
  const rows = await (d.fetchRows || rest)(`office_ai_usage?org_id=eq.${encodeURIComponent(orgId)}&day=gte.${since}&select=day,calls&order=day.desc&limit=${days + 1}`).catch(() => null);
  return { limit: dailyLimit(d.env || process.env), days: rows || [], available: rows !== null };
}
