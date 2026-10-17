// Synthetic accounting data only. No credentials, network or production storage.
import ExcelJS from 'exceljs';
export function simulationPopulation({ seed = 1, year = 2027, count = 1200 } = {}) {
  if (!Number.isInteger(seed) || seed < 1 || ![2027, 2028].includes(year) || !Number.isInteger(count) || count < 1000 || count > 10000) throw new Error('INVALID_SIMULATION_POPULATION');
  const entries = [], invoices = [];
  for (let i = 1; i <= count; i++) {
    const amount = 10000 + ((i * 7919 + seed * 31) % 90000);
    const ref = `SIM-${year}-${i}`;
    const date = `${year}-${String(1 + i % 12).padStart(2, '0')}-${String(1 + i % 28).padStart(2, '0')}`;
    entries.push({ ref, date, account: '601000', debit: amount, credit: 0 });
    entries.push({ ref, date, account: '401000', debit: 0, credit: amount });
    invoices.push({ ref, date, amount, label: 'SIMULATION' });
  }
  // A changed estimate in Y2, a late cutoff and an invalid date; known only to the separate evaluator.
  const index = (seed * 17) % count;
  invoices[index].amount += year === 2028 ? 17000 : 9000;
  entries[(count - 2) * 2].date = `${year + 1}-01-02`;
  entries[(count - 1) * 2].date = `${year}-02-30`;
  const balance = ['601000', '401000'].map(account => ({ account, debit: entries.filter(e => e.account === account).reduce((n, e) => n + e.debit, 0), credit: entries.filter(e => e.account === account).reduce((n, e) => n + e.credit, 0) }));
  return { label: 'SIMULATION', seed, year, entries, invoices, balance };
}
export async function populationWorkbook(population) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SIMULATION';
  const sheet = wb.addWorksheet('GL');
  sheet.addRow(['SIMULATION — fictional ledger, no real approvals']);
  sheet.addRow(['Référence', 'Date', 'Compte', 'Débit', 'Crédit']);
  for (const e of population.entries) sheet.addRow([e.ref, e.date, e.account, e.debit, e.credit]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
// Full-population automated checks, not documentary examination or a statistical sample.
export function scanSimulationPopulation(p) {
  const findings = [], byRef = new Map(), totals = new Map();
  let debit = 0, credit = 0;
  for (const [i, e] of p.entries.entries()) {
    debit += e.debit; credit += e.credit;
    const row = i + 3;
    const parsed = new Date(e.date + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== e.date) findings.push({ kind: 'invalid_date', row, ref: e.ref });
    else if (parsed.getUTCFullYear() !== p.year) findings.push({ kind: 'cutoff', row, ref: e.ref });
    byRef.set(e.ref, (byRef.get(e.ref) || 0) + e.debit);
    const t = totals.get(e.account) || { debit: 0, credit: 0 };
    t.debit += e.debit; t.credit += e.credit; totals.set(e.account, t);
  }
  for (const invoice of p.invoices) if (byRef.get(invoice.ref) !== invoice.amount) findings.push({ kind: 'invoice_gl_difference', ref: invoice.ref, difference: invoice.amount - (byRef.get(invoice.ref) || 0) });
  for (const b of p.balance) {
    const t = totals.get(b.account);
    if (!t || t.debit !== b.debit || t.credit !== b.credit) findings.push({ kind: 'trial_balance_difference', account: b.account });
  }
  if (debit !== credit) findings.push({ kind: 'unbalanced', difference: debit - credit });
  return { label: 'SIMULATION', automated_rows_checked: p.entries.length, population_rows: p.entries.length, debit, credit, findings,
    selection: { method: 'targeted-exceptions', references: [...new Set(findings.map(f => f.ref).filter(Boolean))], exclusions: 'No random sample; ordinary transactions not examined against supporting documents.', statistical_extrapolation: false },
    evidence_examined: 0, limitations: ['Automated comparisons only; invoice objects are synthetic, not examined original supporting documents.'] };
}
