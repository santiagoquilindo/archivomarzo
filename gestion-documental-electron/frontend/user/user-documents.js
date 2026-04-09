(() => {
  function bindClick(button, handler) {
    if (!button || button.dataset.boundClick === "true") {
      return;
    }

    button.dataset.boundClick = "true";
    button.addEventListener("click", handler);
  }

  function createModule({ api, notify }) {
    function clearDocumentsList() {
      window.documentUi.clearDocumentsList({
        list: "documentsList",
        hint: "documentsHint",
        initialMessage: 'Los documentos aparecerán cuando pulses "Buscar".',
      });
    }

    function renderDocuments(documents) {
      window.documentUi.renderDocuments({
        list: document.getElementById("documentsList"),
        hint: document.getElementById("documentsHint"),
        docs: documents,
        actions: window.userState.USER_DOCUMENT_ACTIONS,
      });
    }

    async function searchDocuments() {
      const filters = {
        name: document.getElementById("filterName").value,
        voucher: document.getElementById("filterVoucher").value,
        status: document.getElementById("filterStatus").value,
      };
      const { response, data } = await api.searchDocuments(filters);
      renderDocuments(response.ok && Array.isArray(data) ? data : []);
    }

    async function handleDocumentSearch() {
      await searchDocuments();
    }

    async function viewDetail(id) {
      try {
        const { response, data } = await api.getDocument(id);
        if (!response.ok) {
          throw new Error(data.message || "No se pudo cargar el detalle.");
        }

        window.documentDialogs.showDocumentDetail(data);
      } catch (error) {
        notify(error.message, "error");
      }
    }

    async function openDoc(id) {
      const { response, data } = await api.openDocument(id);
      if (!response.ok || !data.success) {
        notify(data.message || "No se pudo abrir el archivo.", "error");
        return;
      }

      notify("Archivo abierto correctamente.", "success", {
        duration: 5000,
      });
    }

    async function viewHistory(id) {
      try {
        const { response, data } = await api.getDocumentHistory(id);
        if (!response.ok) {
          throw new Error(data.message || "No se pudo cargar el historial.");
        }

        window.documentDialogs.showHistory(Array.isArray(data) ? data : []);
      } catch (error) {
        notify(error.message, "error");
      }
    }

    async function handleDocumentAction({ action, id }) {
      if (!Number.isInteger(id)) {
        return;
      }

      if (action === "detail") {
        await viewDetail(id);
        return;
      }

      if (action === "open") {
        await openDoc(id);
        return;
      }

      if (action === "history") {
        await viewHistory(id);
      }
    }

    function init() {
      bindClick(document.getElementById("searchBtn"), handleDocumentSearch);
      window.documentUi.bindDelegatedClicks("documentsList", handleDocumentAction);
    }

    return {
      init,
      clearDocumentsList,
    };
  }

  window.userDocuments = {
    createModule,
  };
})();
