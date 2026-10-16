(function () {
  "use strict";
  var OM = window.OfficeManager;
  if (!OM || !OM.hasPersonalSession()) return;
  var path = location.pathname,
    query = new URLSearchParams(location.search);
  var missionId =
    query.get("mission_id") ||
    (path === "/mission.html" ? query.get("id") : "");
  if (
    [
      "/mission.html",
      "/accueil.html",
      "/secretariat.html",
      "/parametres.html",
    ].indexOf(path) < 0
  )
    return;
  if (path === "/mission.html" && !missionId) return;
  var main = document.querySelector(".main"),
    host = document.getElementById("sika-expenses");
  if (!main) return;
  var state,
    selected = missionId || "",
    requestId = crypto.randomUUID();
  function node(tag, text, cls) {
    var n = document.createElement(tag);
    if (text) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  }
  function button(label, fn) {
    var b = node("button", label, "btn ghost");
    b.type = "button";
    b.onclick = fn;
    return b;
  }
  var fieldSerial = 0;
  function field(form, name, label, type, required, value) {
    var wrap = node("div", "", "field"),
      id = "sika-" + name + "-" + ++fieldSerial;
    var l = node("label", label);
    l.htmlFor = id;
    var input = node(type === "textarea" ? "textarea" : "input");
    input.name = name;
    input.id = id;
    if (type !== "textarea") input.type = type || "text";
    input.required = !!required;
    if (value != null) input.value = value;
    wrap.append(l, input);
    form.append(wrap);
    return input;
  }
  function select(form, name, label, choices) {
    var wrap = node("div", "", "field"),
      l = node("label", label),
      s = node("select");
    s.name = name;
    s.id = "sika-" + name + "-" + ++fieldSerial;
    l.htmlFor = s.id;
    choices.forEach(function (x) {
      var o = node("option", x[1]);
      o.value = x[0];
      s.append(o);
    });
    wrap.append(l, s);
    form.append(wrap);
    return s;
  }
  var errors = {
    SIKA_LOCK_UNAVAILABLE:
      "Le verrou de sauvegarde est indisponible. Vérifiez l’installation de db/inspection-reader-leases.sql ; aucune dépense n’a été enregistrée.",
    RECEIPT_CHANGED_REVIEW_REQUIRED:
      "Le justificatif a changé depuis le dépôt. Nouvelle vérification nécessaire ; validation refusée.",
    RECEIPT_REQUIRED: "Ajoutez le justificatif.",
    MISSION_DRIVE_FOLDER_REQUIRED:
      "Le dossier documentaire de cette mission doit être configuré avant le dépôt.",
    POSSIBLE_DUPLICATE_RECEIPT:
      "Cette pièce figure déjà dans les débours de la mission. Vérifiez la dépense existante.",
    NO_SELF_APPROVAL:
      "Une autre personne habilitée doit valider votre dépense.",
    SIKA_BUSY_RETRY:
      "Un enregistrement est en cours. Réessayez dans quelques instants.",
    ACCOUNTING_MAPPING_REQUIRED:
      "Le Partner ou Owner doit configurer le fichier comptable dans Paramètres.",
    ACCOUNTING_ROW_CONFLICT:
      "La ligne comptable a été modifiée. Aucune cellule n’a été écrasée.",
    ACCOUNTING_NO_EMPTY_ROW: "Aucune ligne vide dans la plage autorisée.",
    EXPENSE_CHANGED_RELOAD:
      "La dépense a changé. Actualisez avant de continuer.",
    CONTRACT_BASIS_REQUIRED:
      "Précisez la clause ou l’accord client autorisant la refacturation.",
    ADVANCE_NOT_ACTUAL_EXPENSE:
      "Une avance reste une demande : elle ne peut pas être transférée comme dépense réelle.",
    RECEIPT_PDF_IMAGE_MAX_2MB:
      "Choisissez un PDF, PNG ou JPEG de 2 Mo maximum.",
    RECEIPT_CONTENT_TYPE_MISMATCH:
      "Le contenu du justificatif ne correspond pas au format annoncé.",
  };
  function status(text, bad) {
    var p = host.querySelector("[data-status]");
    if (p) {
      p.textContent = text;
      p.style.color = bad ? "#b42318" : "";
    }
  }
  function post(data) {
    return OM.api("/api/app?route=sika-expenses", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }
  async function submit(form, data) {
    var buttons = form.querySelectorAll("button");
    buttons.forEach(function (b) {
      b.disabled = true;
    });
    try {
      var result = await post(data);
      await load();
      status(
        result.accounting && result.accounting.pending
          ? "Décision enregistrée. Transfert comptable en attente : " +
              (errors[result.accounting.error] || result.accounting.error)
          : result.accounting && result.accounting.synced
            ? "Dépense validée ; ligne comptable remplie et vérifiée."
            : "Enregistré.",
      );
    } catch (e) {
      status(errors[e.message] || e.message, true);
    } finally {
      buttons.forEach(function (b) {
        b.disabled = false;
      });
    }
  }
  function link(parent, url, label) {
    if (!/^https:\/\//.test(url || "")) {
      parent.append(
        node("span", label + " — référence locale disponible dans le dossier"),
      );
      return;
    }
    var a = node("a", label);
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    parent.append(a);
  }
  function review(e, parent) {
    var details = node("details"),
      summary = node("summary", "Examiner la dépense");
    details.append(summary);
    var f = node("form");
    select(f, "billable", "Refacturation au client", [
      ["pending", "À déterminer"],
      ["yes", "Oui, selon accord client"],
      ["no", "Non, à la charge du cabinet"],
    ]);
    field(
      f,
      "contract_basis",
      "Clause / accord client (obligatoire si refacturable)",
      "text",
    );
    field(f, "note", "Motif de la décision", "textarea", true);
    ["approve", "reject"].forEach(function (action) {
      var b = node(
        "button",
        action === "approve" ? "Valider" : "Refuser",
        "btn ghost",
      );
      b.type = "submit";
      b.value = action;
      f.append(b);
    });
    f.onsubmit = function (ev) {
      ev.preventDefault();
      var d = Object.fromEntries(new FormData(f));
      Object.assign(d, {
        action: ev.submitter.value,
        id: e.id,
        mission_id: e.mission_id,
        expected_version: e.version,
      });
      submit(f, d);
    };
    details.append(f);
    parent.append(details);
  }
  function record(e, parent, action, label) {
    var box = node("details");
    box.append(node("summary", label));
    var f = node("form");
    field(
      f,
      "reference",
      action === "invoice"
        ? "Référence de la facture existante"
        : "Référence du remboursement",
      "text",
      true,
    );
    field(
      f,
      "evidence",
      "Lien ou référence précise du justificatif",
      "text",
      true,
    );
    f.append(
      node(
        "p",
        "Enregistrement déclaré par la comptabilité ; aucun paiement ni envoi de facture n’est exécuté.",
        "meta",
      ),
    );
    var b = node("button", "Enregistrer", "btn ghost");
    b.type = "submit";
    f.append(b);
    f.onsubmit = function (ev) {
      ev.preventDefault();
      submit(
        f,
        Object.assign(Object.fromEntries(new FormData(f)), {
          action: action,
          id: e.id,
          mission_id: e.mission_id,
          expected_version: e.version,
        }),
      );
    };
    box.append(f);
    parent.append(box);
  }
  function configure() {
    var box = node("details");
    box.open = path === "/parametres.html";
    box.append(node("summary", "SIKA — raccordement au tableau comptable"));
    box.append(
      node(
        "p",
        "Indiquez le fichier Excel de suivi existant et ses colonnes d’entrée. SIKA ajoute uniquement les dépenses validées dans des lignes vides. Les formules et les saisies existantes sont conservées.",
        "meta",
      ),
    );
    var f = node("form"),
      cfg = state.accounting || {};
    field(
      f,
      "file_id",
      "Lien ou identifiant du fichier Excel (Drive ou serveur)",
      "text",
      true,
      cfg.file_id,
    );
    field(f, "sheet", "Nom exact de la feuille", "text", true, cfg.sheet);
    field(
      f,
      "start_row",
      "Première ligne d’entrée",
      "number",
      true,
      cfg.start_row || 2,
    );
    field(
      f,
      "end_row",
      "Dernière ligne autorisée (500 lignes maximum)",
      "number",
      true,
      cfg.end_row || 100,
    );
    var labels = [
      "Identifiant unique du débours",
      "Mission",
      "Date",
      "Description",
      "Montant",
      "Devise",
      "Payé par",
      "Lien du justificatif",
      "Validé par",
      "Refacturable (yes/no/pending)",
    ];
    state.accounting_fields.forEach(function (key, i) {
      field(
        f,
        "col_" + key,
        labels[i] + " — colonne Excel",
        "text",
        true,
        (cfg.columns && cfg.columns[key]) || String.fromCharCode(65 + i),
      );
    });
    var b = node("button", "Vérifier et enregistrer le raccordement", "btn");
    b.type = "submit";
    f.append(b);
    f.onsubmit = function (ev) {
      ev.preventDefault();
      var d = Object.fromEntries(new FormData(f));
      d.action = "configure";
      d.columns = {};
      state.accounting_fields.forEach(function (key) {
        d.columns[key] = d["col_" + key].trim().toUpperCase();
        delete d["col_" + key];
      });
      submit(f, d);
    };
    box.append(f);
    host.append(box);
  }
  function render() {
    host.textContent = "";
    var title = node("h2", "SIKA · Débours de mission"); title.id = "h-sika-expenses"; host.append(title);
    host.append(
      node(
        "p",
        "Déposer la pièce → faire valider → remplir le suivi comptable → suivre remboursement et facturation.",
        "meta",
      ),
    );
    var p = node("p");
    p.dataset.status = "";
    p.setAttribute("role", "status");
    p.setAttribute("aria-live", "polite");
    host.append(p);
    if (path === "/parametres.html") {
      if (state.may_configure) configure();
      else host.append(node("p", "Configuration réservée au Partner / Owner."));
      return;
    }
    var filter = node("form");
    var s = select(
      filter,
      "mission",
      "Mission",
      [["", "Choisir une mission"]].concat(
        state.missions.map(function (m) {
          return [m.id, m.name];
        }),
      ),
    );
    s.value = selected;
    s.onchange = function () {
      selected = s.value;
      render();
    };
    host.append(filter);
    if (!selected) {
      host.append(
        node(
          "p",
          "Choisissez la mission pour saisir ou suivre ses débours.",
          "meta",
        ),
      );
      return;
    }
    var details = node("details");
    details.append(node("summary", "Ajouter un débours"));
    var f = node("form");
    field(f, "description", "Nature de la dépense", "text", true);
    field(
      f,
      "date",
      "Date de la dépense",
      "date",
      true,
      new Date().toISOString().slice(0, 10),
    );
    var amount = field(f, "amount", "Montant", "number", true);
    amount.step = "0.01";
    amount.min = "0.01";
    field(f, "currency", "Devise (XOF, EUR…)", "text", true);
    field(f, "paid_by", "Payé par / personne à rembourser", "text", true);
    var receipt = field(
      f,
      "receipt",
      "Justificatif PDF ou photo — 2 Mo maximum",
      "file",
      true,
    );
    receipt.accept = "application/pdf,image/png,image/jpeg";
    var b = node("button", "Déposer et demander validation", "btn");
    b.type = "submit";
    f.append(b);
    f.onsubmit = async function (ev) {
      ev.preventDefault();
      b.disabled = true;
      try {
        var file = receipt.files[0];
        if (!file || file.size > 2 * 1024 * 1024)
          throw new Error("RECEIPT_PDF_IMAGE_MAX_2MB");
        var base64 = await new Promise(function (resolve, reject) {
          var reader = new FileReader();
          reader.onload = function () {
            resolve(String(reader.result).split(",")[1]);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        var data = Object.fromEntries(new FormData(f));
        delete data.receipt;
        Object.assign(data, {
          action: "create",
          id: requestId,
          mission_id: selected,
          receipt: { base64: base64, mime: file.type },
        });
        await post(data);
        requestId = crypto.randomUUID();
        await load();
        status(
          "Débours enregistré ; justificatif sauvegardé et vérifié. En attente de validation.",
        );
      } catch (e) {
        status(errors[e.message] || e.message, true);
      } finally {
        b.disabled = false;
      }
    };
    details.append(f);
    host.append(details);
    var list = node("div", "", "sika-ledger");
    var rows = state.expenses.filter(function (e) {
      return e.mission_id === selected;
    });
    if (!rows.length)
      list.append(node("p", "Aucun débours enregistré pour cette mission."));
    var labels = {
      submitted: "À valider",
      approved: "Validé",
      rejected: "Refusé",
    };
    rows.forEach(function (e) {
      var card = node("article", "", "sika-expense");
      card.append(node("h3", e.description));
      card.append(
        node(
          "p",
          e.date +
            " · " +
            (e.amount_minor / 100).toLocaleString("fr-FR") +
            " " +
            e.currency +
            " · " +
            labels[e.status],
        ),
      );
      card.append(
        node("p", "Payé par : " + e.paid_by + " · Saisi par : " + e.created_by),
      );
      if (e.receipt) link(card, e.receipt.url, "Ouvrir le justificatif");
      if (e.approval)
        card.append(
          node(
            "p",
            "Décision : " +
              e.approval.by +
              " · " +
              e.approval.note +
              " · Refacturable : " +
              { yes: "oui", no: "non", pending: "à déterminer" }[
                e.approval.billable
              ],
          ),
        );
      if (e.status === "approved" && !e.sync)
        card.append(
          node("p", "Transfert vers le fichier comptable à effectuer."),
        );
      if (e.sync)
        card.append(
          node(
            "p",
            "Écriture comptable vérifiée le " +
              e.sync.verified_at.slice(0, 10) +
              " · " +
              e.sync.sheet +
              ", ligne " +
              e.sync.row,
          ),
        );
      if (
        ["submitted", "rejected"].indexOf(e.status) >= 0 &&
        e.created_by === ((OM.getSession() || {}).user || {}).email
      ) {
        var edit = node("details");
        edit.append(node("summary", "Corriger ma saisie"));
        var ef = node("form");
        field(
          ef,
          "description",
          "Nature corrigée",
          "text",
          true,
          e.description,
        );
        field(ef, "date", "Date corrigée", "date", true, e.date);
        var amount = field(
          ef,
          "amount",
          "Montant corrigé",
          "number",
          true,
          e.amount_minor / 100,
        );
        amount.step = "0.01";
        amount.min = "0.01";
        field(ef, "currency", "Devise corrigée", "text", true, e.currency);
        field(ef, "paid_by", "Payé par — correction", "text", true, e.paid_by);
        field(ef, "note", "Motif de la correction", "textarea", true);
        var eb = node("button", "Soumettre la correction", "btn ghost");
        eb.type = "submit";
        ef.append(eb);
        ef.onsubmit = function (ev) {
          ev.preventDefault();
          submit(
            ef,
            Object.assign(Object.fromEntries(new FormData(ef)), {
              action: "revise",
              id: e.id,
              mission_id: e.mission_id,
              expected_version: e.version,
              type: e.type,
            }),
          );
        };
        edit.append(ef);
        card.append(edit);
      }
      if (
        e.status === "submitted" &&
        state.may_review &&
        e.created_by !== ((OM.getSession() || {}).user || {}).email
      )
        review(e, card);
      if (e.status === "approved" && state.may_account) {
        card.append(
          button(
            e.sync
              ? "Revérifier le transfert comptable"
              : "Remplir le fichier comptable",
            async function () {
              var self = this;
              self.disabled = true;
              try {
                await post({
                  action: "sync",
                  id: e.id,
                  mission_id: e.mission_id,
                  expected_version: e.version,
                });
                await load();
                status("Ligne comptable écrite et vérifiée.");
              } catch (err) {
                status(errors[err.message] || err.message, true);
              } finally {
                self.disabled = false;
              }
            },
          ),
        );
        if (!e.reimbursement)
          record(e, card, "reimburse", "Enregistrer le remboursement");
        if (!e.invoice && e.approval.billable === "yes")
          record(e, card, "invoice", "Rattacher à une facture");
      }
      if (e.reimbursement)
        card.append(
          node("p", "Remboursement déclaré : " + e.reimbursement.reference),
        );
      if (e.invoice)
        card.append(node("p", "Facture rattachée : " + e.invoice.reference));
      list.append(card);
    });
    host.append(list);
    if (state.may_account && !state.accounting) {
      var hint = node("p", "Fichier comptable non configuré. ");
      var a = node("a", "Raccordement dans Paramètres");
      a.href = "/parametres.html#sika-expenses";
      hint.append(a);
      host.append(hint);
    }
    var history = node("details");
    history.append(node("summary", "Historique des opérations"));
    state.history
      .filter(function (h) {
        return rows.some(function (e) {
          return e.id === h.id;
        });
      })
      .forEach(function (h) {
        history.append(node("p", h.at + " · " + h.by + " · " + h.action));
      });
    host.append(history);
  }
  async function load() {
    state = await OM.api(
      "/api/app?route=sika-expenses" +
        (missionId ? "&mission_id=" + encodeURIComponent(missionId) : ""),
    );
    if (!host) {
      if (
        ["/accueil.html", "/secretariat.html"].indexOf(path) >= 0 &&
        !state.may_account &&
        !state.may_review
      )
        return;
      if (path === "/parametres.html" && !state.may_configure) return;
      host = node("section", "", "card sika-panel");
      host.id = "sika-expenses";
      (path === "/mission.html"
        ? document.querySelector("#dossier-view .mission-sections") ||
          document.querySelector("#dossier-view") ||
          main
        : main
      ).append(host);
    }
    render();
  }
  load().catch(function (e) {
    if (host) status(errors[e.message] || e.message, true);
    else {
      host = node("section", "", "card sika-panel");
      host.append(node("h2", "SIKA · Débours"));
      var p = node("p");
      p.dataset.status = "";
      p.setAttribute("role", "status");
      host.append(p);
      main.append(host);
      status(errors[e.message] || e.message, true);
      host.append(
        button("Réessayer", function () {
          load().catch(function (err) {
            status(errors[err.message] || err.message, true);
          });
        }),
      );
    }
  });
})();
