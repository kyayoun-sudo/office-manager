(function () {
  "use strict";
  var OM = window.OfficeManager;
  if (!OM || !OM.hasPersonalSession()) return;
  var main = document.querySelector(".main");
  if (!main) return;
  var user = (OM.getSession() || {}).user || {};
  var identity = [
    user.org_id || "",
    user.auth_user_id || user.id || user.email || "",
    OM.getRole(),
  ].join(":");
  function node(tag, text, cls) {
    var n = document.createElement(tag);
    if (text) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  }
  function stored(key) {
    try {
      return sessionStorage.getItem("om-work:" + identity + ":" + key);
    } catch (_) {
      return null;
    }
  }
  function store(key, value) {
    try {
      sessionStorage.setItem("om-work:" + identity + ":" + key, value);
    } catch (_) {}
  }
  function visible(n) {
    return n && !n.closest("[hidden]");
  }
  function link(parent, label, path, primary) {
    var a = node("a", label, "btn" + (primary ? "" : " ghost"));
    a.href = path;
    parent.appendChild(a);
    return a;
  }
  var pages = [
    "/dossiers.html",
    "/procedure.html",
    "/programme.html",
    "/mission.html",
    "/opportunites.html",
    "/secretariat.html",
  ];
  var query = new URLSearchParams(location.search);
  var mission =
    query.get("mission_id") ||
    (location.pathname === "/mission.html" ? query.get("id") : null);
  var opportunity =
    query.get("opportunity_id") ||
    (location.pathname === "/opportunites.html" ? query.get("id") : null);
  var context = new URLSearchParams();
  if (mission) context.set("mission_id", mission);
  if (opportunity) context.set("opportunity_id", opportunity);
  if (pages.indexOf(location.pathname) >= 0 && (mission || opportunity)) {
    var clean = new URLSearchParams();
    ["mission_id", "opportunity_id", "id", "code"].forEach(function (k) {
      if (query.has(k)) clean.set(k, query.get(k));
    });
    store("resume", location.pathname + "?" + clean);
    if (location.pathname !== "/dossiers.html") {
      var rail = node("nav", null, "work-context");
      rail.setAttribute("aria-label", "Votre dossier en cours");
      link(rail, "← Mon dossier", "/dossiers.html?" + context, false);
      var text = node(
        "span",
        "Votre travail reste rattaché au même dossier.",
        "meta",
      );
      rail.appendChild(text);
      var h = main.querySelector(".page-head");
      main.insertBefore(rail, h || main.firstChild);
      // Replace the older generic banner with the contextual return, keeping its destination.
      main
        .querySelectorAll(':scope > a[href^="/dossiers.html?"]')
        .forEach(function (a) {
          a.hidden = true;
        });
    }
  }
  if (location.pathname !== "/accueil.html" && location.pathname !== "/accueil")
    return;
  var role = OM.getRole();
  var routes =
    role === "it_admin"
      ? [
          ["Comptes et droits", "/parametres.html"],
          ["Vérifier les connexions", "/mise-en-service.html"],
        ]
      : role === "secretary"
        ? [
            ["Préparer mes documents", "/secretariat.html"],
            ["Ouvrir un dossier", "/dossiers.html"],
            ["Messages", "/messagerie.html"],
          ]
        : [
            ["Ouvrir un dossier", "/dossiers.html"],
            [
              OM.isManager() ? "Mes validations" : "Mes missions",
              OM.isManager() ? "/validations.html" : "/mission.html",
            ],
            ["Messages", "/messagerie.html"],
          ];
  var welcome = node("section", null, "card work-welcome");
  welcome.setAttribute("aria-labelledby", "work-welcome-title");
  var top = node("div", null, "work-welcome-head");
  top.appendChild(node("p", "MON ESPACE DE TRAVAIL", "work-eyebrow"));
  var title = node(
    "h2",
    role === "it_admin" ? "Un cabinet prêt à travailler" : "À faire maintenant",
  );
  title.id = "work-welcome-title";
  top.appendChild(title);
  welcome.appendChild(top);
  welcome.appendChild(
    node(
      "p",
      role === "it_admin"
        ? "Retrouvez les comptes, les accès et les connexions du cabinet."
        : "Retrouvez les travaux et décisions remontés dans votre espace, puis continuez dans le dossier concerné.",
      "meta",
    ),
  );
  var actions = node("div", null, "work-quick-actions");
  welcome.appendChild(actions);
  routes.forEach(function (r, i) {
    link(actions, r[0], r[1], i === 0);
  });
  var resume = stored("resume");
  if (
    resume &&
    pages.some(function (p) {
      return resume.indexOf(p + "?") === 0;
    }) &&
    role !== "it_admin"
  )
    link(actions, "Reprendre mon dernier travail →", resume, false);
  var priorities = node("div", null, "work-priorities");
  priorities.setAttribute("aria-live", "polite");
  welcome.appendChild(priorities);
  var header = main.querySelector(".page-head");
  if (header) header.insertAdjacentElement("afterend", welcome);
  else main.prepend(welcome);
  if (OM.myRights)
    OM.myRights()
      .then(function (rights) {
        var hidden = (rights && rights.hidden_pages) || [];
        actions.querySelectorAll("a").forEach(function (a) {
          if (hidden.indexOf(new URL(a.href).pathname) >= 0) a.hidden = true;
        });
      })
      .catch(function () {});
  var lead = document.getElementById("page-lead");
  if (lead)
    lead.textContent =
      "Vos priorités, vos dossiers et votre équipe, au même endroit.";
  var sources = [
    ["myreviews-list", "Revue attendue"],
    ["myspace-items", "Décision ou suivi"],
    ["myprocs-list", "Travail à continuer"],
    ["mywork-actions", "Tâche ouverte"],
  ];
  var signature = "";
  function refresh() {
    var selected = [],
      seen = new Set();
    sources.forEach(function (s) {
      var source = document.getElementById(s[0]);
      if (!visible(source)) return;
      source.querySelectorAll("a[href]").forEach(function (a) {
        var url = new URL(a.href, location.origin);
        if (!visible(a) || url.origin !== location.origin || seen.has(url.href))
          return;
        seen.add(url.href);
        selected.push({
          href: url.pathname + url.search + url.hash,
          text: a.textContent.trim(),
          kind: s[1],
        });
      });
    });
    var next = JSON.stringify(selected);
    if (signature === next) return;
    signature = next;
    priorities.textContent = "";
    if (!selected.length) {
      priorities.appendChild(
        node(
          "p",
          "Les priorités disponibles apparaîtront ici au chargement de votre espace. Vous pouvez déjà ouvrir un dossier.",
          "meta",
        ),
      );
      return;
    }
    selected.slice(0, 4).forEach(function (x) {
      var a = node("a", null, "work-priority");
      a.href = x.href;
      a.appendChild(node("span", x.kind, "work-eyebrow"));
      a.appendChild(node("strong", x.text));
      a.appendChild(node("span", "Continuer →", "work-continue"));
      priorities.appendChild(a);
    });
    if (selected.length > 4)
      priorities.appendChild(
        node(
          "p",
          "Les autres travaux restent disponibles dans les rubriques ci-dessous.",
          "meta",
        ),
      );
  }
  var queued = false;
  var observer = new MutationObserver(function () {
    if (queued) return;
    queued = true;
    setTimeout(function () {
      queued = false;
      refresh();
    }, 100);
  });
  sources.forEach(function (s) {
    var source = document.getElementById(s[0]);
    if (source) {
      observer.observe(source, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      var section = source.closest("section");
      if (section)
        observer.observe(section, {
          attributes: true,
          attributeFilter: ["hidden"],
        });
    }
  });
  refresh();
  // Keep secondary views available, while opening on actual work rather than technical metrics.
  [
    ["cockpit-section", "Indicateurs du cabinet"],
    ["runs-card", "Activité des agents"],
    ["passes-card", "Passages et fonctionnement des agents"],
  ].forEach(function (entry) {
    var section = document.getElementById(entry[0]);
    if (!section) return;
    var details = node("details", null, "work-secondary");
    details.appendChild(node("summary", entry[1]));
    section.before(details);
    details.appendChild(section);
    details.hidden = section.hidden;
    details.open = stored(entry[0]) === "open";
    details.addEventListener("toggle", function () {
      store(entry[0], details.open ? "open" : "closed");
    });
    new MutationObserver(function () {
      details.hidden = section.hidden;
    }).observe(section, { attributes: true, attributeFilter: ["hidden"] });
  });
})();
