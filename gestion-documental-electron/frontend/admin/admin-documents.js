(() => {
  function bindSubmit(form, handler) {
    if (!form || form.dataset.boundSubmit === "true") {
      return;
    }

    form.dataset.boundSubmit = "true";
    form.addEventListener("submit", handler);
  }

  function bindChange(input, handler) {
    if (!input || input.dataset.boundChange === "true") {
      return;
    }

    input.dataset.boundChange = "true";
    input.addEventListener("change", handler);
  }

  function bindClick(button, handler) {
    if (!button || button.dataset.boundClick === "true") {
      return;
    }

    button.dataset.boundClick = "true";
    button.addEventListener("click", handler);
  }

  function createModule({ state, api, notify }) {
    function clearDocumentsList() {
      window.documentUi.clearDocumentsList({
        list: "documentsList",
        hint: "documentsHint",
        initialMessage:
          "No hay documentos indexados todavia. Agrega una carpeta para comenzar y ejecuta la indexacion.",
      });
    }

    function renderDocuments(documents) {
      window.documentUi.renderDocuments({
        list: document.getElementById("documentsList"),
        hint: document.getElementById("documentsHint"),
        docs: documents,
        actions: window.adminState.ADMIN_DOCUMENT_ACTIONS,
      });
    }

    function syncRootFolderSelects(rootFolders = state.currentRootFolders) {
      const createSelect = document.getElementById("docRootFolder");
      const filterSelect = document.getElementById("filterRootFolder");
      const selectedCreate = createSelect.value;
      const selectedFilter = filterSelect.value;

      createSelect.innerHTML = '<option value="">Seleccionar carpeta</option>';
      filterSelect.innerHTML = '<option value="">Todas las carpetas</option>';

      rootFolders.forEach((folder) => {
        const isActive = window.adminState.isFolderActive(folder);
        const name = isActive ? folder.name : `${folder.name} (inactiva)`;
        const optionMarkup = `<option value="${folder.id}">${window.documentUi.escapeHtml(
          name,
        )}</option>`;

        createSelect.insertAdjacentHTML("beforeend", optionMarkup);
        filterSelect.insertAdjacentHTML("beforeend", optionMarkup);
      });

      if ([...createSelect.options].some((option) => option.value === selectedCreate)) {
        createSelect.value = selectedCreate;
      }

      if ([...filterSelect.options].some((option) => option.value === selectedFilter)) {
        filterSelect.value = selectedFilter;
      }
    }

    async function searchDocuments() {
      const filters = {
        name: document.getElementById("filterName").value,
        voucher: document.getElementById("filterVoucher").value,
        rootFolderId: document.getElementById("filterRootFolder").value,
        status: document.getElementById("filterStatus").value,
      };
      const { response, data } = await api.searchDocuments(filters);
      window.documentUi.renderDocuments({
        list: document.getElementById("documentsList"),
        hint: document.getElementById("documentsHint"),
        docs: response.ok && Array.isArray(data) ? data : [],
        actions: window.adminState.ADMIN_DOCUMENT_ACTIONS,
        emptyMessage:
          "No hay resultados en el indice actual. Verifica filtros o ejecuta una nueva indexacion.",
      });
    }

    async function handleDocumentSearch() {
      state.hasSearchedDocuments = true;
      await searchDocuments();
    }

    function handleDocumentFileSelection(event) {
      const selection = window.pickerUtils.deriveFileSelection(
        event.target.files?.[0],
      );
      const pathInput = document.getElementById("docPath");
      const nameInput = document.getElementById("docName");
      const label = document.getElementById("pickedDocFileLabel");

      if (!selection) {
        pathInput.value = "";
        label.textContent = "Ningun archivo seleccionado";
        return;
      }

      pathInput.value = selection.absolutePath;
      label.textContent = selection.label;

      if (!nameInput.value.trim()) {
        nameInput.value = selection.suggestedName;
      }

      syncRelativePathWithSelection();
    }

    function syncRelativePathWithSelection() {
      const selectedFile = document.getElementById("docFile").files?.[0];
      const relativePathInput = document.getElementById("docRelativePath");
      const rootFolderSelect = document.getElementById("docRootFolder");

      if (!selectedFile || !rootFolderSelect.value) {
        return;
      }

      const selectedRootFolder = state.currentRootFolders.find(
        (folder) => String(folder.id) === String(rootFolderSelect.value),
      );
      const absolutePath = selectedFile.path || "";
      const rootAbsolutePath = selectedRootFolder?.absolute_path || "";

      if (!absolutePath || !rootAbsolutePath) {
        return;
      }

      relativePathInput.value = window.pickerUtils.deriveRelativePath(
        absolutePath,
        rootAbsolutePath,
        selectedFile.name || "",
      );
    }

    async function handleCreateDocument(event) {
      event.preventDefault();

      const rootFolderSelect = document.getElementById("docRootFolder");
      const selectedRootFolder = state.currentRootFolders.find(
        (folder) => String(folder.id) === String(rootFolderSelect.value),
      );
      const selectedFile = document.getElementById("docFile").files?.[0];
      const absolutePath =
        selectedFile?.path || document.getElementById("docPath").value;
      const originalName =
        document.getElementById("docName").value || selectedFile?.name || "";
      const fileExtension = selectedFile?.name?.includes(".")
        ? `.${selectedFile.name.split(".").pop().toLowerCase()}`
        : "";

      const payload = {
        originalName,
        absolutePath,
        relativePath: document.getElementById("docRelativePath").value,
        rootFolderId: rootFolderSelect.value,
        rootFolderName: selectedRootFolder?.name || "",
        fileExtension,
        documentDate: document.getElementById("docDate").value,
        voucherNumber: document.getElementById("docVoucher").value,
        category: document.getElementById("docCategory").value,
        documentType: document.getElementById("docType").value,
        notes: document.getElementById("docNotes").value,
        sourceArea: document.getElementById("docSourceArea").value,
      };

      const { response, data } = await api.createDocument(payload);
      if (!response.ok) {
        notify(data.message || "No se pudo crear el documento.", "error");
        return;
      }

      notify("Archivo subido y documento creado exitosamente.", "success", {
        duration: 5000,
      });

      event.target.reset();
      document.getElementById("pickedDocFileLabel").textContent =
        "Ningun archivo seleccionado";

      if (state.hasSearchedDocuments) {
        await searchDocuments();
      } else {
        clearDocumentsList();
      }
    }

    async function editDoc(id) {
      state.currentEditId = id;
      const { response, data } = await api.getDocument(id);

      if (!response.ok) {
        notify(data.message || "No se pudo cargar el documento.", "error");
        return;
      }

      document.getElementById("editDocId").value = data.id;
      document.getElementById("editDocDate").value = data.document_date || "";
      document.getElementById("editDocVoucher").value = data.voucher_number || "";
      document.getElementById("editDocCategory").value = data.category || "";
      document.getElementById("editDocType").value = data.document_type || "";
      document.getElementById("editDocNotes").value = data.notes || "";
      document.getElementById("editDocSourceArea").value = data.source_area || "";
      document.getElementById("editModal").classList.remove("is-hidden");
    }

    function closeEditModal() {
      document.getElementById("editModal").classList.add("is-hidden");
    }

    async function handleEditDocument(event) {
      event.preventDefault();

      const payload = {
        document_date: document.getElementById("editDocDate").value,
        voucher_number: document.getElementById("editDocVoucher").value,
        category: document.getElementById("editDocCategory").value,
        document_type: document.getElementById("editDocType").value,
        notes: document.getElementById("editDocNotes").value,
        source_area: document.getElementById("editDocSourceArea").value,
      };

      const { response, data } = await api.updateDocument(state.currentEditId, payload);
      if (!response.ok) {
        notify(data.message || "No se pudo actualizar el documento.", "error");
        return;
      }

      closeEditModal();
      notify("Documento actualizado exitosamente.", "success");

      if (state.hasSearchedDocuments) {
        await searchDocuments();
      }
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

      notify("Archivo abierto correctamente.", "success");
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

      if (action === "edit") {
        await editDoc(id);
      }
    }

    function init() {
      bindClick(document.getElementById("searchBtn"), handleDocumentSearch);
      bindSubmit(document.getElementById("createDocForm"), handleCreateDocument);
      bindChange(document.getElementById("docFile"), handleDocumentFileSelection);
      bindChange(document.getElementById("docRootFolder"), syncRelativePathWithSelection);
      bindClick(document.getElementById("closeEdit"), closeEditModal);
      bindSubmit(document.getElementById("editDocForm"), handleEditDocument);
      window.pickerUtils.bindPickerTrigger("pickDocFileBtn", "docFile");
      window.documentUi.bindDelegatedClicks("documentsList", handleDocumentAction);
    }

    return {
      init,
      clearDocumentsList,
      syncRootFolderSelects,
    };
  }

  window.adminDocuments = {
    createModule,
  };
})();
