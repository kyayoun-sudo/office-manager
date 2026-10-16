(function () {
  "use strict";
  var OM = window.OfficeManager;
  if (
    !OM ||
    !["owner", "partner", "manager", "supervisor", "bdm", "secretary"].includes(
      OM.getRole(),
    )
  )
    return;
  var box = document.getElementById("workflow-reference"),
    form = document.getElementById("workflow-reference-form"),
    status = document.getElementById("workflow-reference-status");
  box.hidden = false;
  form.onsubmit = function (e) {
    e.preventDefault();
    var button = form.querySelector("button");
    button.disabled = true;
    status.textContent = "Vérification du document…";
    OM.api("/api/app?route=secretariat", {
      method: "POST",
      body: JSON.stringify({
        action: "confirm-document",
        document_type: document.getElementById("workflow-reference-kind").value,
        document_role:
          document.getElementById("workflow-reference-kind").value ===
          "management_card_template"
            ? "template"
            : "firm_reference",
        file_link: document
          .getElementById("workflow-reference-link")
          .value.trim(),
      }),
    })
      .then(function () {
        status.textContent = "Document trouvé. Référence enregistrée.";
      })
      .catch(function (error) {
        status.textContent = "Document non confirmé : " + error.message;
      })
      .finally(function () {
        button.disabled = false;
      });
  };
})();
