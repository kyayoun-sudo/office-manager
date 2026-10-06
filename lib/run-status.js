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
