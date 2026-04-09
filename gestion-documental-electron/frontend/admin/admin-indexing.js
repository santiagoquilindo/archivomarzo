(() => {
  function bindClick(button, handler) {
    if (!button || button.dataset.boundClick === "true") {
      return;
    }

    button.dataset.boundClick = "true";
    button.addEventListener("click", handler);
  }

  function createModule({ state, api, notify }) {
    function setIndexStatus(statusKey, detail = "") {
      const status =
        window.adminState.INDEX_STATUS[statusKey] ||
        window.adminState.INDEX_STATUS.inactive;
      const container = document.getElementById("indexStatus");
      const dot = document.getElementById("indexStatusDot");
      const text = document.getElementById("indexStatusText");
      const suffix = detail ? `: ${detail}` : "";

      dot.style.background = status.color;
      container.style.background = status.background;
      container.style.borderColor = status.border;
      text.textContent = `${status.text}${suffix}`;
    }

    async function refreshIndexingStatus() {
      try {
        const { response, data } = await api.getIndexingRuns();

        if (!response.ok) {
          throw new Error("No se pudo consultar el estado de indexación");
        }

        const latestRun = Array.isArray(data) && data.length > 0 ? data[0] : null;

        if (!latestRun) {
          stopIndexStatusPolling();
          setIndexStatus("inactive");
          return;
        }

        if (latestRun.status === "running") {
          setIndexStatus("running");
          return;
        }

        stopIndexStatusPolling();

        if (latestRun.status === "completed") {
          setIndexStatus("inactive");
          return;
        }

        setIndexStatus("failed", latestRun.notes || "");
      } catch (error) {
        console.error("Error loading indexing status:", error);
        stopIndexStatusPolling();
        setIndexStatus("unavailable");
      }
    }

    function startIndexStatusPolling() {
      stopIndexStatusPolling();
      state.indexStatusPoller = window.setInterval(refreshIndexingStatus, 2000);
      refreshIndexingStatus();
    }

    function stopIndexStatusPolling() {
      if (!state.indexStatusPoller) {
        return;
      }

      window.clearInterval(state.indexStatusPoller);
      state.indexStatusPoller = null;
    }

    async function handleIndexingRun() {
      setIndexStatus("running");

      try {
        const { response, data } = await api.runIndexing();
        if (!response.ok) {
          throw new Error(data.message || "No se pudo iniciar la indexación");
        }

        startIndexStatusPolling();
        notify("La indexación se inició correctamente en segundo plano.", "success", {
          duration: 5000,
        });
      } catch (error) {
        console.error("Error starting indexing:", error);
        setIndexStatus("unavailable", error.message);
        notify(error.message || "No se pudo iniciar la indexación.", "error", {
          duration: 7000,
        });
      }
    }

    function init() {
      bindClick(document.getElementById("indexBtn"), handleIndexingRun);
    }

    function destroy() {
      stopIndexStatusPolling();
    }

    return {
      init,
      destroy,
      refreshIndexingStatus,
    };
  }

  window.adminIndexing = {
    createModule,
  };
})();
