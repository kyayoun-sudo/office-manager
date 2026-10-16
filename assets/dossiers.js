(function () {
  "use strict";
  var OM = window.OfficeManager,
    $ = function (id) {
      return document.getElementById(id);
    },
    active = "workflow",
    current = null,
    initialView = true,
    busy = false;
  var labels = {
    pending: "À compléter ou confirmer",
    recorded: "Information enregistrée",
    review: "À examiner",
  };
  var stages = {
    identified: "Identifié",
    contacted: "Contact déclaré",
    response: "Réponse reçue",
    meeting: "Réunion documentée",
    available: "Disponibilité confirmée",
    cv_received: "CV reçu",
    fees_received: "Honoraires reçus",
    opinion_received: "Avis reçu",
    selected: "Retenu par une personne",
    declined: "Non retenu",
  };
  function el(tag, text, cls) {
    var n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  }
  function append(parent, tag, text, cls) {
    var n = el(tag, text, cls);
    parent.appendChild(n);
    return n;
  }
  function keep(node) {
    if (node) node.setAttribute("data-keep", "");
    return node;
  }
  function link(parent, text, url, cls) {
    var u;
    try {
      u = new URL(url, location.origin);
    } catch (e) {
      return null;
    }
    if (!["http:", "https:"].includes(u.protocol)) return null;
    var n = append(parent, "a", text, cls);
    n.href = u.href;
    return n;
  }
  function card(parent, title, dark) {
    var c = append(
      parent,
      "section",
      null,
      "card" + (dark ? " dossier-work" : ""),
    );
    append(c, "h2", title);
    return c;
  }
  function empty(parent, text) {
    append(
      parent,
      "p",
      text || "Aucune information enregistrée.",
      "dossier-muted",
    );
  }
  function permission(key) {
    return (
      current.permissions[key] && current.permissions[key].level !== "none"
    );
  }
  function ctx(path) {
    var q = new URLSearchParams();
    if (current.mission_id) q.set("mission_id", current.mission_id);
    if (current.opportunity_id) q.set("opportunity_id", current.opportunity_id);
    return path + "?" + q;
  }
  function field(form, label, type) {
    var wrap = append(form, "label", label),
      i = append(wrap, type === "textarea" ? "textarea" : "input");
    if (type !== "textarea") i.type = type || "text";
    i.required = true;
    return i;
  }
  function saveForm(form, body) {
    var status = append(form, "p", "", "status");
    status.setAttribute("role", "status");
    var b = append(form, "button", "Enregistrer", "btn");
    b.type = "submit";
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!form.reportValidity()) return;
      b.disabled = true;
      status.textContent = "Enregistrement…";
      OM.api("/api/app?route=dossier-followup", {
        method: "POST",
        body: JSON.stringify(body()),
      })
        .then(function (r) {
          status.textContent =
            r.notification && r.notification.error
              ? "Enregistré ; transmission à l’agent en attente."
              : "Enregistré.";
          load();
        })
        .catch(function (e) {
          status.textContent = e.message;
          b.disabled = false;
        });
    });
  }
  function workflow(host) {
    var c = card(host, "Le parcours et les relais");
    if (!current.steps.length)
      empty(c, "Aucune étape disponible avec vos droits actuels.");
    current.steps.forEach(function (s) {
      var row = append(c, "article", null, "dossier-step"),
        head = append(row, "div");
      append(head, "h3", s.label);
      append(head, "span", labels[s.state], "tag");
      var info = append(row, "div");
      append(info, "p", s.person + " → " + agentName(s.agent));
      append(info, "p", s.action);
      append(info, "p", "Résultat attendu : " + s.result, "dossier-muted");
      append(
        info,
        "p",
        "Puis : " + s.next_person + " → " + agentName(s.next_agent),
        "dossier-handoff",
      );
      link(info, "Ouvrir cette étape →", s.href);
    });
  }
  function agentName(key) {
    var a = current.agents.find(function (x) {
      return x.key === key;
    });
    return a
      ? a.name
      : {
          auto: "Firm Manager",
          "mission-controller": "Mission Controller",
          "enhanced-auditor": "Enhanced Auditor",
          orpailleur: "Orpailleur",
          sika: "SIKA",
          shadow: "Shadow",
        }[key] || key;
  }
  function overview(host) {
    var c = card(host, "Prochaines échéances");
    (current.deadlines || []).forEach(function (d) {
      keep(append(c, "p", d.what + " · " + d.due));
    });
    if (!current.deadlines.length) empty(c, "Aucune échéance renseignée.");
    c = card(host, "Points ouverts");
    current.blockers.forEach(function (x) {
      keep(append(c, "p", x));
    });
    if (!current.blockers.length)
      empty(
        c,
        "Aucun blocage remonté par cette vue. Consultez les validations et le programme pour les contrôles de passage.",
      );
    c = card(host, "Les agents de mon dossier");
    current.agents.forEach(function (a) {
      var row = append(c, "div", null, "item");
      keep(append(row, "strong", a.name));
      append(row, "span", a.job, "meta");
      if (a.key === "shadow") link(row, "Entraînement", "/entrainement.html");
      else
        link(
          row,
          "Consulter",
          ctx("/assistant.html") + "&agent=" + encodeURIComponent(a.key),
        );
    });
    if (current.opportunity_id && current.mission_id)
      link(
        c,
        "Retrouver le dossier commercial",
        "/opportunites.html?id=" + encodeURIComponent(current.opportunity_id),
      );
  }
  function work(host) {
    var c = card(host, "Cycles, procédures et revue", true);
    append(
      c,
      "p",
      "Les signatures affichées sont celles enregistrées. Ouvrez la revue pour contrôler la version actuelle du fichier.",
      "dossier-muted",
    );
    if (current.programme)
      append(
        c,
        "p",
        "Programme v" +
          current.programme.version +
          " · " +
          current.programme.status,
        "meta",
      );
    if (!current.cycles || !current.cycles.length)
      empty(
        c,
        "Aucun cycle accessible. Préparez ou validez le programme de travail.",
      );
    (current.cycles || []).forEach(function (cycle) {
      var box = append(c, "section");
      keep(append(box, "h3", (cycle.code || "") + " · " + (cycle.title || "")));
      if (cycle.file) {
        var u =
          cycle.file.url ||
          (cycle.file.file_id
            ? "https://drive.google.com/file/d/" +
              encodeURIComponent(cycle.file.file_id) +
              "/view"
            : null);
        if (u) link(box, "Ouvrir le vrai working file", u);
      }
      cycle.procedures.forEach(function (p) {
        var row = append(box, "div", null, "item");
        var info = append(row, "div", null, "t");
        keep(append(info, "strong", p.code + " · " + p.title));
        keep(
          append(
            info,
            "span",
            "Préparateur : " + (p.preparer || "À affecter"),
            "meta",
          ),
        );
        var stats = append(info, "div", null, "dossier-stat");
        append(
          stats,
          "span",
          p.tested + "/" + p.sample + " éléments documentés",
        );
        append(stats, "span", p.exceptions + " exception(s)");
        append(stats, "span", p.open_points + " point(s) ouverts");
        append(stats, "span", p.signatures + " signature(s) enregistrée(s)");
        link(row, "Travailler / revoir", p.href, "btn ghost");
      });
    });
    if (current.mission_id)
      link(
        c,
        "Ouvrir le programme",
        "/programme.html?mission_id=" + encodeURIComponent(current.mission_id),
        "btn ghost",
      );
    var risks = card(host, "Risques et couverture", true);
    (current.risks || []).forEach(function (r) {
      var row = append(risks, "div", null, "item");
      keep(append(row, "strong", r.risk));
      keep(
        append(
          row,
          "span",
          [r.source, r.level, r.verdict].filter(Boolean).join(" · "),
          "meta",
        ),
      );
    });
    if (!current.risks || !current.risks.length)
      empty(risks, "Aucun risque remonté. Cela ne vaut pas absence de risque.");
  }
  function documents(host) {
    var c = card(host, "Documents du même dossier", true);
    (current.documents || []).forEach(function (d) {
      var row = append(c, "div", null, "item");
      keep(append(row, "strong", d.name || d.id));
      if (d.type) keep(append(row, "span", d.type, "meta"));
      var u =
        d.url ||
        (d.id
          ? "https://drive.google.com/file/d/" +
            encodeURIComponent(d.id) +
            "/view"
          : null);
      if (u) keep(link(row, "Ouvrir", u));
    });
    if (!current.documents || !current.documents.length)
      empty(c, "Aucun document rattaché visible.");
    if (current.mission_id)
      link(
        c,
        "Retrouver les pièces et PBC",
        "/mission.html?id=" +
          encodeURIComponent(current.mission_id) +
          "#h-docs",
        "btn ghost",
      );
  }
  function team(host) {
    var c = card(host, "Personnes et responsabilités");
    (current.team || []).forEach(function (p) {
      var row = append(c, "div", null, "item");
      keep(append(row, "strong", p.name || "Personne à renseigner"));
      keep(append(row, "span", p.role || "Rôle à préciser", "meta"));
    });
    if (!current.team || !current.team.length)
      empty(c, "Aucune équipe visible.");
    c = card(host, "Suivi des spécialistes");
    if (!current.specialists || !current.specialists.length)
      empty(
        c,
        "Aucun résultat de recherche enregistré. La recherche existante reste disponible dans le dossier commercial.",
      );
    (current.specialists || []).forEach(function (s) {
      var row = append(c, "article", null, "item");
      var info = append(row, "div", null, "t");
      keep(append(info, "strong", s.name));
      keep(append(info, "span", s.gap, "meta"));
      append(info, "span", stages[s.status] || s.status, "tag");
      if (s.source) link(info, "Source de la recherche", s.source);
      if (s.followup && s.followup.note)
        keep(append(info, "p", s.followup.note));
      if (current.may_manage) {
        var form = append(info, "form", null, "dossier-form"),
          wrap = append(form, "label", "Étape déclarée"),
          select = append(wrap, "select");
        Object.keys(stages).forEach(function (k) {
          var op = append(select, "option", stages[k]);
          op.value = k;
        });
        select.value = s.status;
        var note = field(
          form,
          "Résultat, interlocuteur et référence de la preuve",
          "textarea",
        );
        note.maxLength = 1000;
        append(
          form,
          "p",
          "Cette saisie ne contacte personne et ne crée pas de rendez-vous.",
          "meta",
        );
        saveForm(form, function () {
          return {
            action: "specialist",
            opportunity_id: current.opportunity_id,
            gap: s.gap,
            specialist_id: s.id,
            stage: select.value,
            note: note.value,
            expected_version: s.followup ? s.followup.version : 0,
          };
        });
      }
    });
    if (current.opportunity_id)
      link(
        c,
        "Rechercher ou modifier l’équipe",
        "/opportunites.html?id=" +
          encodeURIComponent(current.opportunity_id) +
          "#team-card",
        "btn ghost",
      );
  }
  function finance(host) {
    var c = card(host, "Cotation et relais à SIKA", true),
      quote = current.quotation;
    if (!quote) {
      empty(
        c,
        "Ouvrez le dossier commercial pour consulter la cotation autorisée.",
      );
      return;
    }
    if (quote.file) {
      var u =
        quote.file.url ||
        "https://drive.google.com/file/d/" +
          encodeURIComponent(quote.file.id) +
          "/view";
      link(c, "Ouvrir le classeur de cotation", u, "btn ghost");
    } else empty(c, "Aucun classeur de cotation enregistré.");
    (quote.changes || [])
      .slice()
      .reverse()
      .forEach(function (x) {
        var row = append(c, "article", null, "item");
        keep(append(row, "strong", x.at + " · " + x.by));
        keep(append(row, "p", x.reason));
        keep(
          append(
            row,
            "span",
            "Version Drive : " + (x.drive_version || x.modified_time),
            "meta",
          ),
        );
      });
    if (quote.notification)
      append(
        c,
        "p",
        quote.notification.error
          ? "Transmission SIKA en attente : " + quote.notification.error
          : "Événement disponible pour SIKA. La prise en compte et la validation financière sont distinctes.",
        "dossier-muted",
      );
    if (current.may_manage && quote.file) {
      var f = append(c, "form", null, "dossier-form"),
        reason = field(
          f,
          "Ce qui a changé dans le classeur et pourquoi",
          "textarea",
        );
      reason.maxLength = 1000;
      append(
        f,
        "p",
        "Enregistrez d’abord vos modifications dans le vrai classeur. Le serveur vérifie sa version ; aucun montant n’est recalculé ici.",
        "meta",
      );
      saveForm(f, function () {
        return {
          action: "quotation",
          opportunity_id: current.opportunity_id,
          reason: reason.value,
        };
      });
    }
  }
  function timeline(host) {
    var c = card(host, "Relais enregistrés");
    if (!current.timeline.length)
      empty(c, "Aucun événement visible avec vos droits actuels.");
    current.timeline.forEach(function (e) {
      var row = append(c, "div", null, "item");
      keep(append(row, "strong", e.type));
      keep(
        append(
          row,
          "span",
          [e.agent, e.consumer, e.at, e.status].filter(Boolean).join(" → "),
          "meta",
        ),
      );
    });
  }
  function render() {
    var tabs = $("dossier-tabs");
    tabs.textContent = "";
    tabs.hidden = false;
    var views = [
      ["overview", "Synthèse", overview],
      ["workflow", "Parcours et relais", workflow],
    ];
    if (permission("workpapers") && current.mission_id)
      views.push(["work", "Travaux et revue", work]);
    if (current.documents !== null)
      views.push(["documents", "Documents", documents]);
    if (current.team !== null)
      views.push(["team", "Équipe et spécialistes", team]);
    if (permission("billing")) views.push(["finance", "Cotation", finance]);
    if (permission("audit_log"))
      views.push(["timeline", "Historique", timeline]);
    var missionRole = current.presentation && current.presentation.role;
    var priorities = {
      auditor: ["work", "documents", "workflow"],
      senior: ["work", "overview", "workflow"],
      manager: ["overview", "work", "team"],
      partner: ["overview", "workflow", "work"],
      secretary: ["documents", "workflow", "team"],
      finance: ["finance", "overview"],
      specialist: ["work", "documents"],
    };
    var order = priorities[missionRole] || [];
    views.sort(function (a, b) {
      var ai = order.indexOf(a[0]),
        bi = order.indexOf(b[0]);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
    if (
      initialView &&
      current.presentation &&
      current.presentation.source === "mission"
    ) {
      active = views[0][0];
      initialView = false;
    }
    if (
      !views.some(function (v) {
        return v[0] === active;
      })
    )
      active = "overview";
    views.forEach(function (v) {
      var b = append(tabs, "button", v[1], "chip");
      b.type = "button";
      b.setAttribute("aria-pressed", String(active === v[0]));
      b.addEventListener("click", function () {
        active = v[0];
        render();
      });
    });
    var host = $("dossier-body");
    host.textContent = "";
    views.find(function (v) {
      return v[0] === active;
    })[2](host);
  }
  function load() {
    if (busy) return;
    busy = true;
    var params = new URLSearchParams(location.search),
      id = params.get("mission_id"),
      oid = params.get("opportunity_id");
    $("dossier-status").textContent = "Chargement…";
    var query = new URLSearchParams({ route: "dossier" });
    if (id) query.set("mission_id", id);
    if (oid) query.set("opportunity_id", oid);
    OM.api("/api/app?" + query)
      .then(function (d) {
        if (!id && !oid) {
          renderIndex(d);
          return;
        }
        current = d;
        $("all-dossiers").hidden = false;
        $("dossier-title").textContent = d.title;
        keep($("dossier-title"));
        $("dossier-lead").textContent =
          (d.presentation && d.presentation.label
            ? "Votre fonction sur cette mission : " +
              d.presentation.label +
              ". "
            : "") + d.notice;
        $("dossier-status").textContent = d.source_status.length
          ? "Certaines rubriques sont indisponibles. Les autres restent consultables."
          : "";
        var next = $("dossier-next");
        next.textContent = "";
        next.hidden = !d.next;
        if (d.next) {
          append(next, "h2", "Prochaine action à examiner");
          append(next, "strong", d.next.label);
          append(next, "p", d.next.person + " · " + agentName(d.next.agent));
          link(next, d.next.action + " →", d.next.href, "btn");
        }
        render();
      })
      .catch(function (e) {
        if ([401, 403, 404].indexOf(e.status) >= 0) {
          current = null;
          $("dossier-body").textContent = "";
          $("dossier-index").textContent = "";
          $("dossier-tabs").hidden = true;
          $("dossier-next").hidden = true;
        }
        $("dossier-status").textContent = "Dossier indisponible : " + e.message;
      })
      .finally(function () {
        busy = false;
      });
  }
  function renderIndex(d) {
    $("dossier-status").textContent = d.truncated
      ? "Les 100 dossiers les plus récents sont affichés. Utilisez les écrans Missions ou Opportunités pour retrouver les autres."
      : "";
    var host = $("dossier-index");
    host.textContent = "";
    var grid = append(host, "div", null, "dossier-index-grid");
    [
      ["Mes opportunités", d.opportunities, "opportunity_id"],
      ["Mes missions", d.missions, "mission_id"],
    ].forEach(function (g) {
      var c = card(grid, g[0]);
      if (!g[1].length) empty(c, "Aucun dossier accessible.");
      g[1].forEach(function (x) {
        var a = link(
          c,
          x.title || x.name,
          "/dossiers.html?" +
            g[2] +
            "=" +
            encodeURIComponent(x.id) +
            (g[2] === "opportunity_id" &&
            x.mission_id &&
            d.missions.some(function (m) {
              return m.id === x.mission_id;
            })
              ? "&mission_id=" + encodeURIComponent(x.mission_id)
              : ""),
          "item link-item",
        );
        keep(a);
      });
    });
  }
  function organisation() {
    var c = $("organisation-content");
    c.textContent = "";
    [
      ["Associé / Owner", "Décisions et arbitrages ; accès au détail autorisé"],
      ["Manager", "Supervision des missions, pièces manquantes et validations"],
      [
        "Senior / Auditeur",
        "Cycles, tests, preuves, exceptions et retours de revue",
      ],
      [
        "Quality Controller",
        "Couverture, méthodologie et sign-offs selon les accès",
      ],
      [
        "Finance / Secrétariat",
        "Cotation, modèles, justificatifs et envois autorisés",
      ],
      [
        "Spécialiste",
        "Contribution limitée au périmètre autorisé de la mission",
      ],
    ].forEach(function (r) {
      var row = append(c, "div", null, "item");
      append(row, "strong", r[0]);
      append(row, "span", r[1], "meta");
    });
    append(c, "h3", "Les questions de configuration du cabinet");
    append(
      c,
      "p",
      "Confirmez les références dans le registre partagé existant. Les agents les réutilisent ; une version changée demande une nouvelle confirmation. Les responsabilités et suppléants se règlent dans Paramètres.",
      "dossier-muted",
    );
    [
      ["quotation_workbook", "Où est le vrai classeur de cotation ?"],
      ["Modèle Manifestation d’intérêt", "Où est le modèle AMI ?"],
      ["Modèle Proposition technique", "Où est le modèle d’offre technique ?"],
      [
        "mission_structure",
        "Où est la structure modèle des dossiers de mission ?",
      ],
    ].forEach(function (ref) {
      link(
        c,
        ref[1],
        "/secretariat.html?" +
          new URLSearchParams({
            document_type: ref[0],
            document_role: "template",
          }) +
          "#ref-card",
      );
    });
    link(
      c,
      "Où sont les modèles KYC et d’indépendance du classeur d’acceptation ?",
      "/opportunites.html",
    );
    append(
      c,
      "p",
      "À confirmer également avec les responsables : dossiers clients, working files, programmes, comptabilité, CV et RH ; responsable, second, validateur, expéditeur et signataire. Aucun lien ne donne un droit supplémentaire.",
      "dossier-muted",
    );
  }
  function ready() {
    organisation();
    $("organisation-toggle").addEventListener("click", function () {
      var open = $("organisation").hidden;
      $("organisation").hidden = !open;
      this.setAttribute("aria-expanded", String(open));
    });
    $("dossier-reload").addEventListener("click", load);
    load();
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", ready);
  else ready();
})();
