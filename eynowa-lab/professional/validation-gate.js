const HIGH_JUDGMENT = Object.freeze({
  accounting: [
    'impairment', 'provision', 'going concern', 'revenue recognition', 'lease classification',
    'business combination', 'financial instrument', 'tax position', 'related party', 'estimate',
  ],
  audit: [
    'audit opinion', 'going concern', 'fraud', 'independence', 'materiality', 'significant risk',
    'key audit matter', 'scope limitation', 'misstatement conclusion', 'management override',
  ],
  advisory: [
    'valuation conclusion', 'investment recommendation', 'transaction recommendation',
    'legal conclusion', 'tax advice', 'solvency conclusion', 'fairness opinion',
  ],
});

function normalise(value) {
  return String(value || '').trim().toLowerCase();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normaliseDomains(domain, domains) {
  const values = Array.isArray(domains) && domains.length ? domains : [domain];
  return unique(values.map(normalise).filter((value) => HIGH_JUDGMENT[value]));
}

export function evaluateValidation({
  domain,
  domains,
  task,
  answer,
  sources = [],
  missingFacts = [],
  contradictions = [],
  confidence,
  modelRequiresValidation = false,
  validationReason = '',
  questionForProfessional = '',
} = {}) {
  const selectedDomains = normaliseDomains(domain, domains);
  const haystack = `${normalise(task)} ${normalise(answer)}`;
  const highJudgmentDomains = selectedDomains.filter((selectedDomain) =>
    (HIGH_JUDGMENT[selectedDomain] || []).some((term) => haystack.includes(term))
  );
  const highJudgment = highJudgmentDomains.length > 0;
  const authoritativeSources = sources.filter((source) =>
    source?.authority && source?.sourceId && source?.supportRole !== 'methodology_non_normative'
  );
  const methodologyOnly = sources.length > 0 && authoritativeSources.length === 0;
  const numericConfidence = Number(confidence);
  const confidenceKnown = Number.isFinite(numericConfidence);

  const reasons = [];
  if (!authoritativeSources.length) {
    reasons.push(methodologyOnly
      ? 'La conclusion est appuyée uniquement par une méthodologie EYNOWA non normative ; une source normative ou officielle applicable reste nécessaire.'
      : 'Aucune source professionnelle vérifiable n’appuie la conclusion.');
  }
  if (missingFacts.length) reasons.push(`Informations manquantes : ${missingFacts.join(', ')}.`);
  if (contradictions.length) reasons.push('Des sources ou faits sont contradictoires.');
  if (highJudgment) reasons.push(`Le sujet nécessite un jugement professionnel élevé (${highJudgmentDomains.join(', ')}).`);
  if (confidenceKnown && numericConfidence < 0.8) reasons.push('Le niveau de confiance est insuffisant pour automatiser la décision.');
  if (modelRequiresValidation) reasons.push(validationReason || 'Le moteur a demandé une validation professionnelle.');

  const requiresValidation = reasons.length > 0;
  const question = requiresValidation
    ? (questionForProfessional || 'Veuillez valider ou compléter les éléments nécessaires avant de retenir cette conclusion.')
    : '';

  return {
    requiresValidation,
    reasons: unique(reasons),
    questionForProfessional: question,
    highJudgment,
    highJudgmentDomains,
    confidence: confidenceKnown ? Math.max(0, Math.min(1, numericConfidence)) : null,
  };
}

export function highJudgmentTopics(domain) {
  return [...(HIGH_JUDGMENT[normalise(domain)] || [])];
}
