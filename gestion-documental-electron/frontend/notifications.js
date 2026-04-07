(() => {
  class AppNotifier {
    constructor() {
      this.container = document.createElement("div");
      this.container.className = "notification-stack";
      document.body.appendChild(this.container);
    }

    show(message, type = "info", duration = 3500) {
      if (!message) {
        return;
      }

      const notification = document.createElement("div");
      notification.className = `app-notification is-${type}`;
      notification.textContent = message;
      this.container.appendChild(notification);

      window.requestAnimationFrame(() => {
        notification.classList.add("is-visible");
      });

      const closeNotification = () => {
        notification.classList.remove("is-visible");
        window.setTimeout(() => notification.remove(), 180);
      };

      window.setTimeout(closeNotification, duration);
      notification.addEventListener("click", closeNotification);
    }

    success(message, duration) {
      this.show(message, "success", duration);
    }

    error(message, duration) {
      this.show(message, "error", duration);
    }

    info(message, duration) {
      this.show(message, "info", duration);
    }
  }

  window.appNotifier = new AppNotifier();
})();
