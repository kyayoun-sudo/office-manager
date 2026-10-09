export const PBC_STATES = Object.freeze([
  'TO_REQUEST','REQUESTED','POPULATION_TO_CONFIRM','PARTIAL','RECEIVED',
  'UNDER_REVIEW','NON_CONFORME','VERIFIED','N/A_JUSTIFIED'
]);

const norm = v => String(v ?? '').trim().toUpperCase();

export function normalizeExpectedComponents(components = []) {
  const seen = new Set();
  return components
    .map(x => typeof x === 'string' ? { id: x, label: x } : x)
    .map(x => ({ id: String(x?.id ?? x?.label ?? '').trim(), label: String(x?.label ?? x?.id ?? '').trim() }))
    .filter(x => x.id && !seen.has(x.id) && seen.add(x.id));
}

export function evaluatePbcCompleteness({
  expectedComponents = null, receivedComponentIds = [],
  nonConformingComponentIds = [], populationConfirmed = false, naJustified = false
}) {
  if (naJustified) return {
    state:'N/A_JUSTIFIED', expected:0, received:0, missing:[],
    non_conforming:[], complete:true, reason:'N/A justified'
  };

  const expected = expectedComponents == null ? null : normalizeExpectedComponents(expectedComponents);
  const received = new Set(receivedComponentIds.map(norm).filter(Boolean));
  const nonConforming = new Set(nonConformingComponentIds.map(norm).filter(Boolean));

  if (!populationConfirmed || expected == null) return {
    state:'POPULATION_TO_CONFIRM',
    expected: expected?.length ?? null,
    received: expected ? expected.filter(x => received.has(norm(x.id))).length : received.size,
    missing: expected ? expected.filter(x => !received.has(norm(x.id))).map(x => x.id) : [],
    non_conforming:[...nonConforming], complete:false,
    reason:'Expected population/components are not yet confirmed'
  };

  const receivedExpected = expected.filter(x => received.has(norm(x.id)));
  const missing = expected.filter(x => !received.has(norm(x.id))).map(x => x.id);
  const bad = expected.filter(x => nonConforming.has(norm(x.id))).map(x => x.id);

  if (bad.length) return {
    state:'NON_CONFORME', expected:expected.length, received:receivedExpected.length,
    missing, non_conforming:bad, complete:false,
    reason:'At least one required component is non-conforming'
  };

  if (!receivedExpected.length) return {
    state:'REQUESTED', expected:expected.length, received:0, missing,
    non_conforming:[], complete:false, reason:'No expected component received'
  };

  if (missing.length) return {
    state:'PARTIAL', expected:expected.length, received:receivedExpected.length,
    missing, non_conforming:[], complete:false,
    reason:`${receivedExpected.length}/${expected.length} expected components received`
  };

  return {
    state:'RECEIVED', expected:expected.length, received:expected.length,
    missing:[], non_conforming:[], complete:false,
    reason:'All expected components received; content still requires verification'
  };
}

export function markVerified(result, { contentRead = false, allChecksMatch = false } = {}) {
  if (!result || result.state !== 'RECEIVED') return result;
  if (!contentRead || !allChecksMatch) {
    return {...result, state:'UNDER_REVIEW', complete:false, reason:'Received population complete, verification pending'};
  }
  return {...result, state:'VERIFIED', complete:true, reason:'Expected population complete and content verified'};
}
