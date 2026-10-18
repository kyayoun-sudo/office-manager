(function () {
  var OM = window.OfficeManager;
  if (!OM || !OM.isOwner()) return;
  var section = document.createElement("section");
  section.className = "card";
  section.id = "audit-sandbox";
  var heading = document.createElement("h2");
  heading.textContent = "Laboratoire d’audit — cinq organisations fictives";
  section.appendChild(heading);
  var note = document.createElement("p");
  note.className = "small";
  note.textContent =
    "30 000 opérations / 60 000 lignes de GL, cinq structures de Drive virtuel. Aucun dossier réel modifié. Chaque étape appelle réellement Enhanced Auditor et consomme le budget Shadow. Les corrections restent proposées à validation. Ce laboratoire ne réentraîne pas les poids du modèle.";
  section.appendChild(note);
  var controls = document.createElement("div");
  controls.className = "links";
  section.appendChild(controls);
  var seed = document.createElement("input");
  seed.type = "number";
  seed.min = "1";
  seed.max = "999999";
  seed.value = "1";
  seed.setAttribute("aria-label", "Graine de la campagne");
  controls.appendChild(seed);
  var status = document.createElement("p");
  status.setAttribute("role", "status");
  section.appendChild(status);
  var body = document.createElement("div");
  body.className = "stack";
  section.appendChild(body);
  var anchor = document.getElementById("audit-sandbox-host");
  if (!anchor) return;
  anchor.appendChild(section);
  var busy = false,
    running = false,
    latest = null,
    drafts = {};
  var errors = {
    NO_AI_PROVIDER_CONFIGURED:
      "Configurez un fournisseur IA dans les paramètres avant de lancer cet exercice.",
    SHADOW_DAILY_RUNS_REACHED:
      "Budget quotidien d’appels Shadow atteint. Reprenez demain ou adaptez le budget du laboratoire.",
    SHADOW_DAILY_COST_REACHED:
      "Budget quotidien Shadow atteint. La progression est conservée.",
    CAMPAIGN_ALREADY_RUNNING:
      "Une campagne est déjà en cours. Continuez ses cinq organisations.",
    SANDBOX_STEP_LIMIT:
      "Limite de cet essai atteinte. Enregistrez votre correction puis relancez avec de nouvelles données.",
    STEP_ALREADY_RUNNING:
      "Une étape est déjà en cours pour cette organisation.",
  };
  function api(action, data) {
    if (busy) {
      status.textContent = "Une étape est déjà en cours.";
      return Promise.resolve(null);
    }
    busy = true;
    status.textContent = "Exécution…";
    return OM.api("/api/app?route=shadow", {
      method: "POST",
      body: JSON.stringify(Object.assign({ action: action }, data || {})),
    })
      .then(function () {
        return load();
      })
      .catch(function (e) {
        status.textContent = errors[e.message] || e.message;
        return null;
      })
      .finally(function () {
        busy = false;
      });
  }
  function button(host, text, fn) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "btn ghost";
    b.textContent = text;
    b.onclick = fn;
    host.appendChild(b);
    return b;
  }
  button(controls, "Nouvelle campagne", function () {
    api("sandbox-create", { seed: Number(seed.value) });
  });
  var run = button(controls, "Continuer l’entraînement", async function () {
    if (running || busy) return;
    running = true;
    run.disabled = true;
    pause.hidden = false;
    try {
      var data = latest;
      if (!data || !data.campaign)
        data = await api("sandbox-create", { seed: Number(seed.value) });
      for (var i = 0; running && !section.closest("[hidden]") && data && i < 50; i++) {
        var next = data.campaign.organisations.find(function (o) {
          return o.status !== "completed" && o.steps < 10;
        });
        if (!next) break;
        data = await api("sandbox-step", { organisation: next.id });
        if (data && running)
          status.textContent =
            "Progression enregistrée · " +
            next.name +
            " · " +
            data.campaign.organisations.filter(function (o) {
              return o.status === "completed";
            }).length +
            " / 5 exercices terminés";
      }
    } finally {
      running = false;
      run.disabled = false;
      pause.hidden = true;
    }
  });
  var pause = button(controls, "Mettre en pause", function () {
    running = false;
    status.textContent = "Pause demandée. L’étape en cours sera enregistrée.";
  });
  pause.hidden = true;
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) running = false;
  });
  var help = document.createElement("p");
  help.className = "small";
  help.textContent =
    "Un clic pour enchaîner les exercices tant que cette page reste visible. Vous pouvez mettre en pause ; les validations de leçons restent humaines et les limites de budget restent appliquées.";
  section.insertBefore(help, status);
  var download = button(controls, "Télécharger les résultats", function () {});
  download.hidden = true;
  function load() {
    return OM.api("/api/app?route=shadow&sandbox=1").then(function (d) {
      latest = d;
      body.textContent = "";
      status.textContent = d.campaign
        ? d.campaign.organisations.filter(function (o) {
            return o.status === "completed";
          }).length + " / 5 exercices terminés · progression enregistrée"
        : "Prêt. Créez une campagne pour commencer.";
      download.hidden = !d.campaign;
      download.onclick = function () {
        var url = URL.createObjectURL(
          new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }),
        );
        var a = document.createElement("a");
        a.href = url;
        a.download = "audit-sandbox-results.json";
        a.click();
        setTimeout(function () {
          URL.revokeObjectURL(url);
        }, 1000);
      };
      (d.campaign ? d.campaign.organisations : d.organisations).forEach(
        function (o) {
          var card = document.createElement("article");
          card.className = "card";
          var title = document.createElement("h3");
          title.textContent = o.name + " — " + o.sector;
          card.appendChild(title);
          var p = document.createElement("p");
          p.textContent =
            (o.status || "Non démarré") + " · " + (o.steps || 0) + " étapes IA";
          card.appendChild(p);
          if (o.grade) {
            var result = document.createElement("p");
            result.textContent =
              "Score ciblé : " +
              o.grade.score +
              "/100 · " +
              o.grade.detected +
              "/" +
              o.grade.expected +
              " points trouvés · " +
              o.grade.false_alerts.length +
              " fausses alertes";
            card.appendChild(result);
          }
          if (o.attempts && o.attempts.length) {
            var history = document.createElement("p");
            history.textContent =
              "Essais précédents : " +
              o.attempts
                .map(function (a) {
                  return a.grade.score + "/100 (graine " + a.seed + ")";
                })
                .join(" → ");
            card.appendChild(history);
          }
          if (d.campaign) {
            button(card, "Exécuter l’étape suivante", function () {
              api("sandbox-step", { organisation: o.id });
            }).disabled = o.status === "completed";
            var correction = document.createElement("textarea");
            correction.value = drafts[o.id] || "";
            correction.addEventListener("input", function () {
              drafts[o.id] = correction.value;
            });
            correction.placeholder =
              "Correction humaine expliquée : constat, cause, bonne méthode…";
            correction.setAttribute("aria-label", "Correction pour " + o.name);
            card.appendChild(correction);
            button(card, "Enregistrer la correction", function () {
              api("sandbox-feedback", {
                organisation: o.id,
                note: correction.value,
              });
            });
            button(card, "Proposer une leçon à Shadow", function () {
              api("sandbox-lesson", { organisation: o.id });
            }).disabled = !o.grade || !o.feedback.length;
            button(card, "Retester avec de nouvelles données", function () {
              api("sandbox-retest", { organisation: o.id });
            }).disabled = o.status !== "completed" && o.steps < 10;
            var details = document.createElement("details");
            var summary = document.createElement("summary");
            summary.textContent =
              "Travaux, preuves, erreurs et résultats détaillés";
            details.appendChild(summary);
            var pre = document.createElement("pre");
            pre.style.cssText =
              "white-space:pre-wrap;max-height:500px;overflow:auto";
            pre.textContent = JSON.stringify(
              {
                working_file: o.wp,
                grade: o.grade,
                steps: o.log,
                feedback: o.feedback,
                error: o.last_error,
              },
              null,
              2,
            );
            details.appendChild(pre);
            card.appendChild(details);
          }
          body.appendChild(card);
        },
      );
      return d;
    });
  }
  load().catch(function (e) {
    status.textContent = errors[e.message] || e.message;
  });
})();
