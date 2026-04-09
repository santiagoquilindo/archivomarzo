(() => {
  const INDEX_STATUS = {
    running: {
      color: "#16a34a",
      text: "Indexación en ejecución",
      background: "#ecfdf3",
      border: "#86efac",
    },
    failed: {
      color: "#dc2626",
      text: "Error de indexación",
      background: "#fef2f2",
      border: "#fca5a5",
    },
    unavailable: {
      color: "#dc2626",
      text: "Indexación no disponible",
      background: "#fef2f2",
      border: "#fca5a5",
    },
    inactive: {
      color: "#146c2e",
      text: "Indexación inactiva",
      background: "#ecfdf3",
      border: "#86efac",
    },
  };

  const ADMIN_DOCUMENT_ACTIONS = [
    { key: "detail", label: "Ver detalle" },
    { key: "open", label: "Abrir" },
    { key: "edit", label: "Editar" },
  ];

  function createAdminState() {
    return {
      initialized: false,
      currentEditId: null,
      hasSearchedDocuments: false,
      indexStatusPoller: null,
      currentRootFolders: [],
    };
  }

  function isFolderActive(folder) {
    return Number(folder?.is_active) === 1;
  }

  window.adminState = {
    INDEX_STATUS,
    ADMIN_DOCUMENT_ACTIONS,
    createAdminState,
    isFolderActive,
  };
})();
