// What is sent to an AI must stay valid and complete (2026-10-25). Before, several prompts were cut with JSON.stringify(...).slice(0, N):
// the JSON was broken and the LAST documents — often the one just deposited, such as the grand livre — never reached the AI. Here the input is
// made smaller by dropping the least useful details first (passed by the caller), never by cutting the text.
export function fitJson(obj, max, shrink = []) {
  let s = JSON.stringify(obj);
  for (const step of shrink) { if (s.length <= max) break; step(obj); s = JSON.stringify(obj); }
  if (s.length <= max) return s;
  // still too long: drop items from the longest arrays' ends, keeping a note of how many were left out (still valid JSON)
  for (let guard = 0; guard < 200 && s.length > max; guard++) {
    let longest = null;
    (function walk(o) { if (!o || typeof o !== 'object') return; for (const v of Object.values(o)) { if (Array.isArray(v) && v.length > 1 && (!longest || JSON.stringify(v).length > JSON.stringify(longest).length)) longest = v; walk(v); } })(obj);
    if (!longest) break;
    longest.splice(Math.max(1, Math.floor(longest.length * 0.8)));
    s = JSON.stringify(obj);
  }
  return s;
}
