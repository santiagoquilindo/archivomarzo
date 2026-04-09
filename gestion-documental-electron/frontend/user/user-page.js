(() => {
  function createNotifier() {
    return (message, type = "info", options = {}) => {
      if (!message) {
        return;
      }

      const defaults =
        type === "error"
          ? { duration: 7000, closable: true }
          : { duration: 4000, closable: true };

      window.appNotifier?.show(message, {
        type,
        ...defaults,
        ...options,
      });
    };
  }

  const state = window.userState.createUserState();
  const notify = createNotifier();
  let documentsModule;

  async function loadUser() {
    try {
      const { response, data } = await window.userApi.getMe();

      if (response.status !== 200) {
        window.location.href = "index.html";
        return;
      }

      if (data.user?.role !== "user") {
        window.location.href = "admin.html";
        return;
      }

      document.getElementById("userName").textContent = data.user?.name || "Usuario";
    } catch (error) {
      console.error("Error auth/user:", error);
      window.location.href = "index.html";
    }
  }

  async function logout() {
    await window.userApi.logout();
    window.location.href = "index.html";
  }

  function bindLogout() {
    const button = document.getElementById("logoutBtn");
    if (!button || button.dataset.boundClick === "true") {
      return;
    }

    button.dataset.boundClick = "true";
    button.addEventListener("click", logout);
  }

  async function setup() {
    if (state.initialized) {
      return;
    }

    state.initialized = true;
    documentsModule = window.userDocuments.createModule({
      api: window.userApi,
      notify,
    });

    bindLogout();
    documentsModule.init();
    documentsModule.clearDocumentsList();
    await loadUser();
  }

  window.addEventListener("DOMContentLoaded", setup);
})();
