(() => {
  function bindFormSubmit(form, handler) {
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

  function bindClick(container, handler) {
    if (!container || container.dataset.boundClick === "true") {
      return;
    }

    container.dataset.boundClick = "true";
    container.addEventListener("click", handler);
  }

  function createModule({ state, api, notify, onFoldersChanged }) {
    function handleRootFolderSelection(event) {
      const selection = window.pickerUtils.deriveFolderSelection(
        event.target.files?.[0],
      );
      const pathInput = document.getElementById("folderPath");
      const nameInput = document.getElementById("folderName");
      const label = document.getElementById("pickedRootFolderLabel");

      if (!selection) {
        pathInput.value = "";
        label.textContent = "Ninguna carpeta seleccionada";
        return;
      }

      pathInput.value = selection.absolutePath;
      label.textContent = selection.label;

      if (!nameInput.value.trim()) {
        nameInput.value = selection.suggestedName;
      }
    }

    async function loadRootFolders() {
      const { response, data } = await api.listRootFolders();
      state.currentRootFolders = response.ok && Array.isArray(data) ? data : [];
      renderRootFolders();

      if (typeof onFoldersChanged === "function") {
        onFoldersChanged(state.currentRootFolders);
      }
    }

    function renderRootFolders() {
      const list = document.getElementById("rootFoldersList");

      if (!state.currentRootFolders.length) {
        list.innerHTML =
          '<li class="root-folder-empty"><strong>No hay carpetas agregadas.</strong><span>Agrega una carpeta para comenzar y luego ejecuta la indexacion.</span></li>';
        return;
      }

      list.innerHTML = state.currentRootFolders
        .map((folder) => {
          const isActive = window.adminState.isFolderActive(folder);
          const name = window.documentUi.escapeHtml(folder.name || "");
          const absolutePath = window.documentUi.escapeHtml(folder.absolute_path || "");
          const stateLabel = isActive ? "Activa" : "Inactiva";
          const stateClass = isActive ? "success" : "warning";
          const toggleLabel = isActive ? "Desactivar" : "Activar";

          return `
            <li class="root-folder-item">
              <div class="root-folder-meta">
                <strong class="root-folder-name">${name}</strong>
                <span class="root-folder-path">${absolutePath}</span>
              </div>
              <div class="root-folder-actions">
                <span class="root-folder-state status-badge status-${stateClass}">
                  ${stateLabel}
                </span>
                <button
                  type="button"
                  class="button-secondary"
                  data-folder-action="toggle"
                  data-folder-id="${folder.id}"
                  data-folder-next-state="${isActive ? "false" : "true"}"
                >
                  ${toggleLabel}
                </button>
                <button
                  type="button"
                  class="button-danger"
                  data-folder-action="delete"
                  data-folder-id="${folder.id}"
                >
                  Eliminar
                </button>
              </div>
            </li>
          `;
        })
        .join("");
    }

    async function handleRootFolderSubmit(event) {
      event.preventDefault();

      const payload = {
        name: document.getElementById("folderName").value.trim(),
        absolutePath: document.getElementById("folderPath").value.trim(),
      };

      const { response, data } = await api.createRootFolder(payload);
      if (!response.ok) {
        notify(data.message || "No se pudo agregar la carpeta raiz.", "error");
        return;
      }

      event.target.reset();
      document.getElementById("pickedRootFolderLabel").textContent =
        "Ninguna carpeta seleccionada";
      await loadRootFolders();
      notify(
        "Carpeta raiz agregada exitosamente. Ejecuta la indexacion para incluir sus documentos en la busqueda.",
        "success",
        { duration: 5500 },
      );
    }

    async function toggleFolder(id, active) {
      const { response, data } = await api.updateRootFolderStatus(id, active);
      if (!response.ok) {
        notify(data.message || "No se pudo actualizar la carpeta raiz.", "error");
        return;
      }

      await loadRootFolders();
      notify(
        `Carpeta raiz ${active ? "activada" : "desactivada"} exitosamente. Recuerda volver a indexar si quieres reflejar el cambio en la busqueda.`,
        "success",
      );
    }

    async function deleteFolder(id) {
      const confirmed = window.confirm(
        "Vas a eliminar esta carpeta raiz del indice.\n\nLos documentos asociados dejaran de aparecer en la busqueda indexada.\n\n¿Deseas continuar?"
      );

      if (!confirmed) {
        return;
      }

      const { response, data } = await api.deleteRootFolder(id);
      if (!response.ok) {
        notify(data.message || "No se pudo eliminar la carpeta raiz.", "error");
        return;
      }

      await loadRootFolders();
      notify(
        `Carpeta raiz eliminada. Documentos removidos del indice: ${data.deletedDocuments || 0}.`,
        "success",
      );
    }

    function handleRootFolderActions(event) {
      const button = event.target.closest("[data-folder-action]");
      if (!button) {
        return;
      }

      const folderId = Number.parseInt(button.dataset.folderId, 10);
      if (!Number.isInteger(folderId)) {
        return;
      }

      if (button.dataset.folderAction === "toggle") {
        toggleFolder(folderId, button.dataset.folderNextState === "true");
        return;
      }

      if (button.dataset.folderAction === "delete") {
        deleteFolder(folderId);
      }
    }

    function init() {
      bindFormSubmit(document.getElementById("rootFolderForm"), handleRootFolderSubmit);
      bindChange(document.getElementById("rootFolderPicker"), handleRootFolderSelection);
      bindClick(document.getElementById("rootFoldersList"), handleRootFolderActions);
      window.pickerUtils.bindPickerTrigger("pickRootFolderBtn", "rootFolderPicker");
    }

    return {
      init,
      loadRootFolders,
    };
  }

  window.adminRootFolders = {
    createModule,
  };
})();
