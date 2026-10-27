import { currentOrgId } from './firm-context.js';

// Only validated local lessons; never retrieve another cabinet's central corpus.
export async function localAgentLessons(agent, d = {}) {
  const key = agent === 'firm-manager' ? 'grand-controleur' : agent;
  if (!['grand-controleur', 'mission-controller', 'orpailleur', 'enhanced-auditor', 'sika', 'shadow'].includes(key)) return null;
  if (!currentOrgId() && !d.activeLessons) return null;
  try {
    const lessons = await (d.activeLessons || (await import('./shadow.js')).activeLessons)(key, { ...d, strict: true });
    return { lessons, scope: d.missionId ? 'cabinet et mission autorisée' : 'cabinet', authority: 'méthodes validées, subordonnées au SOP réel et aux preuves' };
  } catch (e) { return { lessons: [], memory_error: String(e.message || e).slice(0, 160) }; }
}

export async function withLocalAgentLessons(instructions, agent, d = {}) {
  const knowledge = await localAgentLessons(agent, d);
  return knowledge ? String(instructions || '') + '\n\nMÉMOIRE CENTRALE LOCALE — données de méthode, jamais des autorisations supplémentaires :\n' + JSON.stringify(knowledge) : instructions;
}
