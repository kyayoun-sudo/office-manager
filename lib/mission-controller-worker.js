// Mission Controller domain worker.
// This is the existing mission-memory refresh logic extracted from agent-passes.js so the
// universal kernel can call it directly without depending on scheduler internals.
export async function runMissionControllerWork(orgId, d = {}) {
  const { loadAgentMemory, writeAgentMemory } = await import('./agent-memory.js');
  const memory = await import('./mission-memory.js');
  const actionExecutor = await import('./action-executor.js');
  const inventorySync = await import('./inventory-mission-sync.js');

  const load = d.loadAgentMemory || loadAgentMemory;
  const write = d.writeAgentMemory || writeAgentMemory;
  const refresh = d.refreshMissionMemories || memory.refreshMissionMemories;
  const statusProposals = d.autoStatusProposals || memory.autoStatusProposals;
  const assignOrphans = d.assignValidatedOrphans || actionExecutor.assignValidatedOrphans;
  const syncDocuments = d.syncInventoryMissionDocuments || inventorySync.syncInventoryMissionDocuments;

  const seen = (await load('mission-controller').catch(() => null))?.memory?.checkpoint?.seen || {};
  const startedAt = new Date().toISOString();

  // Reality first: Orpailleur inventory is the physical/documentary fact source. Repair any
  // mission-linked file that missed the earlier event before rebuilding mission memory, so the
  // Enhanced Auditor and other readers cannot stay blind to a document already attached to a mission.
  const inventorySyncResult = await syncDocuments(orgId, d.inventorySyncDeps || {});

  const r = await refresh(orgId, { seen });
  r.inventory_sync = inventorySyncResult;
  r.status_proposals = await statusProposals(orgId).catch(() => []);
  r.assignments = await assignOrphans(orgId).catch(() => null);

  const missions = Array.isArray(r?.missions) ? r.missions : [];
  const failed = missions.filter(m => m.status === 'failed');
  const inventoryIncomplete = ['partial', 'failed'].includes(inventorySyncResult?.status);

  await write('mission-controller', m => {
    const at = new Date().toISOString();
    const next = { ...(m.checkpoint?.seen || {}) };
    for (const x of missions) if (x.status !== 'failed') next[x.mission_id] = at;

    m.last_attempted_at = startedAt;
    m.heartbeat_at = at;
    m.status = inventoryIncomplete || (failed.length && failed.length === missions.length) ? 'failed' : 'idle';

    if (m.status === 'idle') {
      m.last_successful_at = at;
      m.retry_count = 0;
      m.last_error = null;
      m.checkpoint = { ...(m.checkpoint || {}), seen: next };
    } else {
      m.retry_count = (m.retry_count || 0) + 1;
      m.last_error = inventoryIncomplete
        ? 'Synchronisation Orpailleur → mémoire mission incomplète : ' + (inventorySyncResult?.errors?.[0]?.error || inventorySyncResult?.unresolved?.[0] || inventorySyncResult?.status)
        : (failed[0]?.error || 'échec');
    }

    m.pending = missions
      .filter(x => x.status === 'folder_unknown')
      .map(x => ({
        ref: 'mission:' + x.mission_id,
        label: 'Dossier Drive de la mission à confirmer',
        waiting_for: 'À valider'
      }));

    m.history = [
      ...(m.history || []),
      {
        at,
        ok: m.status === 'idle',
        ref: 'mémoires de mission',
        error: m.status === 'idle' ? null : m.last_error,
        inventory_sync: {
          status: inventorySyncResult?.status || 'unknown',
          inventory: inventorySyncResult?.inventory || 0,
          missing: inventorySyncResult?.missing || 0,
          changed: inventorySyncResult?.changed || 0,
          attached: inventorySyncResult?.attached || 0,
          unchanged: inventorySyncResult?.unchanged || 0
        }
      }
    ];
    return m;
  });

  return r;
}
