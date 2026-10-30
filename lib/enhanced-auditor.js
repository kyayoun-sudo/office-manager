// Universal-kernel facade for Enhanced Auditor.
//
// The complete pre-kernel business engine is preserved in enhanced-auditor-domain.js.
// The facade now enforces the product contract before every real run:
//   reality of the mission -> persistent mission memory -> AI knowledge -> code execution -> verification.
// Low-level tests may still request one raw domain step explicitly through injected dependencies.

import * as domain from './enhanced-auditor-domain.js';
import { runEnhancedAuditorKernel } from './enhanced-auditor-kernel.js';
import { hydrateEnhancedAuditorReality } from './enhanced-auditor-reality.js';
import { fireInternal } from './agent-passes.js';
import { recordMissionDocuments } from './mission-files.js';
import { getDriveFileMetadata } from './google-drive.js';
import { revisionOf } from './audit-evidence-brain.js';

export * from './enhanced-auditor-domain.js';

function realitySummary(reality = {}) {
  return {
    files: Number(reality.drive_scan?.files || 0),
    remembered: Array.isArray(reality.documents) ? reality.documents.length : 0,
    repaired: Number(reality.repaired_files || 0),
    changed: Boolean(reality.changed),
    content_changed: Boolean(reality.content_changed),
    possibly_truncated: Boolean(reality.drive_scan?.possibly_truncated)
  };
}

function assertReality(reality) {
  if (reality?.ok) return reality;
  const error = Object.assign(new Error(reality?.reason || 'MISSION_REALITY_UNAVAILABLE'), {
    statusCode: 503,
    reality
  });
  throw error;
}

const NON_BLOCKING_EXECUTION_FLAGS = new Set(['WORK_LOCKED_READ_ONLY']);

function executionGate(execution = {}) {
  if (!execution || execution.status !== 'prepared') {
    const status = execution?.status || 'missing';
    return {
      reason: 'ENHANCED_AUDITOR_EXECUTION_NOT_PREPARED',
      questions: [
        status === 'no_validated_programme'
          ? "Un programme d'audit validé est requis avant la revue de couverture."
          : `L'exécution SOP + Working Paper n'est pas prête (${status}). Corriger ce blocage avant de poursuivre.`
      ]
    };
  }

  const procedures = Array.isArray(execution.procedures) ? execution.procedures : [];
  if (!procedures.length) {
    return {
      reason: 'ENHANCED_AUDITOR_NO_EXECUTABLE_PROCEDURE',
      questions: ["Aucune procédure active n'a été exécutée à partir du programme validé."]
    };
  }

  const issues = [];
  for (const procedure of procedures) {
    const code = procedure?.code || procedure?.cycle_code || 'procédure';
    if (!procedure?.sop?.loaded) issues.push(`${code} : SOP non chargé.`);
    if (!procedure?.working_paper?.loaded) issues.push(`${code} : Working Paper non chargé ou feuille introuvable.`);
    if (!procedure?.locked && !procedure?.brain) issues.push(`${code} : le cerveau IA n'a pas préparé le travail.`);
    if (!procedure?.locked && procedure?.brain?.status === 'AI_UNAVAILABLE') issues.push(`${code} : cerveau IA indisponible (${procedure.brain.ai_error || 'raison inconnue'}).`);
    if (!procedure?.locked && procedure?.brain?.limit_reached) issues.push(`${code} : limite de raisonnement atteinte avant une préparation complète.`);
    if (procedure?.wp_sync?.status === 'NOT_WRITTEN') issues.push(`${code} : écriture Working Paper non vérifiée (${procedure.wp_sync.error || 'échec'}).`);

    for (const blocker of Array.isArray(procedure?.blockers) ? procedure.blockers : []) {
      if (!blocker || NON_BLOCKING_EXECUTION_FLAGS.has(String(blocker))) continue;
      issues.push(`${code} : blocage métier ${blocker}.`);
    }
  }

  if (!issues.length) return null;
  return {
    reason: 'ENHANCED_AUDITOR_EXECUTION_INCOMPLETE',
    questions: [...new Set(issues)].slice(0, 30)
  };
}

async function putRealityOnState(missionId, reality, d = {}, { forceKnowledge = false } = {}) {
  const stateFn = d.state || domain.auditorState;
  const save = d.save || domain.saveOne;
  const st = await stateFn(missionId, d.domainDeps || {});
  if (!st || st.status !== 'running') return st;

  st.reality = realitySummary(reality);
  if (!st.analytical_review && (forceKnowledge || (reality.changed && st.stage !== 'knowledge'))) {
    st.stage = 'knowledge';
    // Revisit every known file. learnAuditDocument() is revision-aware and reuses unchanged
    // audit_read receipts, so this does not spend AI tokens again for unchanged documents.
    st.knowledge_done = [];
  }
  await save(missionId, st, d.domainDeps || {});
  return st;
}

async function recordKnowledgeWithStableUnreadable(mission, docs = [], d = {}) {
  const getMeta = d.getMeta || getDriveFileMetadata;
  const record = d.recordMissionDocuments || recordMissionDocuments;
  const enriched = [];

  for (const doc of docs || []) {
    let next = doc;
    if (doc?.audit_read?.status === 'UNREADABLE' && !doc.audit_read.revision && doc.id) {
      try {
        const meta = await getMeta(doc.id);
        const revision = revisionOf(meta);
        if (revision) next = {
          ...doc,
          audit_read: {
            ...doc.audit_read,
            revision,
            source_state: 'unreadable_at_this_revision'
          }
        };
      } catch {
        // Keep the explicit UNREADABLE receipt. It is never treated as evidence or relevance.
      }
    }
    enriched.push(next);
  }

  return record(mission, enriched, d);
}

export function auditorStepRoute(d = {}) {
  if (d?.forceKernel) return 'kernel';
  // Preserve the former dependency-injected low-level contract. Production calls pass no d.
  return d && Object.keys(d).length ? 'domain' : 'kernel';
}

export async function startAuditorReview(orgId, req, body = {}, d = {}) {
  const hydrate = d.hydrateReality || hydrateEnhancedAuditorReality;
  const reality = assertReality(await hydrate(orgId, String(body.mission_id || ''), d.realityDeps || {}));
  const start = d.startDomain || domain.startAuditorReview;
  const stateFn = d.state || domain.auditorState;
  const save = d.save || domain.saveOne;
  const fire = d.fire || fireInternal;

  // Suppress the old immediate collect-step dispatch. We first put the state on the
  // mandatory knowledge stage, then start the kernel once that persisted state is correct.
  const started = await start(orgId, req, body, {
    ...(d.domainDeps || {}),
    fire: async () => true,
    missionDocuments: async () => reality.documents || []
  });

  const missionId = String(body.mission_id || '');
  const st = await stateFn(missionId, d.domainDeps || {});
  if (st?.status === 'running') {
    st.reality = realitySummary(reality);
    if (st.analytical_review) {
      // Content-first fallback: when no explicit analytical sources were selected, the
      // whole current mission catalogue is available to the AI instead of relying on roles.
      if (!(st.evidence_files || []).length) st.evidence_files = (reality.documents || []).map(x => x.id).filter(Boolean);
    } else {
      st.stage = 'knowledge';
      st.knowledge_done = [];
    }
    await save(missionId, st, d.domainDeps || {});
  }

  const scheduled = await fire(req, '/api/app?route=auditor-step', { mission_id: missionId });
  if (scheduled === false) throw Object.assign(new Error('ENHANCED_AUDITOR_START_NOT_SCHEDULED'), { statusCode: 503 });
  return { ...started, reality: realitySummary(reality) };
}

export async function auditorStep(orgId, req, body = {}, d = {}) {
  if (auditorStepRoute(d) === 'domain') return domain.auditorStep(orgId, req, body, d);

  const missionId = String(body?.mission_id || '').trim();
  if (!missionId) throw Object.assign(new Error('MISSION_ID_REQUIRED'), { statusCode: 400 });

  const hydrate = d.hydrateReality || hydrateEnhancedAuditorReality;
  const runKernel = d.runKernel || runEnhancedAuditorKernel;
  const initialReality = assertReality(await hydrate(orgId, missionId, d.realityDeps || {}));
  await putRealityOnState(missionId, initialReality, d, { forceKnowledge: false });

  const guardedStep = async (stepOrgId, stepReq, stepBody = {}, stepDeps = {}) => {
    const freshReality = assertReality(await hydrate(stepOrgId, missionId, d.realityDeps || {}));
    await putRealityOnState(missionId, freshReality, d, { forceKnowledge: false });

    const before = await (d.state || domain.auditorState)(missionId, d.domainDeps || {});
    const baseDomainDeps = d.domainDeps || {};
    const defaultRecord = baseDomainDeps.recordMissionDocuments || recordMissionDocuments;
    const result = await (d.domainStep || domain.auditorStep)(stepOrgId, stepReq, stepBody, {
      ...stepDeps,
      ...baseDomainDeps,
      missionDocuments: async () => freshReality.documents || [],
      recordMissionDocuments: (mission, docs, deps = {}) => recordKnowledgeWithStableUnreadable(mission, docs, {
        ...baseDomainDeps,
        ...deps,
        getMeta: baseDomainDeps.getMeta || getDriveFileMetadata,
        recordMissionDocuments: defaultRecord
      })
    });

    // The old engine advanced from execute to risks even when SOP/WP execution failed.
    // Do not allow coverage/report generation unless the execution layer is structurally usable.
    if (before?.stage === 'execute' && result?.status === 'running') {
      const gate = executionGate(result.execution);
      if (gate) {
        result.status = 'needs_documents';
        result.stage = 'done';
        result.missing_documents = gate.questions;
        result.execution_gate = { reason: gate.reason, at: new Date().toISOString() };
        result.log = Array.isArray(result.log) ? result.log : [];
        result.log.push({ at: new Date().toISOString(), m: 'Arrêt contrôlé : ' + gate.reason });
        await (d.save || domain.saveOne)(missionId, result, d.domainDeps || {});
      }
    }

    return result;
  };

  return runKernel(orgId, req, missionId, {
    step: guardedStep,
    ...(d.kernelOptions || {})
  });
}
