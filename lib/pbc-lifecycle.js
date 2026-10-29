// PBC lifecycle and overdue-reminder logic, extracted from agent-tools.js (audit 2026-10-29, point 6).
// agent-tools.js re-exports every name below, so existing importers are unchanged.
function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export const PBC_LIFECYCLE_STATES = [
  "REQUESTED",
  "RECEIVED",
  "PARTIAL",
  "NON_CONFORME",
  "REVIEW",
  "VERIFIED"
];

export const PBC_REMINDER_GRACE_HOURS = 24;
export const PBC_EXTERNAL_REMINDER_ACTION = "pbc_external_reminder";

// PBC_MASTER column indexes (0-based, row data starting at A4).
const PBC_COL = {
  reference: 0,
  dossier: 1,
  document: 2,
  cycles: 4,
  moment: 6,
  critical: 8,
  applicable: 10,
  deadline: 14,
  received: 15,
  complete: 17,
  status: 18
};

// Maps the checklist row to the lifecycle state. The raw status written in the
// checklist wins when it is explicit; otherwise the state is derived from the
// received/complete flags. VERIFIED is never derived from flags alone: it needs
// an explicit verified status (content actually checked).
export function pbcLifecycleState(row) {
  const raw = normalizeText(row?.[PBC_COL.status]).replace(/[^a-z0-9]+/g, "_");

  if (/^(verifie|verifiee|verified|valide|validee)/.test(raw)) return "VERIFIED";
  if (/non_?conforme|rejete|rejected|non_?compliant/.test(raw)) return "NON_CONFORME";
  if (/revue|review|a_controler|a_verifier/.test(raw)) return "REVIEW";
  if (/partiel|partial|incomplet/.test(raw)) return "PARTIAL";
  if (/^(recu|recue|received|complet|complete)/.test(raw)) return "RECEIVED";
  if (/demande|requested|attente|manquant|missing|a_recevoir|en_retard|retard/.test(raw)) {
    return "REQUESTED";
  }

  // "Reçu ?" (manual) accepts Oui / Partiel / Non.
  const receivedRaw = normalizeText(row?.[PBC_COL.received]);
  if (receivedRaw === "partiel") return "PARTIAL";
  const received = receivedRaw === "oui";
  const complete = normalizeText(row?.[PBC_COL.complete]) === "oui";
  if (!received) return "REQUESTED";
  if (!complete) return "PARTIAL";
  return "RECEIVED";
}

// Parses a formatted Google Sheets date (ISO yyyy-mm-dd, or dd/mm/yyyy,
// dd-mm-yyyy, dd.mm.yyyy as used in French workbooks). Returns a UTC date at
// 00:00 of that day, or null when the value cannot be read unambiguously.
export function parseSheetDate(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;

  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const d = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  match = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (match) {
    const day = +match[1];
    const month = +match[2];
    const year = +match[3];
    const d = new Date(Date.UTC(year, month - 1, day));
    if (
      d.getUTCFullYear() !== year ||
      d.getUTCMonth() !== month - 1 ||
      d.getUTCDate() !== day
    ) return null;
    return d;
  }

  return null;
}

const MISSING_PBC_STATES = new Set(["REQUESTED", "PARTIAL", "NON_CONFORME"]);

// An applicable PBC item is overdue for an external reminder when it is still
// missing (REQUESTED / PARTIAL / NON_CONFORME) 24 hours after the END of its
// expected day. Using the end of the day avoids premature reminders when only a
// date (no time) is recorded.
export function findOverduePbcItems(rows, now = new Date()) {
  const overdue = [];
  const unparseableDeadlines = [];

  for (const row of rows || []) {
    const reference = String(row?.[PBC_COL.reference] || "").trim();
    if (!reference.startsWith("PBC-")) continue;
    if (normalizeText(row?.[PBC_COL.applicable]) !== "oui") continue;

    const state = pbcLifecycleState(row);
    if (!MISSING_PBC_STATES.has(state)) continue;

    const rawDeadline = String(row?.[PBC_COL.deadline] || "").trim();
    if (!rawDeadline) continue;

    const deadlineDay = parseSheetDate(rawDeadline);
    if (!deadlineDay) {
      unparseableDeadlines.push({ reference, deadline: rawDeadline });
      continue;
    }

    const endOfDeadlineDay = new Date(deadlineDay.getTime() + 24 * 3600 * 1000);
    const reminderDueAt = new Date(
      endOfDeadlineDay.getTime() + PBC_REMINDER_GRACE_HOURS * 3600 * 1000
    );
    if (now < reminderDueAt) continue;

    overdue.push({
      reference,
      dossier: String(row?.[PBC_COL.dossier] || ""),
      document: String(row?.[PBC_COL.document] || ""),
      cycles: String(row?.[PBC_COL.cycles] || ""),
      moment: String(row?.[PBC_COL.moment] || ""),
      critical: normalizeText(row?.[PBC_COL.critical]) === "oui",
      raw_status: String(row?.[PBC_COL.status] || ""),
      lifecycle_state: state,
      deadline: deadlineDay.toISOString().slice(0, 10),
      overdue_since: reminderDueAt.toISOString()
    });
  }

  return { overdue, unparseableDeadlines };
}
