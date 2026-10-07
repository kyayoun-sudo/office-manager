import { runAI } from './ai.js';

// The application in English (Paul, 2026-10-07: « il peut être français et anglais »). The pages
// are written in French; when a person chooses English (settings wheel), the browser sends the
// French texts it shows and receives them in English. Each browser keeps what it already received,
// and this server instance keeps a shared cache, so a text is translated once.
// Proper names (people, clients, missions, files, codes) stay as they are.

const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });
const CACHE = new Map();
const MAX_TEXTS = 150, MAX_LEN = 600, MAX_TOTAL = 24000, MAX_CACHE = 20000;

const INSTRUCTIONS = `You translate the user interface of a back-office application for audit and accounting firms, from French into natural, concise British-neutral English (UI wording: sentence case, short, plain verbs).
You receive a JSON array of French strings. Return STRICT JSON: an array of the same length, same order, each item the English translation.
Rules: keep unchanged people's names, firm and client names, mission names written in capitals or with a client prefix, file and folder names, codes (R009, AIN-2025-110), e-mail addresses, numbers, dates' digits, emojis and punctuation like « → ». Keep leading/trailing symbols. Audit vocabulary: « mission » = engagement, « lettre de mission » = engagement letter, « programme de travail » = work programme, « associé-gérant » = managing partner, « collaborateur » = staff member, « Rangement » = Filing, « À valider » = To approve, « Orpailleur » and « Grand Contrôleur » are agent names: keep them. If a string is already English or not language, return it unchanged.`;

export async function translateTexts(body = {}, d = {}) {
  if ((body.to || 'en') !== 'en') throw fail('LANGUAGE_NOT_SUPPORTED');
  const texts = Array.isArray(body.texts) ? body.texts : null;
  if (!texts) throw fail('TEXTS_REQUIRED');
  const clean = [...new Set(texts.map(t => String(t || '').trim()).filter(t => t && t.length <= MAX_LEN))].slice(0, MAX_TEXTS);
  if (clean.reduce((n, t) => n + t.length, 0) > MAX_TOTAL) throw fail('TOO_MUCH_TEXT');
  const out = {};
  const missing = clean.filter(t => { if (CACHE.has(t)) { out[t] = CACHE.get(t); return false; } return true; });
  if (missing.length) {
    const run = d.runAI || runAI;
    let arr = null;
    for (const provider of ['openai', 'anthropic']) {
      try {
        const t = String((await run({ agentKey: 'translator', instructions: INSTRUCTIONS, input: JSON.stringify(missing), provider, maxTokens: 8000 })).text || '');
        const a = t.indexOf('['), b = t.lastIndexOf(']');
        const parsed = a >= 0 && b > a ? JSON.parse(t.slice(a, b + 1)) : null;
        if (Array.isArray(parsed) && parsed.length === missing.length) { arr = parsed; break; }
      } catch { /* next provider */ }
    }
    if (!arr) throw fail('TRANSLATION_FAILED', 502);
    missing.forEach((fr, i) => {
      const en = String(arr[i] ?? '').trim() || fr;
      out[fr] = en;
      if (CACHE.size < MAX_CACHE) CACHE.set(fr, en);
    });
  }
  return { to: 'en', translations: out };
}
