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
          '<li class="root-folder-item">No hay carpetas raíz registradas.</li>';
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
                  data-folder-action="toggle"
                  data-folder-id="${folder.id}"
                  data-folder-next-state="${isActive ? "false" : "true"}"
                >
                  ${toggleLabel}
                </button>
                <button
                  type="button"
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
        notify(data.message || "No se pudo agregar la carpeta raíz.", "error");
        return;
      }

      event.target.reset();
      document.getElementById("pickedRootFolderLabel").textContent =
        "Ninguna carpeta seleccionada";
      await loadRootFolders();
      notify("Carpeta raíz agregada exitosamente.", "success");
    }

    async function toggleFolder(id, active) {
      const { response, data } = await api.updateRootFolderStatus(id, active);
      if (!response.ok) {
        notify(data.message || "No se pudo actualizar la carpeta raíz.", "error");
        return;
      }

      await loadRootFolders();
      notify(
        `Carpeta raíz ${active ? "activada" : "desactivada"} exitosamente.`,
        "success",
      );
    }

    async function deleteFolder(id) {
      const { response, data } = await api.deleteRootFolder(id);
      if (!response.ok) {
        notify(data.message || "No se pudo eliminar la carpeta raíz.", "error");
        return;
      }

      await loadRootFolders();
      notify("Carpeta raíz eliminada exitosamente.", "success");
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
