(() => {
  const DOCUMENT_STATUS = {
    available: {
      label: "Disponible",
      background: "#dcfce7",
      color: "#166534",
      border: "#86efac",
    },
    updated: {
      label: "Actualizado",
      background: "#fef3c7",
      color: "#92400e",
      border: "#fcd34d",
    },
    missing: {
      label: "No encontrado",
      background: "#fee2e2",
      color: "#b91c1c",
      border: "#fca5a5",
    },
    pending: {
      label: "Pendiente",
      background: "#e5e7eb",
      color: "#4b5563",
      border: "#d1d5db",
    },
    error: {
      label: "Error",
      background: "#ffedd5",
      color: "#c2410c",
      border: "#fdba74",
    },
  };

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeDocumentStatus(status) {
    return status === "active" ? "available" : status || "pending";
  }

  function getStatusBadge(status) {
    const normalizedStatus = normalizeDocumentStatus(status);
    const meta = DOCUMENT_STATUS[normalizedStatus] || DOCUMENT_STATUS.pending;
    return `<span class="status-badge" style="background:${meta.background};color:${meta.color};border-color:${meta.border};">${meta.label}</span>`;
  }

  function buildDocumentQuery(filters) {
    const params = new URLSearchParams();

    Object.entries(filters || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        params.set(key, String(value).trim());
      }
    });

    return params.toString();
  }

  function clearDocumentsList(options = {}) {
    const list =
      typeof options.list === "string"
        ? document.getElementById(options.list)
        : options.list;
    const hint =
      typeof options.hint === "string"
        ? document.getElementById(options.hint)
        : options.hint;
    const initialMessage =
      options.initialMessage || 'Los documentos aparecerán cuando pulses "Buscar".';

    if (list) {
      list.innerHTML = "";
    }

    if (hint) {
      hint.textContent = initialMessage;
    }
  }

  function renderDocuments(options) {
    const { list, hint, docs = [], actions = [], emptyMessage } = options;

    list.innerHTML = "";

    if (!docs.length) {
      hint.textContent =
        emptyMessage || "No se encontraron documentos para los criterios ingresados.";
      return;
    }

    hint.textContent = `Resultados: ${docs.length}`;

    const table = document.createElement("div");
    table.className = "documents-table-wrapper";
    table.innerHTML = `
      <table class="documents-table">
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Comprobante</th>
            <th>Estado</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${docs
            .map(
              (doc) => `
                <tr>
                  <td>${escapeHtml(doc.original_name || "")}</td>
                  <td>${escapeHtml(doc.voucher_number || "Sin comprobante")}</td>
                  <td>${getStatusBadge(doc.status)}</td>
                  <td>
                    <div class="documents-actions">
                      ${actions
                        .map(
                          (action) => `
                            <button
                              type="button"
                              data-doc-action="${escapeHtml(action.key)}"
                              data-doc-id="${doc.id}"
                            >
                              ${escapeHtml(action.label)}
                            </button>
                          `,
                        )
                        .join("")}
                    </div>
                  </td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    `;

    list.appendChild(table);
  }

  function bindDelegatedClicks(containerTarget, handler) {
    const container =
      typeof containerTarget === "string"
        ? document.getElementById(containerTarget)
        : containerTarget;

    if (!container || container.dataset.boundClick === "true") {
      return;
    }

    container.dataset.boundClick = "true";
    container.addEventListener("click", (event) => {
      const button = event.target.closest("[data-doc-action]");
      if (!button) {
        return;
      }

      handler({
        action: button.dataset.docAction,
        id: Number.parseInt(button.dataset.docId, 10),
        event,
        button,
      });
    });
  }

  window.documentUi = {
    DOCUMENT_STATUS,
    buildDocumentQuery,
    bindDelegatedClicks,
    clearDocumentsList,
    escapeHtml,
    getStatusBadge,
    normalizeDocumentStatus,
    renderDocuments,
  };
})();
