// Which part of a mission's memory the AI sees (2026-11-02 audit: it received the first 40 notes / 80 documents in file order,
// so an old but decisive decision about the sheet being filled could never reach it).
// The CODE ranks, the AI still interprets: what concerns the current focus first (the sheet, the test, the piece named in the
// question), then the people's decisions and corrections, then the most recent. Nothing is dropped silently: the caller says
// how many items were left out, so the AI can ask for them.

const fold = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Short audit references count (« D2 », « GL », « PRJ-01 ») ; common words do not.
const STOP = new Set(['les', 'des', 'une', 'pour', 'dans', 'avec', 'que', 'qui', 'est', 'sur', 'pas', 'par', 'son', 'ses', 'aux', 'cette', 'tout', 'tous', 'plus', 'the', 'and', 'fait', 'faire', 'peux', 'veux']);

export function focusTerms(...parts) {
  const words = fold(parts.flat().filter(Boolean).join(' ')).match(/[a-z0-9]+(?:[-_][a-z0-9]+)*/g) || [];
  const out = new Set();
  for (const w of words) {
    if (STOP.has(w)) continue;
    if (w.length >= 4 || (w.length >= 2 && /\d/.test(w)) || ['gl', 'teb', 'pbc', 'sop', 'ptba'].includes(w)) out.add(w);
    // Parts of a coded reference (« prj » of « prj-01 ») count; a bare number (« 01 ») does not.
    const coded = /\d/.test(w);
    for (const piece of w.split(/[-_]/)) if (piece !== w && !STOP.has(piece) && /[a-z]/.test(piece) && (piece.length >= 4 || (coded && piece.length >= 2))) out.add(piece);
  }
  return [...out].slice(0, 40);
}

// items: in their natural order (the caller says whether newer is first or last). Returns { kept, left_out }.
export function pickRelevant(items, { terms = [], limit = 40, text = x => JSON.stringify(x), weight = () => 0, newestLast = false } = {}) {
  const list = Array.isArray(items) ? items : [];
  if (list.length <= limit) return { kept: list, left_out: 0 };
  const n = list.length;
  const scored = list.map((x, i) => {
    const t = fold(text(x));
    const hits = terms.reduce((s, w) => s + (t.includes(w) ? 1 : 0), 0);
    const recency = newestLast ? i / n : (n - i) / n; // 0..1, newer = higher
    return { x, i, score: hits * 10 + weight(x) + recency };
  });
  const kept = scored.sort((a, b) => b.score - a.score).slice(0, limit).sort((a, b) => a.i - b.i).map(s => s.x);
  return { kept, left_out: n - kept.length };
}

// A person's decision or correction outweighs an agent's note; an unconfirmed web finding weighs least.
export function noteWeight(n = {}) {
  const origin = String(n.origin || '');
  return (origin === 'personne' || (n.by && /@/.test(n.by)) ? 4 : 0) + (n.kind === 'decision' ? 3 : 0) + (n.confirm === 'to_confirm' ? -2 : 0);
}

// A document already used for this focus, or recently touched, counts more than one only deposited.
export function documentWeight(x = {}) {
  return (x.uses?.length ? 2 : 0) + (x.read || x.title || x.profile ? 1 : 0);
}
