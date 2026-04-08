(() => {
  const FIELD_LABELS = [
    ["original_name", "Nombre original"],
    ["stored_name", "Nombre almacenado"],
    ["absolute_path", "Ruta absoluta"],
    ["relative_path", "Ruta relativa"],
    ["root_folder_name", "Carpeta raíz"],
    ["file_extension", "Extensión"],
    ["file_size", "Tamaño (bytes)"],
    ["file_hash", "Hash"],
    ["file_modified_at", "Última modificación"],
    ["document_date", "Fecha documental"],
    ["voucher_number", "Número de comprobante"],
    ["category", "Categoría"],
    ["document_type", "Tipo documental"],
    ["notes", "Notas"],
    ["source_area", "Área de origen"],
    ["status", "Estado"],
    ["created_at", "Creado"],
    ["updated_at", "Actualizado"],
  ];

  const STATUS_LABELS = {
    available: "Disponible",
    updated: "Actualizado",
    missing: "No encontrado",
    pending: "Pendiente",
    error: "Error",
    active: "Disponible",
  };

  const ACTION_LABELS = {
    created: "Creación",
    updated: "Actualización",
    opened: "Apertura",
    indexed: "Indexación",
    missing_detected: "Marcado como no encontrado",
    restored: "Restauración",
  };

  function createDialog() {
    const overlay = document.createElement("div");
    overlay.className = "details-dialog-overlay";
    overlay.innerHTML = `
      <div class="details-dialog" role="dialog" aria-modal="true" aria-labelledby="detailsDialogTitle">
        <div class="details-dialog-header">
          <h3 id="detailsDialogTitle" class="details-dialog-title"></h3>
          <button type="button" class="details-dialog-close" aria-label="Cerrar">x</button>
        </div>
        <div class="details-dialog-body"></div>
      </div>
    `;

    document.body.appendChild(overlay);
    overlay
      .querySelector(".details-dialog-close")
      .addEventListener("click", () => closeDialog());
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        closeDialog();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && overlay.classList.contains("is-visible")) {
        closeDialog();
      }
    });
    return overlay;
  }

  function getDialog() {
    return document.querySelector(".details-dialog-overlay") || createDialog();
  }

  function closeDialog() {
    const overlay = document.querySelector(".details-dialog-overlay");
    if (!overlay) {
      return;
    }
    overlay.classList.remove("is-visible");
  }

  function showDialog(title, contentNode) {
    const overlay = getDialog();
    overlay.querySelector(".details-dialog-title").textContent = title;
    const body = overlay.querySelector(".details-dialog-body");
    body.innerHTML = "";
    body.appendChild(contentNode);
    overlay.classList.add("is-visible");
  }

  function formatValue(value) {
    if (value === null || value === undefined || value === "") {
      return "Sin dato";
    }
    return String(value);
  }

  function formatFieldValue(field, value) {
    if (field === "status") {
      return STATUS_LABELS[value] || formatValue(value);
    }
    return formatValue(value);
  }

  function showDocumentDetail(documentData) {
    const wrapper = document.createElement("div");
    wrapper.className = "details-grid";

    FIELD_LABELS.forEach(([field, label]) => {
      const item = document.createElement("div");
      item.className = "details-grid-item";
      item.innerHTML = `
        <span class="details-grid-label">${label}</span>
        <span class="details-grid-value"></span>
      `;
      item.querySelector(".details-grid-value").textContent = formatFieldValue(
        field,
        documentData?.[field],
      );
      wrapper.appendChild(item);
    });

    showDialog("Detalle del documento", wrapper);
  }

  function showHistory(historyItems = []) {
    const wrapper = document.createElement("div");
    wrapper.className = "history-list";

    if (!historyItems.length) {
      const emptyState = document.createElement("p");
      emptyState.className = "details-empty";
      emptyState.textContent = "No hay historial registrado para este documento.";
      wrapper.appendChild(emptyState);
      showDialog("Historial del documento", wrapper);
      return;
    }

    historyItems.forEach((item) => {
      const card = document.createElement("article");
      card.className = "history-card";
      card.innerHTML = `
        <div class="history-card-title"></div>
        <div class="history-card-meta"></div>
        <div class="history-card-body"></div>
      `;

      card.querySelector(".history-card-title").textContent =
        ACTION_LABELS[item.action] || formatValue(item.action);
      card.querySelector(".history-card-meta").textContent =
        `Usuario: ${formatValue(item.performed_by)} | Fecha: ${formatValue(item.performed_at)}`;

      const body = card.querySelector(".history-card-body");
      const details = [
        ["Campo", item.field_name],
        ["Valor anterior", item.old_value],
        ["Valor nuevo", item.new_value],
      ].filter(([, value]) => value !== null && value !== undefined && value !== "");

      if (!details.length) {
        body.textContent = "Sin cambios detallados registrados.";
      } else {
        details.forEach(([label, value]) => {
          const row = document.createElement("p");
          row.className = "history-card-row";
          row.innerHTML = `<strong>${label}:</strong> `;
          row.appendChild(document.createTextNode(formatValue(value)));
          body.appendChild(row);
        });
      }

      wrapper.appendChild(card);
    });

    showDialog("Historial del documento", wrapper);
  }

  window.documentDialogs = {
    close: closeDialog,
    showDocumentDetail,
    showHistory,
  };
})();
