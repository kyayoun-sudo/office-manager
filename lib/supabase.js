import { LIVE_FILTER } from './mission-status.js';

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) throw new Error("SUPABASE_SERVER_CONFIG_MISSING");
  return { url: url.replace(/\/$/, ""), key };
}

export async function rest(path, options = {}) {
  const { url, key } = config();

  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers
  });

  const raw = await response.text();
  let data = null;

  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
  }

  if (!response.ok) {
    throw new Error(
      `SUPABASE_${response.status}: ${
        typeof data === "string" ? data : JSON.stringify(data)
      }`
    );
  }

  return data;
}

export async function getAgentSetting(orgId, agentKey) {
  const rows = await rest(
    `office_agent_settings?org_id=eq.${encodeURIComponent(orgId)}&agent_key=eq.${encodeURIComponent(agentKey)}&select=*`
  );
  return rows?.[0] || null;
}

export async function getPermissions(orgId) {
  const rows = await rest(
    `office_processing_permissions?org_id=eq.${encodeURIComponent(orgId)}&select=*`
  );
  return rows?.[0] || null;
}

export async function createAgentRun(payload) {
  const rows = await rest("office_agent_runs", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([payload])
  });
  return rows?.[0] || null;
}

export async function finishAgentRun(id, patch) {
  return rest(`office_agent_runs?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(patch)
  });
}

export async function startAgentToolEvent({
  orgId,
  runId,
  parentAgentKey = "office-manager",
  specialistKey,
  toolName,
  inputSummary = null,
  metadata = {}
}) {
  try {
    const rows = await rest("office_agent_tool_events", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify([
        {
          org_id: orgId,
          run_id: runId || null,
          parent_agent_key: parentAgentKey,
          specialist_key: specialistKey,
          tool_name: toolName,
          phase: "running",
          input_summary: inputSummary,
          metadata,
          started_at: new Date().toISOString()
        }
      ])
    });
    return rows?.[0] || null;
  } catch (error) {
    console.warn("TOOL_EVENT_START_FAILED", error?.message || error);
    return null;
  }
}

export async function finishAgentToolEvent(id, {
  phase = "completed",
  outputSummary = null,
  metadata = {}
} = {}) {
  if (!id) return null;

  try {
    return await rest(
      `office_agent_tool_events?id=eq.${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          phase,
          output_summary: outputSummary,
          metadata,
          finished_at: new Date().toISOString()
        })
      }
    );
  } catch (error) {
    console.warn("TOOL_EVENT_FINISH_FAILED", error?.message || error);
    return null;
  }
}

export async function createInternalAction(payload) {
  const hasKey = Boolean(payload?.idempotency_key);
  const path = hasKey
    ? "office_action_queue?on_conflict=org_id,idempotency_key"
    : "office_action_queue";
  const rows = await rest(path, {
    method: "POST",
    headers: {
      Prefer: hasKey
        ? "resolution=ignore-duplicates,return=representation"
        : "return=representation"
    },
    body: JSON.stringify([payload])
  });
  return rows?.[0] || null;
}


export async function getRunToolEvents(orgId, runId) {
  if (!runId) return [];
  return rest(
    `office_agent_tool_events?org_id=eq.${encodeURIComponent(orgId)}&run_id=eq.${encodeURIComponent(runId)}&select=id,parent_agent_key,specialist_key,tool_name,phase,input_summary,output_summary,metadata,started_at,finished_at&order=started_at.asc&limit=500`
  );
}

// Every mission id a row refers to (office_mission_id, mission_a_id, other_mission_id…).
const missionIdsOf = row => Object.keys(row || {}).filter(k => /mission_id$/.test(k)).map(k => row[k]).filter(Boolean);
const keepLive = (rows, missions) => {
  const live = new Set((missions || []).map(m => m.id));
  return (rows || []).filter(r => missionIdsOf(r).every(id => live.has(id)));
};

// Global snapshot preloaded for the root Grand Contrôleur / Office Manager AI:
// all missions, assignments, staffing conflicts, team and open alerts.
// Manager runs are stored under the historical agent_key "grand-controleur".
export async function loadRootContext(orgId, { storageKey = "grand-controleur" } = {}) {
  const org = encodeURIComponent(orgId);
  const [missions, assignments, conflicts, staff, openActions, runs] =
    await Promise.all([
      rest(
        `office_missions?org_id=eq.${org}&${LIVE_FILTER}&select=id,mission_code,name,planned_start,planned_end,status&order=planned_end.asc&limit=100`
      ),
      rest(
        `office_mission_assignments?org_id=eq.${org}&select=id,office_mission_id,staff_profile_id,mission_role,cycle_codes,planned_start,planned_end,allocation_pct,status&order=planned_start.asc&limit=200`
      ),
      rest(
        `office_staffing_conflicts?org_id=eq.${org}&select=*&order=overlap_start.asc&limit=50`
      ),
      rest(
        `office_staff_profiles?org_id=eq.${org}&active=eq.true&select=id,full_name,role_title,grade_title,department,weekly_capacity_hours,profile_status&order=full_name.asc&limit=200`
      ),
      rest(
        `office_action_queue?org_id=eq.${org}&action_type=neq.PEOPLE_INTELLIGENCE_RECOMMENDATION&work_state=neq.verified&select=id,agent_key,office_mission_id,assigned_staff_profile_id,action_type,summary,status,work_state,due_at,created_at&order=created_at.desc&limit=100`
      ),
      rest(
        `office_agent_runs?org_id=eq.${org}&agent_key=eq.${encodeURIComponent(storageKey)}&select=id,status,summary,started_at,finished_at,metrics&order=started_at.desc&limit=10`
      )
    ]);

  // Planning of the Grand Contrôleur: active missions only (Paul, 2026-10-07: « dans le Grand
  // Contrôleur il y a des missions annulées »). What belongs to a cancelled, closed or merged
  // mission is left out too.
  const live = new Set((missions || []).map(m => m.id));
  const onLive = id => !id || live.has(id);
  return {
    missions,
    assignments: (assignments || []).filter(a => onLive(a.office_mission_id)),
    conflicts: (conflicts || []).filter(c => missionIdsOf(c).every(onLive)),
    staff,
    openActions: (openActions || []).filter(a => onLive(a.office_mission_id)),
    recentRuns: runs
  };
}

// storageKey: agent_key under which this agent's runs/actions are stored in
// Supabase. For mission-controller it is "grand-controleur" until a dedicated
// office_agent_settings row exists (legacy fallback, see api/agent.js).
export async function loadAgentContext(orgId, agentKey, { storageKey } = {}) {
  const runsKey = encodeURIComponent(storageKey || agentKey);

  // "grand-controleur" is accepted for backward compatibility: before phase 1,
  // the mission-control specialist was registered under that key.
  // The Enhanced Auditor (2026-10-08) works on the same active missions, controls and actions.
  if (agentKey === "mission-controller" || agentKey === "grand-controleur" || agentKey === "enhanced-auditor") {
    const [
      missions,
      controls,
      assignments,
      conflicts,
      staff,
      actions,
      documents,
      runs
    ] = await Promise.all([
      rest(
        `office_missions?org_id=eq.${encodeURIComponent(orgId)}&${LIVE_FILTER}&select=id,mission_code,name,planned_start,planned_end,status&order=planned_end.asc&limit=50`
      ),
      rest(
        `office_mission_controls?org_id=eq.${encodeURIComponent(orgId)}&select=id,office_mission_id,control_code,control_area,title,standard_reference,work_program_reference,expected_evidence,accountable_staff_profile_id,due_at,status,evidence,last_checked_at&order=due_at.asc&limit=100`
      ),
      rest(
        `office_mission_assignments?org_id=eq.${encodeURIComponent(orgId)}&select=id,office_mission_id,staff_profile_id,mission_role,cycle_codes,planned_start,planned_end,allocation_pct,status,source_plan_file_id,source_plan_url,source_plan_modified_at,responsibility_scope,reviewer_profile_id&order=planned_start.asc&limit=100`
      ),
      rest(
        `office_staffing_conflicts?org_id=eq.${encodeURIComponent(orgId)}&select=*&order=overlap_start.asc&limit=50`
      ),
      rest(
        `office_staff_profiles?org_id=eq.${encodeURIComponent(orgId)}&active=eq.true&select=id,full_name,email,role_title,grade_title,department,skills,weekly_capacity_hours,profile_status,cv_url,source_directory_url,source_directory_modified_at,last_directory_sync_at&order=full_name.asc&limit=100`
      ),
      rest(
        `office_action_queue?org_id=eq.${encodeURIComponent(orgId)}&action_type=neq.PEOPLE_INTELLIGENCE_RECOMMENDATION&select=id,agent_key,office_mission_id,assigned_staff_profile_id,action_type,summary,status,work_state,due_at,requested_at,executed_at,verified_at,created_at,evidence&order=created_at.desc&limit=50`
      ),
      rest(
        `orpailleur_inventory?org_id=eq.${encodeURIComponent(orgId)}&is_folder=eq.false&select=file_id,name,folder_path,web_url,modified_at,classification,decision_status,client_name,office_mission_id,document_type,document_period,document_version,content_verified_at&order=modified_at.desc&limit=50`
      ),
      rest(
        `office_agent_runs?org_id=eq.${encodeURIComponent(orgId)}&agent_key=eq.${runsKey}&select=id,status,summary,started_at,finished_at,metrics,errors&order=started_at.desc&limit=10`
      )
    ]);

    // Active missions only; what belongs to a cancelled or closed mission is left out.
    return {
      missions,
      controls: keepLive(controls, missions),
      assignments: keepLive(assignments, missions),
      conflicts: keepLive(conflicts, missions),
      staff,
      actions: keepLive(actions, missions),
      recentDocuments: documents,
      recentRuns: runs
    };
  }

  if (agentKey === "orpailleur") {
    const [scans, documents, archives, actions, runs] = await Promise.all([
      rest(
        `orpailleur_scan_runs?org_id=eq.${encodeURIComponent(orgId)}&select=id,status,started_at,finished_at,heartbeat_at,last_error,folder_count,file_count,page_count,run_origin&order=started_at.desc&limit=10`
      ),
      rest(
        `orpailleur_inventory?org_id=eq.${encodeURIComponent(orgId)}&select=file_id,name,folder_path,web_url,mime_type,modified_at,classification,decision_status,client_name,office_mission_id,document_type,document_period,document_version,source_channel,source_message_id,archive_id,archived_at&order=modified_at.desc&limit=100`
      ),
      rest(
        `office_archives?org_id=eq.${encodeURIComponent(orgId)}&select=id,office_mission_id,archive_code,title,archive_provider,source_folder_id,archive_location,status,retention_until,archived_at,restored_at&order=created_at.desc&limit=50`
      ),
      rest(
        `office_action_queue?org_id=eq.${encodeURIComponent(orgId)}&agent_key=eq.orpailleur&select=id,action_type,summary,status,work_state,created_at,evidence,payload&order=created_at.desc&limit=50`
      ),
      rest(
        `office_agent_runs?org_id=eq.${encodeURIComponent(orgId)}&agent_key=eq.orpailleur&select=id,status,summary,started_at,finished_at,metrics,errors&order=started_at.desc&limit=10`
      )
    ]);

    return {
      scans,
      documents,
      archives,
      actions,
      recentRuns: runs
    };
  }

  const [actions, runs] = await Promise.all([
    rest(
      `office_action_queue?org_id=eq.${encodeURIComponent(orgId)}&agent_key=eq.sika&select=id,action_type,summary,status,work_state,due_at,created_at,evidence,payload&order=created_at.desc&limit=50`
    ),
    rest(
      `office_agent_runs?org_id=eq.${encodeURIComponent(orgId)}&agent_key=eq.sika&select=id,status,summary,started_at,finished_at,metrics,errors&order=started_at.desc&limit=10`
    )
  ]);

  return { actions, recentRuns: runs };
}
