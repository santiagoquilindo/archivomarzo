(() => {
  class AppNotifier {
    constructor() {
      this.container = document.createElement("div");
      this.container.className = "notification-stack";
      document.body.appendChild(this.container);
    }

    normalizeOptions(typeOrOptions, duration) {
      if (typeof typeOrOptions === "object" && typeOrOptions !== null) {
        return {
          type: typeOrOptions.type || "info",
          duration:
            typeOrOptions.duration === undefined ? 3500 : typeOrOptions.duration,
          closable: typeOrOptions.closable !== false,
        };
      }

      return {
        type: typeOrOptions || "info",
        duration: duration === undefined ? 3500 : duration,
        closable: true,
      };
    }

    getIconLabel(type) {
      return {
        success: "OK",
        error: "!",
        info: "i",
      }[type] || "i";
    }

    show(message, typeOrOptions = "info", duration) {
      if (!message) {
        return;
      }

      const options = this.normalizeOptions(typeOrOptions, duration);
      const notification = document.createElement("div");
      notification.className = `app-notification is-${options.type}`;
      notification.innerHTML = `
        <div class="app-notification-body">
          <span class="app-notification-icon"></span>
          <div class="app-notification-content"></div>
        </div>
      `;

      notification.querySelector(".app-notification-icon").textContent =
        this.getIconLabel(options.type);
      notification.querySelector(".app-notification-content").textContent =
        message;

      let closeTimeoutId = null;

      const closeNotification = () => {
        notification.classList.remove("is-visible");
        if (closeTimeoutId) {
          window.clearTimeout(closeTimeoutId);
        }
        window.setTimeout(() => notification.remove(), 180);
      };

      if (options.closable) {
        const closeButton = document.createElement("button");
        closeButton.type = "button";
        closeButton.className = "app-notification-close";
        closeButton.setAttribute("aria-label", "Cerrar notificación");
        closeButton.textContent = "×";
        closeButton.addEventListener("click", (event) => {
          event.stopPropagation();
          closeNotification();
        });
        notification.appendChild(closeButton);
      }

      this.container.appendChild(notification);

      window.requestAnimationFrame(() => {
        notification.classList.add("is-visible");
      });

      if (options.duration > 0) {
        closeTimeoutId = window.setTimeout(closeNotification, options.duration);
      }

      notification.addEventListener("click", closeNotification);
    }

    success(message, options) {
      this.show(message, {
        type: "success",
        ...(typeof options === "object" ? options : { duration: options }),
      });
    }

    error(message, options) {
      this.show(message, {
        type: "error",
        ...(typeof options === "object" ? options : { duration: options }),
      });
    }

    info(message, options) {
      this.show(message, {
        type: "info",
        ...(typeof options === "object" ? options : { duration: options }),
      });
    }
  }

  window.appNotifier = new AppNotifier();
})();
