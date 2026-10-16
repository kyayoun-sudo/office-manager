import { createHash, randomUUID } from "node:crypto";
const fail = (code, statusCode = 400) =>
  Object.assign(new Error(code), { statusCode });
export const leads = (a) =>
  ["owner", "partner"].includes(a?.role) && Boolean(a?.email);
export function independenceCases(o) {
  const members = new Set(
    (o.team?.members || [])
      .filter((m) => !m.external)
      .map((m) => String(m.email || m.name).toLowerCase()),
  );
  const cases = [];
  for (const [person, d] of Object.entries(o.declarations || {})) {
    for (const [ref, answer] of Object.entries(d.answers || {})) {
      if (answer.answer !== "Oui") continue;
      const version = createHash("sha256")
        .update(
          JSON.stringify({
            person,
            ref,
            answer: answer.answer,
            detail: answer.detail || "",
            at: d.at,
          }),
        )
        .digest("hex");
      const id = createHash("sha256")
        .update(person + "|" + ref)
        .digest("hex")
        .slice(0, 20);
      const saved = o.independence_reviews?.[id];
      if (!members.has(person) && !saved) continue;
      const explanation = String(answer.detail || "");
      cases.push({
        id,
        version,
        person,
        name: d.name,
        ref,
        explanation,
        question: (d.threats || []).find((t) => t.startsWith(ref + " ")) || ref,
        status: "pending",
        suggestions: safeguardSuggestions(explanation),
        ...(saved?.version === version ? saved : {}),
        ...(saved?.prohibited
          ? { prohibited: true, status: "prohibited" }
          : {}),
        active_member: members.has(person),
      });
    }
  }
  for (const saved of Object.values(o.independence_reviews || {})) {
    if (!members.has(saved.person) || cases.some((c) => c.id === saved.id))
      continue;
    const declaration = o.declarations?.[saved.person];
    const answer = declaration?.answers?.[saved.ref];
    const version = createHash("sha256")
      .update(
        JSON.stringify({
          person: saved.person,
          ref: saved.ref,
          answer: answer?.answer,
          detail: answer?.detail || "",
          at: declaration?.at,
        }),
      )
      .digest("hex");
    const unchanged = saved.version === version;
    cases.push({
      ...saved,
      version,
      active_member: true,
      source_changed: !unchanged,
      declaration_withdrawn: true,
      explanation:
        answer?.detail ||
        "La réponse est maintenant Non : correction de la menace à examiner par le Partner / Owner.",
      ...(unchanged
        ? {}
        : {
            status: "pending",
            selected: [],
            custom: "",
            note: "",
            application: null,
            by: null,
          }),
      ...(saved.prohibited ? { status: "prohibited", prohibited: true } : {}),
      suggestions: [
        {
          id: "confirm_correction",
          label: "Vérifier et documenter la correction de la déclaration",
          why: "Une menace précédemment déclarée ne se clôture pas par un simple changement de réponse.",
        },
        ...(saved.suggestions || []).filter(
          (s) => s.id !== "confirm_correction",
        ),
      ],
    });
  }
  return cases;
}
// Structured suggestions, NOT a legal conclusion or a generated finding of compliance.
export function safeguardSuggestions(explanation) {
  const s = String(explanation || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const out = [
    {
      id: "independent_review",
      label: "Faire revoir les travaux concernés par une personne indépendante",
      why: "Une revue distincte peut répondre à certaines menaces ; son adéquation doit être appréciée par le Partner.",
    },
    {
      id: "replace_member",
      label: "Retirer ou remplacer la personne sur la mission",
      why: "À examiner si la participation ne peut pas être rendue acceptable.",
    },
  ];
  if (/famill|conjoint|parent|frere|soeur|proche|relation/.test(s))
    out.unshift({
      id: "restrict_scope",
      label:
        "Exclure la personne des travaux et décisions liés à la relation déclarée",
      why: "Proposition liée à la relation décrite ; ne suffit pas à elle seule si la participation est interdite.",
    });
  if (/action|part|financ|pret|interet|invest/.test(s))
    out.unshift({
      id: "end_interest",
      label:
        "Faire cesser l’intérêt ou le lien concerné et en vérifier la preuve",
      why: "Proposition liée à l’intérêt décrit ; vérifier aussi les interdictions et périodes applicables.",
    });
  if (/ancien|emploi|salar|comptab|conseil|prepare/.test(s))
    out.unshift({
      id: "no_self_review",
      label:
        "Confier à une autre personne les travaux susceptibles d’auto-révision",
      why: "Proposition liée aux travaux ou fonctions antérieurs décrits.",
    });
  return out;
}
export function reviewIndependence(o, input, account) {
  if (!leads(account)) throw fail("PARTNER_OR_OWNER_REQUIRED", 403);
  const c = independenceCases(o).find((c) => c.id === input.case_id);
  if (!c) throw fail("INDEPENDENCE_CASE_NOT_FOUND", 404);
  if (c.version !== input.version)
    throw fail("DECLARATION_CHANGED_REVIEW_AGAIN", 409);
  if (!c.explanation.trim() && input.action !== "independence-prohibit")
    throw fail("INDEPENDENCE_EXPLANATION_REQUIRED");
  const action = input.action,
    note = String(input.note || "")
      .trim()
      .slice(0, 2000);
  if (!note) throw fail("DECISION_REASON_REQUIRED");
  let next = {
    ...c,
    by: account.email,
    by_role: account.role,
    at: new Date().toISOString(),
    responsible: account.email,
  };
  if (action === "independence-decide") {
    const selected = (
      Array.isArray(input.selected) ? input.selected : []
    ).filter((x) => c.suggestions.some((s) => s.id === x));
    const custom = String(input.custom || "")
      .trim()
      .slice(0, 2000);
    if (!selected.length && !custom) throw fail("SAFEGUARD_REQUIRED");
    next = {
      ...next,
      status: "measures_pending",
      selected,
      custom,
      note,
      decision_id: randomUUID(),
      application: null,
    };
  } else if (action === "independence-applied") {
    if (c.status !== "measures_pending")
      throw fail("SAFEGUARDS_NOT_DECIDED", 409);
    if (
      c.selected?.includes("replace_member") &&
      (o.team?.members || []).some(
        (m) => String(m.email || m.name).toLowerCase() === c.person,
      )
    )
      throw fail("REMOVE_MEMBER_FROM_TEAM_FIRST", 409);
    const evidence = String(input.evidence || "")
      .trim()
      .slice(0, 1000);
    if (!evidence) throw fail("APPLICATION_EVIDENCE_REQUIRED");
    next = {
      ...next,
      status: "resolved",
      application: { by: account.email, at: next.at, note, evidence },
    };
  } else if (action === "independence-override") {
    const business = String(input.business_reason || "")
      .trim()
      .slice(0, 2000);
    if (!business) throw fail("BUSINESS_REASON_REQUIRED");
    if (c.prohibited || input.prohibited === true)
      throw fail("INDEPENDENCE_PROHIBITION_NO_OVERRIDE", 409);
    if (
      input.confirm_no_prohibition !== true ||
      !String(input.regulatory_basis || "").trim()
    )
      throw fail("APPLICABLE_RULE_REVIEW_REQUIRED");
    next = {
      ...next,
      status: "override_open",
      note,
      business_reason: business,
      regulatory_basis: String(input.regulatory_basis).slice(0, 1500),
      independence_resolved: false,
      application: null,
    };
  } else if (action === "independence-prohibit")
    next = {
      ...next,
      status: "prohibited",
      prohibited: true,
      note,
      application: null,
    };
  else throw fail("UNKNOWN_ACTION");
  // A confirmed prohibition may not be silently lifted by selecting safeguards.
  if (c.prohibited && action !== "independence-prohibit")
    throw fail("INDEPENDENCE_PROHIBITION_NO_OVERRIDE", 409);
  (o.independence_history ||= []).push({
    case_id: c.id,
    previous: c,
    decision: next,
    at: next.at,
  });
  (o.independence_reviews ||= {})[c.id] = next;
  return next;
}
export function assertIndependenceContinuation(
  o,
  { allowOverride = false } = {},
) {
  const cases = independenceCases(o).filter((c) => c.active_member);
  if (cases.some((c) => c.prohibited))
    throw fail("INDEPENDENCE_PROHIBITION_NO_OVERRIDE", 409);
  if (
    cases.some(
      (c) =>
        c.status !== "resolved" &&
        !(allowOverride && c.status === "override_open"),
    )
  )
    throw fail("INDEPENDENCE_REVIEW_REQUIRED", 409);
}
