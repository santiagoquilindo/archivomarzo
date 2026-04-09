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

  function searchDocuments(filters) {
    const query = window.documentUi.buildDocumentQuery(filters);
    const path = query ? `/api/documents?${query}` : "/api/documents";
    return request(path);
  }

  function getDocument(id) {
    return request(`/api/documents/${id}`);
  }

  function openDocument(id) {
    return request(`/api/documents/${id}/open`, {
      method: "POST",
    });
  }

  function getDocumentHistory(id) {
    return request(`/api/documents/${id}/history`);
  }

  window.userApi = {
    getMe,
    logout,
    searchDocuments,
    getDocument,
    openDocument,
    getDocumentHistory,
  };
})();
