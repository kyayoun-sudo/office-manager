(function () {
  "use strict";
  var OM = window.OfficeManager;
  if (!OM) return;
  function el(tag, text) {
    var n = document.createElement(tag);
    if (text) n.textContent = text;
    return n;
  }
  var labels = {
    pending: "Décision attendue",
    measures_pending: "Mesures décidées — application à confirmer",
    override_open: "Override enregistré — menace non résolue",
    resolved: "Application confirmée",
    prohibited: "Participation interdite",
  };
  function field(parent, label, area) {
    var l = el("label", label),
      n = el(area ? "textarea" : "input");
    n.className = "om-ask-note";
    n.setAttribute("aria-label", label);
    l.appendChild(n);
    parent.appendChild(l);
    return n;
  }
  function form(host, c, oid, done) {
    host.appendChild(el("h3", c.name + " — " + c.ref));
    host.appendChild(el("p", c.question));
    host.appendChild(
      el(
        "p",
        "Explication : " +
          (c.explanation || "Explication à compléter par le déclarant."),
      ),
    );
    host.appendChild(el("strong", labels[c.status] || c.status));
    if (c.prior_decision_stale || c.source_changed)
      host.appendChild(
        el(
          "p",
          "Déclaration modifiée : la décision précédente ne vaut pas validation de la nouvelle situation. Vérifiez également la fiche. Une interdiction confirmée reste applicable.",
        ),
      );
    var prior = el("p");
    prior.textContent = c.note || "";
    host.appendChild(prior);
    if (c.business_reason)
      host.appendChild(el("p", "Business reason : " + c.business_reason));
    if (c.workbook_sync)
      host.appendChild(
        el(
          "p",
          "Fiche : " +
            ({
              verified: "écriture vérifiée",
              mapping_required: "cellules du modèle à identifier",
              conflict: "conflit avec une saisie existante",
              pending: "synchronisation en attente",
              workbook_missing: "classeur indisponible",
              unverified: "écriture non vérifiée",
            }[c.workbook_sync.status] || c.workbook_sync.status),
        ),
      );
    if (c.by)
      host.appendChild(
        el(
          "p",
          "Responsable : " +
            c.responsible +
            " · décision par " +
            c.by +
            " · " +
            c.at,
        ),
      );
    if (c.selected?.length)
      host.appendChild(
        el(
          "p",
          "Mesures retenues : " +
            c.selected
              .map(function (k) {
                return (
                  c.suggestions.find(function (s) {
                    return s.id === k;
                  })?.label || k
                );
              })
              .join(" ; "),
        ),
      );
    if (c.custom)
      host.appendChild(el("p", "Mesures complémentaires : " + c.custom));
    if (c.application)
      host.appendChild(
        el(
          "p",
          "Application confirmée par " +
            c.application.by +
            " · " +
            c.application.at +
            " · Référence : " +
            c.application.evidence,
        ),
      );
    if (c.status === "prohibited" || c.status === "resolved") return;
    var boxes = [];
    host.appendChild(
      el(
        "p",
        "Propositions structurées du Firm Manager, à apprécier selon vos règles applicables :",
      ),
    );
    (c.suggestions || []).forEach(function (s) {
      var label = el("label"),
        input = el("input");
      input.type = "checkbox";
      input.value = s.id;
      input.checked = (c.selected || []).includes(s.id);
      label.appendChild(input);
      label.appendChild(document.createTextNode(" " + s.label));
      label.style.display = "block";
      host.appendChild(label);
      var why = el("p", s.why);
      why.className = "meta";
      host.appendChild(why);
      boxes.push(input);
    });
    var custom = field(host, "Autres garde-fous à retenir", true);
    custom.value = c.custom || "";
    var note = field(host, "Motif de votre décision / conditions", true);
    note.value = c.note || "";
    var status = el("p");
    status.setAttribute("role", "status");
    host.appendChild(status);
    var controls = el("div");
    controls.className = "btn-row";
    host.appendChild(controls);
    var messages = {
      BUSINESS_REASON_REQUIRED: "La business reason est obligatoire.",
      DECISION_REASON_REQUIRED: "Expliquez votre décision.",
      SAFEGUARD_REQUIRED: "Sélectionnez une mesure ou rédigez vos garde-fous.",
      APPLICATION_EVIDENCE_REQUIRED:
        "Indiquez les références prouvant l’application.",
      APPLICABLE_RULE_REVIEW_REQUIRED:
        "Documentez la règle applicable et confirmez l’absence d’interdiction.",
      DECLARATION_CHANGED_REVIEW_AGAIN:
        "La déclaration a changé. Rechargez et réexaminez la nouvelle version.",
      INDEPENDENCE_EXPLANATION_REQUIRED:
        "Le déclarant doit compléter son explication avant cette décision.",
      INDEPENDENCE_PROHIBITION_NO_OVERRIDE:
        "Une interdiction confirmée ne peut pas être contournée par un override.",
      REMOVE_MEMBER_FROM_TEAM_FIRST:
        "Retirez d’abord la personne de l’équipe pour confirmer son remplacement.",
    };
    function send(action, extra) {
      var buttons = host.querySelectorAll("button");
      buttons.forEach(function (b) {
        b.disabled = true;
      });
      status.textContent = "Enregistrement de votre décision…";
      OM.api("/api/app?route=opportunities", {
        method: "POST",
        body: JSON.stringify(
          Object.assign(
            {
              action: action,
              opportunity_id: oid,
              case_id: c.id,
              version: c.version,
              note: note.value,
            },
            extra || {},
          ),
        ),
      })
        .then(function (r) {
          status.textContent =
            r.workbook_sync.status === "verified"
              ? "Décision enregistrée et fiche mise à jour."
              : "Décision enregistrée ; fiche à vérifier : " +
                r.workbook_sync.status;
          if (done) done();
        })
        .catch(function (e) {
          status.textContent = messages[e.code || e.message] || e.message;
          buttons.forEach(function (b) {
            b.disabled = false;
          });
        });
    }
    function button(parent, label, fn) {
      var b = el("button", label);
      b.type = "button";
      b.className = "btn ghost";
      b.onclick = fn;
      parent.appendChild(b);
      return b;
    }
    button(controls, "Retenir ces garde-fous", function () {
      send("independence-decide", {
        selected: boxes
          .filter(function (b) {
            return b.checked;
          })
          .map(function (b) {
            return b.value;
          }),
        custom: custom.value,
      });
    });
    if (c.status === "measures_pending") {
      var evidence = field(
        host,
        "Preuve / référence de l’application effective",
        true,
      );
      button(controls, "Confirmer l’application des mesures", function () {
        send("independence-applied", { evidence: evidence.value });
      });
    }
    var advanced = el("details");
    advanced.appendChild(
      el("summary", "Management override — Partner / Owner"),
    );
    advanced.appendChild(
      el(
        "p",
        "Permet une dérogation opérationnelle motivée. La menace reste ouverte ; aucune diligence n’est marquée réalisée. Une interdiction applicable ne peut pas être levée ici.",
      ),
    );
    var business = field(advanced, "Business reason (obligatoire)", true),
      basis = field(
        advanced,
        "Référentiel applicable et analyse de l’absence d’interdiction",
        true,
      ),
      label = el("label"),
      confirm = el("input");
    confirm.type = "checkbox";
    label.appendChild(confirm);
    label.appendChild(
      document.createTextNode(
        " J’ai vérifié qu’aucune règle applicable n’interdit cette participation.",
      ),
    );
    advanced.appendChild(label);
    button(advanced, "Enregistrer la dérogation", function () {
      send("independence-override", {
        business_reason: business.value,
        regulatory_basis: basis.value,
        confirm_no_prohibition: confirm.checked,
      });
    });
    host.appendChild(advanced);
    button(
      controls,
      "Constater une interdiction de participation",
      function () {
        send("independence-prohibit");
      },
    );
  }
  window.OMIndependence = {
    form: form,
    render: function (o) {
      var anchor =
        document.getElementById("indep-card") ||
        document.getElementById("team-card");
      if (!anchor) return;
      var card = document.getElementById("independence-review");
      if (!card) {
        card = el("section");
        card.id = "independence-review";
        card.className = "card";
        anchor.insertAdjacentElement("afterend", card);
      }
      if (card.contains(document.activeElement)) return;
      card.textContent = "";
      card.hidden = !(o.independence_cases || []).length && !o.my_declaration;
      card.appendChild(el("h2", "Indépendance — décisions et garde-fous"));
      if (o.my_declaration) {
        var edit = el("button", "Corriger ma déclaration");
        edit.type = "button";
        edit.className = "btn ghost";
        edit.onclick = function () {
          window.dispatchEvent(new Event("om-edit-independence"));
        };
        card.appendChild(edit);
      }
      (o.independence_cases || []).forEach(function (c) {
        var detail = el("details");
        detail.open = location.hash === "#independence-review";
        detail.appendChild(el("summary", c.name + " — " + labels[c.status]));
        form(detail, c, o.id, function () {
          if (window.reloadOpportunity) window.reloadOpportunity();
        });
        card.appendChild(detail);
      });
    },
  };
  window.dispatchEvent(new Event("om-independence-ready"));
})();
