(() => {
  const body = document.body;
  const menuButton = document.querySelector("[data-sidebar-toggle]");
  const closeButtons = document.querySelectorAll("[data-sidebar-close]");

  const closeMenu = () => {
    body.classList.remove("nav-open");
    menuButton?.setAttribute("aria-expanded", "false");
  };

  menuButton?.addEventListener("click", () => {
    const open = body.classList.toggle("nav-open");
    menuButton.setAttribute("aria-expanded", String(open));
  });
  closeButtons.forEach((button) => button.addEventListener("click", closeMenu));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });

  document.querySelectorAll("[data-dismiss]").forEach((button) => {
    button.addEventListener("click", () => button.closest("[data-dismissible]")?.remove());
  });

  document.querySelectorAll("[data-confirm]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      if (!window.confirm(form.dataset.confirm)) event.preventDefault();
    });
  });

  document.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy || "");
        const previous = button.textContent;
        button.textContent = button.dataset.copied || "Copied";
        window.setTimeout(() => {
          button.textContent = previous;
        }, 1600);
      } catch {
        // Clipboard can be unavailable on non-HTTPS development hosts.
      }
    });
  });

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || event.defaultPrevented) return;
    form.querySelectorAll('button[type="submit"], input[type="submit"]').forEach((button) => {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
    });
  });
})();
