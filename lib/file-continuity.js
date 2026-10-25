import { acquireReaderLease, acquireOfflineReaderLease } from './inspection-runtime.js';

// Serialize discovery, creation and binding, including across server instances.
// Offline leases are only for explicitly injected adapters used by tests.
export async function withFileLease(orgId, scope, d, run) {
  const lease = d.fileLease
    ? await d.fileLease(orgId, scope)
    : d.drive ? acquireOfflineReaderLease([orgId, scope])
      : await acquireReaderLease(orgId, scope, { fetchRows: d.fetchRows, ttl: 240 });
  if (!lease) throw Object.assign(new Error('FILE_PREPARATION_IN_PROGRESS'), { statusCode: 409 });
  try { return await run(lease); }
  finally { await lease.release(); }
}
