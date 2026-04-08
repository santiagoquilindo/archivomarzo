const BASE_URL = window.APP_CONFIG?.BASE_URL || window.location.origin;
const form = document.getElementById("loginForm");
const messageArea = document.getElementById("message");

if (form && form.dataset.boundSubmit !== "true") {
  form.dataset.boundSubmit = "true";

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    messageArea.textContent = "";

    const username = form.username.value.trim();
    const password = form.password.value.trim();

    if (!username || !password) {
      messageArea.textContent = "Por favor completa usuario y contraseña.";
      return;
    }

    try {
      const response = await fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        messageArea.textContent = data.message || "Credenciales incorrectas.";
        return;
      }

      const profile = await fetch(`${BASE_URL}/api/protected/me`, {
        method: "GET",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });

      if (profile.status === 200) {
        const profileData = await profile.json();
        if (profileData.user?.role === "admin") {
          window.location.href = "admin.html";
        } else {
          window.location.href = "user.html";
        }
        return;
      }

      if (profile.status === 401) {
        messageArea.textContent =
          "Sesión no iniciada: por favor vuelve a iniciar sesión.";
        return;
      }

      messageArea.textContent =
        "No se pudo verificar la sesión después del login.";
    } catch (error) {
      console.error("Error login:", error);
      messageArea.textContent =
        "Error de conexión local. Asegura que la API está corriendo.";
    }
  });
}
