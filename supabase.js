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
    try { data = JSON.parse(raw); }
    catch { data = raw; }
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

function text(value) {
  return String(value ?? "").toLowerCase();
}

function matches(row, query, fields) {
  const q = text(query).trim();
  if (!q) return true;
  return fields.some(field => text(row?.[field]).includes(q));
}

function safeLimit(value, fallback = 20, max = 100) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(parsed)));
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

export async function createToolEvent(payload) {
  const rows = await rest("office_agent_tool_events", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([payload])
  });
  return rows?.[0] || null;
}

export async function finishToolEvent(id, patch) {
  if (!id) return null;
  return rest(`office_agent_tool_events?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(patch)
  });
}

export async function getTeamDirectory(orgId, limit = 100) {
  return rest(
    `office_staff_profiles?org_id=eq.${encodeURIComponent(orgId)}&active=eq.true&select=id,full_name,email,phone,role_title,grade_title,department,reports_to_profile_id,skills,permission_tags,profile_status&order=full_name.asc&limit=${safeLimit(limit, 100, 250)}`
  );
}

export async function searchTeamMembers(orgId, query, limit = 10) {
  const rows = await getTeamDirectory(orgId, 250);
  return rows
    .filter(row => matches(row, query, [
      "full_name", "email", "role_title", "grade_title", "department"
    ]))
    .slice(0, safeLimit(limit, 10, 30));
}

export async function searchMissions(orgId, query, limit = 20) {
  const rows = await rest(
    `office_missions?org_id=eq.${encodeURIComponent(orgId)}&select=id,legacy_mission_id,mission_code,name,planned_start,planned_end,status&order=planned_end.asc&limit=150`
  );
  return rows
    .filter(row => matches(row, query, ["mission_code", "name", "status"]))
    .slice(0, safeLimit(limit, 20, 50));
}

export async function searchDocuments(orgId, query, limit = 20) {
  const rows = await rest(
    `orpailleur_inventory?org_id=eq.${encodeURIComponent(orgId)}&is_folder=eq.false&select=drive_id,file_id,name,folder_path,web_url,modified_at,classification,decision_status,client_name,office_mission_id,document_type,document_period,document_version,source_channel,source_message_id,source_thread_id,filing_reason,confidence,archive_id,archived_at,details&order=last_seen_at.desc&limit=500`
  );

  return rows
    .filter(row => {
      const detailsText = (() => {
        try { return JSON.stringify(row.details || {}); }
        catch { return ""; }
      })();
      return matches(
        { ...row, details_text: detailsText },
        query,
        ["name", "folder_path", "client_name", "document_type", "document_period", "details_text"]
      );
    })
    .slice(0, safeLimit(limit, 20, 50));
}

export async function searchArchives(orgId, query, limit = 20) {
  const rows = await rest(
    `office_archives?org_id=eq.${encodeURIComponent(orgId)}&select=id,office_mission_id,archive_code,title,archive_provider,archive_location,status,retention_until,archived_at,restored_at,metadata,created_at,updated_at&order=updated_at.desc&limit=200`
  );
  return rows
    .filter(row => matches(row, query, [
      "archive_code", "title", "archive_provider", "archive_location", "status"
    ]))
    .slice(0, safeLimit(limit, 20, 50));
}

export async function getMissionControls(orgId, missionId, limit = 100) {
  if (!missionId) return [];
  return rest(
    `office_mission_controls?org_id=eq.${encodeURIComponent(orgId)}&office_mission_id=eq.${encodeURIComponent(missionId)}&select=id,office_mission_id,control_code,control_area,title,standard_reference,sop_id,sop_step_id,work_program_reference,expected_evidence,accountable_staff_profile_id,due_at,status,evidence,rationale,last_checked_at,updated_at&order=control_area.asc,control_code.asc&limit=${safeLimit(limit, 100, 250)}`
  );
}

export async function getMissionAssignments(orgId, missionId) {
  if (!missionId) return [];
  return rest(
    `office_mission_assignments?org_id=eq.${encodeURIComponent(orgId)}&office_mission_id=eq.${encodeURIComponent(missionId)}&select=id,office_mission_id,staff_profile_id,mission_role,cycle_codes,planned_start,planned_end,allocation_pct,status,approved_at&order=planned_start.asc&limit=100`
  );
}

export async function getOpenActions(orgId, query = "", limit = 50) {
  const rows = await rest(
    `office_action_queue?org_id=eq.${encodeURIComponent(orgId)}&select=id,agent_key,office_mission_id,action_type,summary,status,work_state,assigned_staff_profile_id,due_at,requested_at,executed_at,verified_at,reminder_channel,provider_message_id,provider_thread_id,evidence,verification_evidence,created_at&order=created_at.desc&limit=200`
  );

  return rows
    .filter(row => !["verified", "cancelled"].includes(String(row.status || "")))
    .filter(row => matches(row, query, ["summary", "action_type", "agent_key", "status", "work_state"]))
    .slice(0, safeLimit(limit, 50, 100));
}

export async function createActionProposal({
  orgId,
  agentKey,
  missionId = null,
  actionType,
  summary,
  assignedStaffProfileId = null,
  dueAt = null,
  evidenceSummary = null,
  payload = {}
}) {
  const now = new Date().toISOString();
  const idempotencyKey = [
    "v2_1",
    agentKey,
    Date.now(),
    Math.random().toString(36).slice(2, 10)
  ].join(":");

  const rows = await rest("office_action_queue", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([{
      org_id: orgId,
      agent_key: agentKey,
      office_mission_id: missionId || null,
      action_type: actionType,
      idempotency_key: idempotencyKey,
      summary,
      payload: {
        source: "office-manager-v2.1",
        ...payload
      },
      evidence: evidenceSummary ? { summary: evidenceSummary } : {},
      status: "proposed",
      assigned_staff_profile_id: assignedStaffProfileId || null,
      due_at: dueAt || null,
      requested_at: now,
      work_state: "requested",
      verification_evidence: {}
    }])
  });

  return rows?.[0] || null;
}

async function loadLegacyMissionExecution(missions) {
  const legacyIds = (missions || [])
    .map(row => row.legacy_mission_id)
    .filter(Boolean);

  if (!legacyIds.length) {
    return {
      legacyMissions: [],
      pbcItems: [],
      workstreams: [],
      workingPapers: []
    };
  }

  const inFilter = `in.(${legacyIds.join(",")})`;

  const [legacyMissions, pbcItems, workstreams, workingPapers] = await Promise.all([
    rest(
      `missions?id=${inFilter}&select=id,mission_code,service_type,title,period_label,start_date,planned_end_date,actual_end_date,status,rag_status,planning_document_url,planning_file_id,planning_modified_at,planning_extracted_at,planning_extract,responsibility_extract,pbc_master_url,mission_folder_url,deliverable_due_date,billing_status,notes&limit=100`
    ),
    rest(
      `pbc_items?mission_id=${inFilter}&select=id,mission_id,workstream_id,pbc_code,category,document_requested,expected_filename,requested_date,due_date,blocking,received,conformity_status,received_at,file_url,reminder_required,notes&order=due_date.asc&limit=300`
    ),
    rest(
      `workstreams?mission_id=${inFilter}&select=id,mission_id,workstream_code,name,terminology,applicable,risk_level,planned_start,planned_end,owner_staff_id,reviewer_staff_id,dependencies,status,source_document_url&order=planned_end.asc&limit=300`
    ),
    rest(
      `working_papers?mission_id=${inFilter}&select=id,mission_id,workstream_id,wp_code,title,preparer_staff_id,reviewer_staff_id,planned_date,prepared_at,reviewed_at,review_status,open_review_notes,critical_review_notes,conclusion_signed,file_url,status&order=planned_date.asc&limit=500`
    )
  ]);

  return { legacyMissions, pbcItems, workstreams, workingPapers };
}

export async function loadAgentContext(orgId, agentKey) {
  if (agentKey === "grand-controleur") {
    const [missions, actions, runs, controls, assignments, staff, reviews, sops] =
      await Promise.all([
        rest(
          `office_missions?org_id=eq.${encodeURIComponent(orgId)}&select=id,legacy_mission_id,mission_code,name,planned_start,planned_end,status&order=planned_end.asc&limit=40`
        ),
        getOpenActions(orgId, "", 60),
        rest(
          `office_agent_runs?org_id=eq.${encodeURIComponent(orgId)}&agent_key=eq.grand-controleur&select=id,status,summary,started_at,finished_at,metrics,errors&order=started_at.desc&limit=10`
        ),
        rest(
          `office_mission_controls?org_id=eq.${encodeURIComponent(orgId)}&select=id,office_mission_id,control_code,control_area,title,standard_reference,work_program_reference,expected_evidence,accountable_staff_profile_id,due_at,status,evidence,rationale,last_checked_at&order=updated_at.desc&limit=100`
        ),
        rest(
          `office_mission_assignments?org_id=eq.${encodeURIComponent(orgId)}&select=id,office_mission_id,staff_profile_id,mission_role,cycle_codes,planned_start,planned_end,allocation_pct,status&order=planned_end.asc&limit=100`
        ),
        getTeamDirectory(orgId, 100),
        rest(
          `office_process_reviews?org_id=eq.${encodeURIComponent(orgId)}&select=id,sop_id,step_id,office_mission_id,agent_key,result,evidence_url,rationale,reviewed_at,resolution_status&order=reviewed_at.desc&limit=100`
        ),
        rest(
          `office_sops?org_id=eq.${encodeURIComponent(orgId)}&select=id,code,title,function_area,service_type,owner_role,version_label,status,effective_date,summary&order=updated_at.desc&limit=50`
        )
      ]);

    const legacyExecution = await loadLegacyMissionExecution(missions);

    return {
      missions,
      controls,
      assignments,
      staff,
      processReviews: reviews,
      sops,
      actions,
      recentRuns: runs,
      ...legacyExecution
    };
  }

  if (agentKey === "orpailleur") {
    const [scans, actions, runs, inventory, archives] = await Promise.all([
      rest(
        `orpailleur_scan_runs?org_id=eq.${encodeURIComponent(orgId)}&select=id,status,started_at,finished_at,heartbeat_at,last_error,folder_count,file_count,page_count,run_origin&order=started_at.desc&limit=10`
      ),
      getOpenActions(orgId, "orpailleur", 40),
      rest(
        `office_agent_runs?org_id=eq.${encodeURIComponent(orgId)}&agent_key=eq.orpailleur&select=id,status,summary,started_at,finished_at,metrics,errors&order=started_at.desc&limit=10`
      ),
      rest(
        `orpailleur_inventory?org_id=eq.${encodeURIComponent(orgId)}&is_folder=eq.false&select=file_id,name,folder_path,web_url,modified_at,last_seen_at,content_verified_at,classification,decision_status,client_name,office_mission_id,document_type,document_period,document_version,source_channel,filing_reason,confidence,archive_id,archived_at&order=last_seen_at.desc&limit=100`
      ),
      rest(
        `office_archives?org_id=eq.${encodeURIComponent(orgId)}&select=id,office_mission_id,archive_code,title,archive_provider,archive_location,status,retention_until,archived_at,restored_at&order=updated_at.desc&limit=50`
      )
    ]);

    return { scans, inventory, archives, actions, recentRuns: runs };
  }

  const [actions, runs, staff] = await Promise.all([
    getOpenActions(orgId, "sika", 60),
    rest(
      `office_agent_runs?org_id=eq.${encodeURIComponent(orgId)}&agent_key=eq.sika&select=id,status,summary,started_at,finished_at,metrics,errors&order=started_at.desc&limit=10`
    ),
    getTeamDirectory(orgId, 100)
  ]);

  return { actions, staff, recentRuns: runs };
}
