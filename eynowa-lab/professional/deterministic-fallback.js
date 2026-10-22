function clean(value, max = 1200) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueSources(knowledge) {
  const seen = new Set();
  const rows = [];
  for (const hit of safeArray(knowledge)) {
    const sourceId = clean(hit?.sourceId, 160);
    const reference = clean(hit?.reference, 500);
    if (!sourceId || !reference) continue;
    const key = `${sourceId}|${reference}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ sourceId, reference });
    if (rows.length >= 8) break;
  }
  return rows;
}

function groundedPoints(knowledge) {
  return safeArray(knowledge).slice(0, 6).map((hit) => {
    const domain = clean(hit?.domain, 40) || 'professional';
    const framework = clean(hit?.framework, 100);
    const topic = clean(hit?.topic, 120);
    const label = [domain, framework, topic].filter(Boolean).join(' / ');
    const content = clean(hit?.content, 700);
    return content ? `- [${label}] ${content}` : '';
  }).filter(Boolean);
}

function memoryPoints(memory) {
  return safeArray(memory).slice(0, 2).map((row) => {
    const decision = clean(row?.decision, 500);
    const reason = clean(row?.reason, 400);
    if (!decision) return '';
    return `- Mémoire professionnelle validée : ${decision}${reason ? ` (${reason})` : ''}`;
  }).filter(Boolean);
}

export function buildGroundedFallbackRaw({ request = {}, knowledge = [], memory = [], error } = {}) {
  const points = groundedPoints(knowledge);
  const prior = memoryPoints(memory);
  const topics = safeArray(request.topics).filter(Boolean).join(', ');
  const failure = clean(error?.message || error || 'local generation unavailable', 500);

  const sections = [
    'Mode local dégradé : le modèle génératif n’a pas répondu dans le délai. EYNOWA Lab restitue uniquement les éléments effectivement récupérés dans sa base professionnelle et ne formule pas de conclusion normative autonome.',
    topics ? `Thèmes détectés : ${topics}.` : '',
    points.length ? `Éléments récupérés :\n${points.join('\n')}` : 'Aucun passage professionnel exploitable n’a été récupéré pour cette demande.',
    prior.length ? `Contexte professionnel validé :\n${prior.join('\n')}` : '',
    'Action requise : utiliser ces éléments pour poursuivre les contrôles, puis faire valider par le professionnel toute écriture, conclusion normative, estimation ou position d’audit.',
  ].filter(Boolean);

  return {
    answer: sections.join('\n\n'),
    sources: uniqueSources(knowledge),
    confidence: points.length ? 0.55 : 0.2,
    missing_facts: [],
    contradictions: [],
    requires_validation: true,
    validation_reason: `Génération locale indisponible ou trop lente (${failure}). Réponse déterministe fondée uniquement sur les connaissances récupérées ; validation professionnelle obligatoire.`,
    question_for_professional: 'Veuillez valider les constats récupérés et préciser les faits manquants avant toute conclusion ou écriture.',
    _eynowa_generation: {
      model: 'deterministic_grounded_fallback',
      fallbackUsed: true,
      deterministicFallback: true,
      repairedJson: false,
      failure,
    },
  };
}
