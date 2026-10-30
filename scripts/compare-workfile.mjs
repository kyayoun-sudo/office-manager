// Compare the working file filled by the Enhanced Auditor with the one the auditor filled by hand on the same mission.
//   node scripts/compare-workfile.mjs <auditeur.xlsx> <agent.xlsx> [--sheets D1_GL,D2_BUDGET] [--out rapport.md]
// Reads the two files only; writes the report (Markdown) and prints the totals. See docs/MESURER_LE_REMPLISSAGE.md.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { compareWorkbooks, reportMarkdown } from '../lib/workfile-compare.js';

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf('--' + name); return i >= 0 ? args.splice(i, 2)[1] : null; };
const sheets = (opt('sheets') || '').split(',').map(s => s.trim()).filter(Boolean);
const out = opt('out');
const [reference, candidate] = args;
if (!reference || !candidate) {
  console.error('Usage : node scripts/compare-workfile.mjs <auditeur.xlsx> <agent.xlsx> [--sheets D1,D2] [--out rapport.md]');
  process.exit(2);
}
const report = await compareWorkbooks(readFileSync(reference), readFileSync(candidate), { sheets });
const md = reportMarkdown(report, { reference: basename(reference), candidate: basename(candidate) });
if (out) writeFileSync(out, md, 'utf8');
const t = report.totals;
console.log(`Justesse ${t.accuracy ?? '—'} % — justes ${t.same}, différentes ${t.different}, oubliées ${t.missing}, ajoutées ${t.extra} (formules non comptées : ${t.formulas_left_out})`);
for (const s of report.sheets) console.log(' ', s.sheet, s.status === 'compared' ? `${s.accuracy ?? '—'} %` : s.status);
if (out) console.log('Rapport : ' + out);
