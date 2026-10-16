(function () {
  "use strict";
  var OM = window.OfficeManager,
    $ = function (id) {
      return document.getElementById(id);
    },
    parent = null,
    generation = 0,
    busy = false;
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
  function api(action, args) {
    var query = new URLSearchParams(
      Object.assign({ route: "server-files", action: action }, args || {}),
    );
    return OM.api("/api/app?" + query);
  }
  function say(error) {
    var code = (error && error.message) || "";
    var messages = {
      LOCAL_CONNECTOR_NOT_CONFIGURED:
        "Le serveur du cabinet n’est pas encore connecté. Votre Drive reste disponible.",
      LOCAL_CONNECTOR_UNREACHABLE:
        "Le serveur du cabinet est indisponible. Réessayez ou contactez votre administrateur.",
      ROOT_NOT_ALLOWED: "Vous n’avez pas accès à ce dossier.",
      FILE_CHANGED_RELOAD:
        "Le fichier a changé. Rechargez sa version actuelle.",
      LOCAL_PERSONAL_SESSION_REQUIRED:
        "Connectez-vous avec votre compte personnel.",
    };
    $("files-status").textContent =
      messages[code] || "Impossible de terminer cette action. " + code;
  }
  function clear() {
    generation++;
    $("files-list").textContent = "";
    $("files-navigation").textContent = "";
    $("files-detail").hidden = true;
    $("files-upload").hidden = true;
    parent = null;
    return generation;
  }
  function roots() {
    var g = clear();
    api("roots")
      .then(function (data) {
        if (g !== generation) return;
        $("files-status").textContent = "Vos dossiers autorisés";
        (data.roots || []).forEach(function (r) {
          button($("files-list"), r.name, function () {
            folder(r.id, r.writable);
          });
        });
        if (!data.roots.length)
          $("files-status").textContent =
            "Aucun dossier autorisé. Contactez le responsable du cabinet.";
      })
      .catch(say);
  }
  function folder(id, writable) {
    var g = clear();
    api("list", { id: id })
      .then(function (data) {
        if (g !== generation) return;
        parent = { id: id, writable: writable };
        $("files-status").textContent = "Dossier chargé";
        button($("files-navigation"), "Tous mes dossiers", roots);
        $("files-upload").hidden = !writable;
        (data.files || []).forEach(function (f) {
          var row = el("div");
          row.className = "item";
          if (f.mimeType === "application/vnd.google-apps.folder")
            button(row, f.name, function () {
              folder(f.id, writable);
            });
          else {
            button(row, f.name, function () {
              file(f.id);
            }).disabled = Boolean(f.too_large);
            if (f.too_large)
              row.appendChild(
                el("span", " Fichier trop volumineux pour ce connecteur"),
              );
          }
          $("files-list").appendChild(row);
        });
      })
      .catch(say);
  }
  function file(id) {
    var g = clear();
    api("meta", { id: id })
      .then(function (meta) {
        if (g !== generation) return;
        var box = $("files-detail");
        box.textContent = "";
        box.hidden = false;
        box.appendChild(el("h2", meta.name));
        box.appendChild(el("p", "Version : " + meta.modifiedTime));
        button($("files-navigation"), "Tous mes dossiers", roots);
        button(
          box,
          "Copier la référence pour le dossier ou le working file",
          function () {
            navigator.clipboard
              .writeText(meta.id)
              .then(function () {
                $("files-status").textContent = "Référence copiée";
              })
              .catch(say);
          },
        );
        button(box, "Télécharger", function () {
          api("download", { id: id })
            .then(function (d) {
              var bytes = Uint8Array.from(atob(d.base64), function (c) {
                return c.charCodeAt(0);
              });
              var url = URL.createObjectURL(
                new Blob([bytes], { type: "application/octet-stream" }),
              );
              var a = el("a");
              a.href = url;
              a.download = meta.name;
              a.click();
              setTimeout(function () {
                URL.revokeObjectURL(url);
              }, 1000);
            })
            .catch(say);
        });
        button(box, "Lire le document", function () {
          api("read", { id: id })
            .then(function (d) {
              if (g !== generation) return;
              var pre = el("pre", d.text || "Aucun texte extrait.");
              pre.style.whiteSpace = "pre-wrap";
              pre.style.overflowWrap = "anywhere";
              box.appendChild(pre);
              if (d.partial)
                box.appendChild(
                  el(
                    "p",
                    "Lecture partielle : téléchargez le document pour le consulter intégralement.",
                  ),
                );
            })
            .catch(say);
        });
        $("files-status").textContent = "Document retrouvé";
      })
      .catch(say);
  }
  $("upload-form").onsubmit = function (event) {
    event.preventDefault();
    var f = $("upload-file").files[0];
    if (busy || !parent || !f) return;
    if (f.size > 3000000) {
      $("files-status").textContent = "Limite : 3 Mo par fichier.";
      return;
    }
    busy = true;
    var dest = parent;
    var reader = new FileReader();
    reader.onload = function () {
      OM.api("/api/app?route=server-files", {
        method: "POST",
        body: JSON.stringify({
          action: "create",
          parentId: dest.id,
          name: f.name,
          base64: String(reader.result).split(",")[1],
        }),
      })
        .then(function () {
          folder(dest.id, dest.writable);
        })
        .catch(say)
        .finally(function () {
          busy = false;
        });
    };
    reader.onerror = function () {
      busy = false;
      say(new Error("Lecture du fichier impossible"));
    };
    reader.readAsDataURL(f);
  };
  if (!OM) {
    $("files-status").textContent = "Session indisponible";
    return;
  }
  var id = new URLSearchParams(location.search).get("file");
  if (id) file(id);
  else roots();
})();
