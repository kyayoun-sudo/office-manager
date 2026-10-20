// Keep resumable document calls below the function lifetime, including fallback.
export function parseReadingJson(text) {
  // A repaired/truncated response cannot prove a complete transcription/analysis.
  return JSON.parse(String(text).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));
}
export function readingAiBudget({now=Date.now,fetchImpl=fetch,totalMs=150000,providerMs=65000}={}) {
  const deadline=now()+totalMs;
  return {fetchImpl:(url,options={})=>fetchImpl(url,{...options,signal:AbortSignal.any([
    options.signal,AbortSignal.timeout(Math.max(1,Math.min(providerMs,deadline-now())))
  ].filter(Boolean))})};
}
