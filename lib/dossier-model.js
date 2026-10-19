// A read model over the existing dossier. No parallel workflow statuses are persisted.
export const AGENTS = Object.freeze({
  auto: {
    name: "Firm Manager",
    job: "Opportunités, capacité, équipe, KYC et décisions proposées",
  },
  "mission-controller": {
    name: "Mission Controller",
    job: "Planning, tâches, pièces attendues et relais",
  },
  "enhanced-auditor": {
    name: "Enhanced Auditor",
    job: "Tests dans les vrais working files, exceptions et revue proposée",
  },
  orpailleur: {
    name: "Orpailleur",
    job: "Recherche, versions, classement vérifié et références partagées",
  },
  sika: {
    name: "SIKA",
    job: "Cotation, budget, facturation et encaissements vérifiés",
  },
  shadow: {
    name: "Shadow",
    job: "Corrections, entraînement et améliorations soumises à validation",
  },
});
const base = ["mission-controller", "orpailleur"];
export function agentsForRole(role) {
  if (["owner", "partner"].includes(role)) return Object.keys(AGENTS);
  if (role === "it_admin") return ["shadow"];
  if (["manager", "supervisor"].includes(role))
    return ["auto", ...base, "enhanced-auditor", "sika"];
  if (["senior", "auditor", "collaborator", "quality_reviewer"].includes(role))
    return ["enhanced-auditor", ...base];
  if (role === "bdm") return ["auto", ...base];
  if (role === "secretary") return [...base, "sika"];
  return [];
}
export const STEPS = Object.freeze([
  [
    "reception",
    "Réception AMI / TDR",
    "BDM / Secrétariat",
    "auto",
    "Lire les exigences et identifier les sources",
    "Dossier et TDR référencés",
    "Associé",
    "auto",
    "opportunities",
  ],
  [
    "decision",
    "GO / GO sous conditions / NO-GO",
    "Associé",
    "auto",
    "Examiner la proposition et décider",
    "Décision humaine et conditions tracées",
    "Manager",
    "auto",
    "opportunities",
  ],
  [
    "team",
    "Équipe et spécialistes",
    "Manager / Associé",
    "auto",
    "Choisir ou modifier l’équipe et rechercher les compétences manquantes",
    "Équipe retenue et besoin spécialiste",
    "Manager",
    "mission-controller",
    "team",
  ],
  [
    "specialists",
    "Contribution du spécialiste",
    "Manager",
    "mission-controller",
    "Suivre contact, réponse, réunion, CV, avis et honoraires",
    "Contribution et choix documentés",
    "Manager / Finance",
    "sika",
    "team",
  ],
  [
    "acceptance",
    "KYC et indépendance",
    "Équipe puis Manager / Associé",
    "auto",
    "Réutiliser les informations connues ; faire confirmer les déclarations personnelles",
    "Validation humaine et points ouverts",
    "Manager",
    "mission-controller",
    "acceptance",
  ],
  [
    "quotation",
    "Cotation du cabinet",
    "Manager / Finance",
    "mission-controller",
    "Utiliser le vrai classeur et expliquer chaque modification",
    "Version de cotation et notification SIKA",
    "Finance",
    "sika",
    "billing",
  ],
  [
    "method",
    "Méthodologie retenue",
    "Manager / spécialistes",
    "mission-controller",
    "Consolider TDR, réunion et méthode du cabinet",
    "Méthodologie et sources retenues",
    "Secrétariat",
    "orpailleur",
    "opportunities",
  ],
  [
    "proposal",
    "Document AMI / offre",
    "Secrétariat",
    "mission-controller",
    "Remplir le modèle officiel avec les vrais CV et références",
    "Document à revoir",
    "Manager / Associé",
    "auto",
    "engagement_letter",
  ],
  [
    "sending",
    "Revue et envoi",
    "Reviewer puis expéditeur autorisé",
    "mission-controller",
    "Corriger, approuver puis envoyer avec preuve",
    "Version, destinataire et preuve de dépôt",
    "BDM",
    "auto",
    "engagement_letter",
  ],
  [
    "handoff",
    "De l’opportunité à la mission",
    "Manager / Associé",
    "mission-controller",
    "Réutiliser client, équipe, KYC, budget et documents",
    "Même dossier transmis à la mission",
    "Équipe de mission",
    "mission-controller",
    "mission",
  ],
  [
    "risks",
    "Études des risques et réunion",
    "Auditeur puis Manager",
    "mission-controller",
    "Comparer les deux analyses sans les fusionner automatiquement",
    "Risques discutés et arbitrés par l’équipe",
    "Senior / Auditeur",
    "enhanced-auditor",
    "workpapers",
  ],
  [
    "analytical",
    "Revue analytique et pièces",
    "Auditeur / Senior",
    "enhanced-auditor",
    "Analyser GL et balance ; rendre visibles les pièces manquantes",
    "Revue documentée et demandes au Manager",
    "Manager",
    "mission-controller",
    "workpapers",
  ],
  [
    "programme",
    "Programme de travail",
    "Manager",
    "mission-controller",
    "Choisir cycles, contrôles, assertions et revues requises",
    "Programme validé et versionné",
    "Auditeur",
    "enhanced-auditor",
    "workpapers",
  ],
  [
    "working_files",
    "Fichiers de travail",
    "Mission Controller puis Auditeur",
    "mission-controller",
    "Réutiliser le fichier du cycle et vérifier son lien avant de travailler",
    "Lien du vrai working file",
    "Auditeur",
    "enhanced-auditor",
    "workpapers",
  ],
  [
    "testing",
    "Tests et exceptions",
    "Auditeur",
    "enhanced-auditor",
    "Tester la population, rattacher les pièces et expliquer les exceptions",
    "Travail documenté ; IA propose, humain conclut",
    "Senior / Manager",
    "enhanced-auditor",
    "workpapers",
  ],
  [
    "review",
    "Revues et sign-offs",
    "Reviewer requis / Associé / EQR",
    "enhanced-auditor",
    "Lever les points et revoir tout changement après signature",
    "Signatures et points encore ouverts",
    "Associé",
    "mission-controller",
    "workpapers",
  ],
  [
    "learning",
    "Corrections et apprentissage",
    "Chaque personne puis validateur",
    "shadow",
    "Transmettre les corrections et proposer les améliorations",
    "Leçon ou méthode à valider",
    "Équipe / agents",
    "shadow",
    "shadow",
  ],
]);
const encode = encodeURIComponent;
export function stepLink(id, { opportunityId, missionId }) {
  const o = opportunityId
    ? "/opportunites.html?id=" + encode(opportunityId)
    : "/opportunites.html";
  const m = missionId
    ? "/mission.html?id=" + encode(missionId)
    : "/mission.html";
  if (
    [
      "reception",
      "decision",
      "team",
      "acceptance",
      "specialists",
      "quotation",
      "method",
    ].includes(id)
  )
    return (
      o +
      ({
        team: "#team-card",
        acceptance: "#kyc-card",
        quotation: "#quotation-card",
      }[id] || "")
    );
  if (["proposal", "sending"].includes(id))
    return (
      "/secretariat.html?" +
      new URLSearchParams(
        opportunityId
          ? { opportunity_id: opportunityId }
          : missionId
            ? { mission_id: missionId }
            : {},
      )
    );
  if (["programme", "working_files", "testing"].includes(id))
    return missionId ? "/programme.html?mission_id=" + encode(missionId) : m;
  if (id === "learning") return "/entrainement.html";
  return (
    m +
    ({ risks: "#h-risks", analytical: "#h-docs", review: "#h-review" }[id] ||
      "")
  );
}
// The application's own view of each step (recorded / review / pending), also used by the firm's workflow (lib/firm-workflow.js).
export function dossierStates({ opportunity: o, mission: m, programme: p, work = [] }) {
  const states = {};
  if (o) {
    states.reception = o.tdr_files?.length ? "recorded" : "pending";
    states.decision = ["go", "stop", "won", "phase1"].includes(o.status)
      ? "recorded"
      : "pending";
    states.specialists = Object.values(o.team?.specialists || {}).some((g) =>
      (g.list || []).some((s) => s.followup),
    )
      ? "review"
      : "pending";
    // Status of the dossier is not a human GO decision.
    states.team = o.team?.status === "validated" ? "recorded" : "pending";
    states.acceptance =
      o.kyc_review?.status === "accepted" ? "recorded" : "pending";
    states.quotation = o.quotation?.file?.id ? "review" : "pending";
    states.sending = (o.submissions || []).some(
      (s) => s.status === "sent" && s.proof,
    )
      ? "recorded"
      : "pending";
    states.handoff = o.handoff?.status === "complete" ? "recorded" : "pending";
  }
  if (m) {
    states.risks = (m.risks || []).length ? "review" : "pending";
    states.programme = p?.status === "validated" ? "recorded" : "pending";
    const cycles = (p?.cycles || []).filter(
      (c) => c.status !== "N/A_JUSTIFIED",
    );
    states.working_files =
      cycles.length &&
      cycles.every((c) =>
        (p.workpapers || []).some(
          (w) => w.cycle_code === c.cycle_code && w.file_id,
        ),
      )
        ? "recorded"
        : "pending";
    states.testing = work.length ? "review" : "pending";
    // A stored signature is not a fresh verification of the current file hash.
    states.review = work.some((w) =>
      (w.reviews || []).some((r) => r.kind === "signoff" && !r.revoked),
    )
      ? "review"
      : "pending";
  }
  return states;
}
export function dossierSteps({
  opportunity: o,
  mission: m,
  programme: p,
  work = [],
  permissions = {},
  states = dossierStates({ opportunity: o, mission: m, programme: p, work }),
}) {
  const ids = { opportunityId: o?.id, missionId: m?.mission?.id };
  return STEPS.filter(
    (s, i) => (o || i >= 10) && (m || i < 10 || s[0] === "learning"),
  )
    .filter(
      (s) => permissions[s[8]]?.level && permissions[s[8]].level !== "none",
    )
    .map((s) => ({
      id: s[0],
      label: s[1],
      person: s[2],
      agent: s[3],
      action: s[4],
      result: s[5],
      next_person: s[6],
      next_agent: s[7],
      screen: s[8],
      state: states[s[0]] || "pending",
      href: stepLink(s[0], ids),
    }));
}
export function procedureSummary(
  programme,
  work = [],
  role = "auditor",
  email = "",
) {
  const byCode = new Map(work.map((w) => [w.procedure_code, w]));
  const detail = [
    "owner",
    "partner",
    "manager",
    "supervisor",
    "quality_reviewer",
    "senior",
  ].includes(role);
  return (programme?.cycles || [])
    .filter((c) => c.status !== "N/A_JUSTIFIED")
    .map((c) => {
      const rows = (c.procedures || [])
        .filter((p) => p.active)
        .map((p) => {
          const w = byCode.get(p.code);
          const items = w?.items || [];
          return {
            code: p.code,
            title: p.title,
            preparer: p.preparer || c.preparer || null,
            status: w?.status || "not_started",
            tested: items.filter((i) => i.result).length,
            sample: items.length,
            exceptions: items.filter((i) => i.result === "EXCEPTION").length,
            missing: items.filter(
              (i) =>
                !i.result || (!(i.evidence || []).length && !i.evidence_ref),
            ).length,
            open_points: (w?.review_points || []).filter(
              (x) => x.status !== "cleared",
            ).length,
            signatures: (w?.reviews || []).filter(
              (r) => r.kind === "signoff" && !r.revoked,
            ).length,
            href:
              "/procedure.html?" +
              new URLSearchParams({
                mission_id: programme.office_mission_id,
                code: p.code,
              }),
          };
        })
        .filter(
          (p) =>
            detail ||
            String(p.preparer || "").toLowerCase() ===
              String(email).toLowerCase(),
        );
      return {
        code: c.cycle_code,
        title: c.cycle_title,
        file:
          (programme.workpapers || []).find(
            (w) => w.cycle_code === c.cycle_code,
          ) || null,
        procedures: rows,
      };
    })
    .filter((c) => c.procedures.length || detail);
}
