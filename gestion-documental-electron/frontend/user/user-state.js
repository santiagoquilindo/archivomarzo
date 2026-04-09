(() => {
  const USER_DOCUMENT_ACTIONS = [
    { key: "detail", label: "Ver detalle" },
    { key: "open", label: "Abrir" },
    { key: "history", label: "Ver historial" },
  ];

  function createUserState() {
    return {
      initialized: false,
    };
  }

  window.userState = {
    USER_DOCUMENT_ACTIONS,
    createUserState,
  };
})();
