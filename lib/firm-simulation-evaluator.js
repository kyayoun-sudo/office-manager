// Offline evaluator only. Do not include this module or its output in an agent context.
// This is a deterministic fixture oracle, not an assessment of professional judgment.
export function evaluateSimulationScan({ seed, year, count = 1200 }, report) {
  const expected = [
    { kind: 'invoice_gl_difference', ref: `SIM-${year}-${(seed * 17) % count + 1}` },
    { kind: 'cutoff', ref: `SIM-${year}-${count - 1}` },
    { kind: 'invalid_date', ref: `SIM-${year}-${count}` }
  ];
  const key = finding => `${finding.kind}:${finding.ref ?? finding.account ?? ''}`;
  const observed = new Set((report.findings || []).map(key));
  const truth = new Set(expected.map(key));
  const missed = expected.filter(f => !observed.has(key(f)));
  const falseAlerts = (report.findings || []).filter(f => !truth.has(key(f)));
  const complete = report.automated_rows_checked === count * 2 && report.population_rows === count * 2;
  const reconciled = Number.isFinite(report.debit) && report.debit > 0 && report.debit === report.credit;
  return { simulation_only: true, method: 'deterministic-fixture-oracle', expected: expected.length, missed, false_alerts: falseAlerts,
    full_population_claim_supported_by_count: complete, arithmetic_reconciled: reconciled,
    passed: complete && reconciled && !missed.length && !falseAlerts.length,
    professional_judgment: 'NOT_EVALUATED', evidence_quality: 'NOT_EVALUATED',
    limitation: 'Counts and synthetic arithmetic only. Does not prove that an agent read the ledger or examined supporting documents.' };
}
