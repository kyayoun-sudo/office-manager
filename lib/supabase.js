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

export async function loadAgentContext(orgId, agentKey) {
  if (agentKey === "grand-controleur") {
    const [missions, actions, runs] = await Promise.all([
      rest(
        `office_missions?org_id=eq.${encodeURIComponent(orgId)}&select=id,mission_code,name,planned_start,planned_end,status&order=planned_end.asc&limit=30`
      ),
      rest(
        `office_action_queue?org_id=eq.${encodeURIComponent(orgId)}&select=id,agent_key,action_type,summary,status,created_at,evidence&order=created_at.desc&limit=30`
      ),
      rest(
        `office_agent_runs?org_id=eq.${encodeURIComponent(orgId)}&agent_key=eq.grand-controleur&select=id,status,summary,started_at,finished_at,metrics,errors&order=started_at.desc&limit=10`
      )
    ]);

    return { missions, actions, recentRuns: runs };
  }

  if (agentKey === "orpailleur") {
    const [scans, actions, runs] = await Promise.all([
      rest(
        `orpailleur_scan_runs?org_id=eq.${encodeURIComponent(orgId)}&select=id,status,started_at,finished_at,heartbeat_at,last_error,folder_count,file_count,page_count,run_origin&order=started_at.desc&limit=10`
      ),
      rest(
        `office_action_queue?org_id=eq.${encodeURIComponent(orgId)}&agent_key=eq.orpailleur&select=id,action_type,summary,status,created_at,evidence,payload&order=created_at.desc&limit=30`
      ),
      rest(
        `office_agent_runs?org_id=eq.${encodeURIComponent(orgId)}&agent_key=eq.orpailleur&select=id,status,summary,started_at,finished_at,metrics,errors&order=started_at.desc&limit=10`
      )
    ]);

    return { scans, actions, recentRuns: runs };
  }

  const [actions, runs] = await Promise.all([
    rest(
      `office_action_queue?org_id=eq.${encodeURIComponent(orgId)}&agent_key=eq.sika&select=id,action_type,summary,status,created_at,evidence,payload&order=created_at.desc&limit=30`
    ),
    rest(
      `office_agent_runs?org_id=eq.${encodeURIComponent(orgId)}&agent_key=eq.sika&select=id,status,summary,started_at,finished_at,metrics,errors&order=started_at.desc&limit=10`
    )
  ]);

  return { actions, recentRuns: runs };
}
