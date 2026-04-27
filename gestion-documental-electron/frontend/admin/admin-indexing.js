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
          throw new Error("No se pudo consultar el estado de indexacion");
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
          setIndexStatus("inactive", "finalizada");
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
          throw new Error(data.message || "No se pudo iniciar la indexacion");
        }

        startIndexStatusPolling();
        notify(
          "La indexacion se inicio correctamente en segundo plano. Solo se procesaran carpetas activas.",
          "success",
          { duration: 5000 },
        );
      } catch (error) {
        console.error("Error starting indexing:", error);
        setIndexStatus("unavailable", error.message);
        notify(error.message || "No se pudo iniciar la indexacion.", "error", {
          duration: 7000,
        });
      }
    }

    async function handleClearIndex() {
      const confirmed = window.confirm(
        "Vas a limpiar el indice completo.\n\nEsto eliminara todos los documentos indexados y su historial tecnico actual. Las carpetas raiz se conservaran, pero deberas ejecutar una nueva indexacion para volver a buscar documentos.\n\n¿Deseas continuar?"
      );

      if (!confirmed) {
        return;
      }

      try {
        const { response, data } = await api.clearIndex();
        if (!response.ok) {
          throw new Error(data.message || "No se pudo limpiar el indice");
        }

        stopIndexStatusPolling();
        setIndexStatus("inactive");
        notify(
          `Indice limpiado. Documentos eliminados: ${data.deletedDocuments || 0}. Ejecuta una nueva indexacion para reconstruir la busqueda.`,
          "success",
          { duration: 6000 },
        );
      } catch (error) {
        console.error("Error clearing index:", error);
        notify(error.message || "No se pudo limpiar el indice.", "error", {
          duration: 7000,
        });
      }
    }

    function init() {
      bindClick(document.getElementById("indexBtn"), handleIndexingRun);
      bindClick(document.getElementById("clearIndexBtn"), handleClearIndex);
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
