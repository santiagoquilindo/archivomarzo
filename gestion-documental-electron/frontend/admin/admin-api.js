(() => {
  const API_BASE = window.APP_CONFIG?.BASE_URL || window.location.origin;

  async function request(path, options = {}) {
    const { headers = {}, ...rest } = options;
    const response = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      headers,
      ...rest,
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

  function getMe() {
    return request("/api/protected/me");
  }

  function logout() {
    return request("/api/auth/logout", { method: "POST" });
  }

  function listRootFolders() {
    return request("/api/root-folders");
  }

  function createRootFolder(payload) {
    return request("/api/root-folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  function updateRootFolderStatus(id, isActive) {
    return request(`/api/root-folders/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive }),
    });
  }

  function deleteRootFolder(id) {
    return request(`/api/root-folders/${id}`, {
      method: "DELETE",
    });
  }

  function runIndexing() {
    return request("/api/indexing/run", {
      method: "POST",
    });
  }

  function getIndexingRuns() {
    return request("/api/indexing/runs");
  }

  function clearIndex() {
    return request("/api/indexing/clear", {
      method: "POST",
    });
  }

  function searchDocuments(filters) {
    const query = window.documentUi.buildDocumentQuery(filters);
    const path = query ? `/api/documents?${query}` : "/api/documents";
    return request(path);
  }

  function getDocument(id) {
    return request(`/api/documents/${id}`);
  }

  function createDocument(payload) {
    return request("/api/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  function updateDocument(id, payload) {
    return request(`/api/documents/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  function openDocument(id) {
    return request(`/api/documents/${id}/open`, {
      method: "POST",
    });
  }

  window.adminApi = {
    getMe,
    logout,
    listRootFolders,
    createRootFolder,
    updateRootFolderStatus,
    deleteRootFolder,
    runIndexing,
    getIndexingRuns,
    clearIndex,
    searchDocuments,
    getDocument,
    createDocument,
    updateDocument,
    openDocument,
  };
})();
