// A stale row is evidence of missing completion, not proof that side effects stopped.
export function presentRun(row, now = Date.now()) {
  const elapsed = now - Date.parse(row.started_at);
  const stalled = row.status === 'running' && Number.isFinite(elapsed) && elapsed > 360000;
  const labels = {
    running: 'En cours', verified: 'Terminée', failed: 'Échec',
    partial: 'Résultat partiel', blocked: 'Bloquée'
  };
  return {
    id: row.id, agent: row.agent_key, status: stalled ? 'completion_unknown' : row.status,
    label: stalled ? 'Délai dépassé — résultat à vérifier' : labels[row.status] || 'État à vérifier',
    started_at: row.started_at, finished_at: row.finished_at,
    summary: row.summary || '',
    warning: stalled ? 'La fin de cette demande n’est pas enregistrée. Vérifier les actions et leurs preuves avant de relancer.' : null
  };
}

// Kernel rule: a successful tool call proves that code execution returned,
// not that the business objective/postcondition was verified in the real system.
// Until every business action exposes a standard verifier, action-bearing runs
// stay partial unless a durable verification signal is explicitly recorded.
export function deriveRunStatus({ toolEvents = [], toolsUsed = [] } = {}) {
  const events = Array.isArray(toolEvents) ? toolEvents : [];
  const tools = Array.isArray(toolsUsed) ? toolsUsed.filter(Boolean) : [];
  const usedTools = tools.length > 0 || events.length > 0;

  // Purely informational/advisory response: there is no side effect to prove.
  if (!usedTools) return 'verified';

  // A recovered/handled tool failure still prevents the whole business run
  // from being presented as verified.
  if (events.some(event =>
    event?.phase === 'failed' ||
    event?.status === 'failed' ||
    event?.work_state === 'failed'
  )) return 'partial';

  const explicitlyVerified = events.some(event =>
    event?.phase === 'verified' ||
    event?.status === 'verified' ||
    event?.work_state === 'verified' ||
    Boolean(event?.verified_at) ||
    event?.metadata?.verified === true ||
    event?.metadata?.business_verified === true
  );

  return explicitlyVerified ? 'verified' : 'partial';
}
