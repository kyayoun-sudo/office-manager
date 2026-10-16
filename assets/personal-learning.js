(function () {
  "use strict";
  var OM = window.OfficeManager,
    $ = (id) => document.getElementById(id),
    data = null,
    session = null,
    busy = false,
    mode = new URLSearchParams(location.search).get("mode") || "monthly";
  if (!["monthly", "agent", "collaboration"].includes(mode)) mode = "monthly";
  function el(tag, text) {
    var n = document.createElement(tag);
    if (text != null) n.textContent = text;
    return n;
  }
  function button(host, text, fn) {
    var b = el("button", text);
    b.type = "button";
    b.className = "btn ghost";
    b.onclick = fn;
    host.appendChild(b);
    return b;
  }
  function api(body) {
    return OM.api(
      "/api/app?route=personal-learning",
      body ? { method: "POST", body: JSON.stringify(body) } : undefined,
    );
  }
  function setBusy(value) {
    busy = value;
    document
      .querySelectorAll("main button,main textarea,main select")
      .forEach((n) => (n.disabled = value || n.dataset.readonly === "true"));
  }
  function error(e) {
    var codes = {
      THREE_ANSWERS_REQUIRED: "Répondez aux trois questions avant de terminer.",
      LEARNING_CHANGED_RELOAD:
        "La session a changé dans un autre onglet. Rechargez la page avant de continuer.",
      AGENT_NOT_ALLOWED_FOR_ROLE:
        "Cet agent n’est pas disponible pour votre rôle.",
      PREFERENCE_REQUIRED: "Ajoutez une consigne ou un exemple.",
      USER_SESSION_REQUIRED: "Connectez-vous avec votre compte personnel.",
    };
    $("learning-status").textContent =
      codes[e.message] || "Action impossible : " + e.message;
  }
  function action(fn) {
    if (busy) return;
    setBusy(true);
    $("learning-status").textContent = "Préparation en cours…";
    Promise.resolve()
      .then(fn)
      .catch(error)
      .finally(() => setBusy(false));
  }
  function drawSession(s) {
    session = s;
    $("learning-session").hidden = false;
    $("learning-session-title").textContent =
      s.kind === "collaboration"
        ? "Cas pratique de collaboration"
        : s.kind === "monthly"
          ? "Mes trois questions du mois"
          : "Entraînement libre";
    $("learning-source").textContent =
      (s.source === "ai"
        ? "Questions préparées par Shadow avec l’IA."
        : "IA indisponible ou non autorisée : exercice de référence adapté à votre rôle.") +
      " Cas fictif.";
    $("learning-case").textContent = s.scenario;
    var host = $("learning-questions");
    host.textContent = "";
    s.questions.forEach((q, i) => {
      var row = el("div");
      row.className = "learning-question";
      var label = el("label", i + 1 + ". " + q.text);
      label.htmlFor = "answer-" + q.id;
      var input = el("textarea");
      input.id = label.htmlFor;
      input.maxLength = 4000;
      input.value = s.answers[q.id] || "";
      input.dataset.readonly = String(Boolean(s.completed_at));
      row.append(label, input);
      if (s.completed_at) {
        var f = (s.feedback || []).find((f) => f.id === q.id);
        var feedback = el("div");
        feedback.className = "learning-feedback";
        feedback.appendChild(
          el(
            "strong",
            s.feedback_source === "ai"
              ? "Retour de Shadow"
              : "Correction de référence · sans évaluation IA",
          ),
        );
        feedback.appendChild(el("p", f ? f.comment : ""));
        feedback.appendChild(el("p", f ? f.next_step : q.reference));
        row.appendChild(feedback);
      }
      host.appendChild(row);
    });
    $("learning-draft").hidden = $("learning-submit").hidden = Boolean(
      s.completed_at,
    );
    if (s.completed_at)
      $("learning-status").textContent =
        "Session terminée. Vous pouvez continuer à vous entraîner librement.";
    setBusy(busy);
  }
  function drawPreferences() {
    var p = data.preferences[$("learning-agent-choice").value] || {};
    $("agent-desired").value = p.desired || "";
    $("agent-avoid").value = p.avoid || "";
    $("agent-example").value = p.example || "";
  }
  async function refresh() {
    data = await api();
    $("learning-role").textContent =
      "Votre parcours : " +
      data.role_label +
      (data.position ? " · " + data.position : "");
    var history = $("learning-history");
    history.textContent = "";
    data.sessions
      .filter((s) =>
        mode === "agent"
          ? false
          : mode === "collaboration"
            ? s.kind === "collaboration"
            : s.kind !== "collaboration",
      )
      .slice(0, 24)
      .forEach((s) =>
        button(
          history,
          (s.kind === "monthly"
            ? "Session mensuelle " + s.month
            : s.kind === "collaboration"
              ? "Collaboration"
              : "Entraînement libre") +
            " · " +
            (s.completed_at ? "terminée" : "à reprendre"),
          () => drawSession(s),
        ),
      );
    if (!history.children.length)
      history.appendChild(
        el(
          "p",
          mode === "agent"
            ? "Vos consignes sont enregistrées séparément de vos exercices."
            : "Aucune session commencée.",
        ),
      );
    if (mode === "agent") {
      var choice = $("learning-agent-choice"),
        previous = choice.value;
      choice.textContent = "";
      data.agents.forEach((a) => choice.appendChild(new Option(a.name, a.key)));
      if (data.agents.some((a) => a.key === previous)) choice.value = previous;
      drawPreferences();
      $("agent-form").hidden = !data.agents.length;
    }
  }
  async function start(kind) {
    var r = await api({ action: "start", kind: kind });
    await refresh();
    drawSession(r.session);
    if (!r.session.completed_at)
      $("learning-status").textContent =
        "Répondez à votre rythme. Enregistrez avant de quitter la page.";
  }
  async function answer(submit) {
    if (!session) return;
    var answers = {};
    session.questions.forEach(
      (q) => (answers[q.id] = $("answer-" + q.id).value),
    );
    var r = await api({
      action: "answer",
      session_id: session.id,
      revision: session.revision,
      answers: answers,
      submit: submit,
    });
    await refresh();
    drawSession(r.session);
    if (!submit)
      $("learning-status").textContent =
        "Réponses enregistrées. Vous pouvez reprendre plus tard.";
  }
  async function preference(clear) {
    await api({
      action: "preference",
      agent: $("learning-agent-choice").value,
      revision: data.revision,
      desired: $("agent-desired").value,
      avoid: $("agent-avoid").value,
      example: $("agent-example").value,
      clear: clear,
    });
    await refresh();
    $("learning-status").textContent = clear
      ? "Consignes retirées."
      : "Consignes retenues pour vos prochaines conversations avec cet agent.";
  }
  document.querySelectorAll("[data-mode]").forEach((a) => {
    if (a.dataset.mode === mode) a.setAttribute("aria-current", "page");
  });
  $("learning-agent").hidden = mode !== "agent";
  $("learning-title").textContent =
    mode === "monthly"
      ? "M’améliorer dans mon métier"
      : mode === "agent"
        ? "Entraîner mon IA"
        : "Mieux travailler avec mon agent";
  $("learning-description").textContent =
    mode === "monthly"
      ? "Chaque mois, Shadow vous propose trois questions adaptées à votre rôle. Vous recevez un rappel dans vos notifications. Vous pouvez aussi lancer un entraînement libre à tout moment."
      : mode === "agent"
        ? "Apprenez à votre agent votre façon de présenter et de préparer le travail, avec vos consignes et vos exemples. Les agents proposés dépendent de votre rôle."
        : "Sur un cas fictif adapté à votre rôle, entraînez-vous à demander le bon travail à l’IA, vérifier sa proposition et lui faire corriger une erreur.";
  if (mode === "monthly") {
    button($("learning-start"), "Ouvrir mes trois questions du mois", () =>
      action(() => start("monthly")),
    );
    button($("learning-start"), "M’entraîner maintenant", () =>
      action(() => start("practice")),
    );
  }
  if (mode === "collaboration")
    button($("learning-start"), "Commencer ou reprendre un cas", () =>
      action(() => start("collaboration")),
    );
  $("learning-draft").onclick = () => action(() => answer(false));
  $("learning-answer-form").onsubmit = (e) => {
    e.preventDefault();
    action(() => answer(true));
  };
  $("learning-agent-choice").onchange = drawPreferences;
  $("agent-form").onsubmit = (e) => {
    e.preventDefault();
    action(() => preference(false));
  };
  $("agent-clear").onclick = () => action(() => preference(true));
  if (!OM) return;
  action(async () => {
    await refresh();
    $("learning-status").textContent =
      mode === "monthly"
        ? data.due
          ? "Votre session mensuelle de trois questions est à faire."
          : "Votre session mensuelle est terminée. Un entraînement libre reste disponible."
        : "Choisissez votre parcours.";
  });
})();
