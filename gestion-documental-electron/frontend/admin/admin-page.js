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

  const state = window.adminState.createAdminState();
  const notify = createNotifier();
  const AVAILABLE_VIEWS = [
    "dashboard",
    "root-folders",
    "indexing",
    "documents",
    "create-document",
  ];

  let documentsModule;
  let rootFoldersModule;
  let indexingModule;

  function setActiveView(view) {
    const nextView = AVAILABLE_VIEWS.includes(view) ? view : "dashboard";

    document.querySelectorAll("[data-admin-view-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.adminViewPanel !== nextView;
    });

    document.querySelectorAll("[data-admin-view-trigger]").forEach((trigger) => {
      trigger.classList.toggle(
        "is-active",
        trigger.dataset.adminViewTrigger === nextView,
      );
    });

    state.currentView = nextView;
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function bindViewNavigation() {
    const container = document.querySelector(".admin-panel");
    if (!container || container.dataset.boundViewNavigation === "true") {
      return;
    }

    container.dataset.boundViewNavigation = "true";
    container.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-admin-view-trigger]");
      if (!trigger) {
        return;
      }

      setActiveView(trigger.dataset.adminViewTrigger);
    });
  }

  async function authAndInit() {
    try {
      const { response, data } = await window.adminApi.getMe();

      if (response.status === 401 || !response.ok) {
        window.location.href = "index.html";
        return;
      }

      if (data.user?.role !== "admin") {
        window.location.href = "user.html";
        return;
      }

      document.getElementById("userName").textContent = data.user?.name || "Admin";
      await rootFoldersModule.loadRootFolders();
      await indexingModule.refreshIndexingStatus();
    } catch (error) {
      console.error("Error auth/admin:", error);
      window.location.href = "index.html";
    }
  }

  async function logout() {
    await window.adminApi.logout();
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

    documentsModule = window.adminDocuments.createModule({
      state,
      api: window.adminApi,
      notify,
    });
    rootFoldersModule = window.adminRootFolders.createModule({
      state,
      api: window.adminApi,
      notify,
      onFoldersChanged: documentsModule.syncRootFolderSelects,
    });
    indexingModule = window.adminIndexing.createModule({
      state,
      api: window.adminApi,
      notify,
    });

    bindLogout();
    bindViewNavigation();
    setActiveView("dashboard");
    rootFoldersModule.init();
    indexingModule.init();
    documentsModule.init();
    documentsModule.clearDocumentsList();

    await authAndInit();
  }

  window.addEventListener("DOMContentLoaded", setup);
  window.addEventListener("beforeunload", () => {
    indexingModule?.destroy();
  });
})();
