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

  document.querySelectorAll("[data-timezone-offset]").forEach((input) => {
    input.value = String(new Date().getTimezoneOffset());
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

  document.querySelectorAll("[data-table-filter]").forEach((input) => {
    const table = document.getElementById(input.dataset.tableFilter);
    if (!table) return;
    const rows = [...table.querySelectorAll("tbody tr[data-filter-value]")];
    const empty = table.querySelector("[data-filter-empty]");
    input.addEventListener("input", () => {
      const query = input.value.trim().toLocaleLowerCase();
      let visible = 0;
      rows.forEach((row) => {
        const matches = !query || row.dataset.filterValue.includes(query);
        row.hidden = !matches;
        if (matches) visible += 1;
      });
      if (empty) empty.hidden = visible !== 0;
    });
  });

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || event.defaultPrevented) return;
    const buttons = [...form.querySelectorAll('button[type="submit"], input[type="submit"]')];
    buttons.forEach((button) => {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
    });
    const reenable = () => {
      buttons.forEach((button) => {
        button.disabled = false;
        button.removeAttribute("aria-busy");
      });
    };
    window.addEventListener("pageshow", reenable, { once: true });
    window.setTimeout(reenable, 8000);
  });

  const commandSearch = document.querySelector("[data-command-search]");
  const commandCategory = document.querySelector("[data-command-category]");
  const commandReadiness = document.querySelector("[data-command-readiness]");
  const commandGrid = document.querySelector("[data-command-grid]");
  const commandEmpty = document.querySelector("[data-command-empty]");
  if (commandGrid) {
    const cards = [...commandGrid.querySelectorAll("[data-command-card]")];
    const filterCommands = () => {
      const query = commandSearch?.value.trim().toLocaleLowerCase() || "";
      const category = commandCategory?.value || "";
      const readiness = commandReadiness?.value || "";
      let visible = 0;
      cards.forEach((card) => {
        const matchesSearch = !query || card.dataset.searchValue.includes(query);
        const matchesCategory = !category || card.dataset.category === category;
        const matchesReadiness = !readiness || card.dataset.readiness === readiness;
        const show = matchesSearch && matchesCategory && matchesReadiness;
        card.hidden = !show;
        if (show) visible += 1;
      });
      if (commandEmpty) commandEmpty.hidden = visible !== 0;
    };
    commandSearch?.addEventListener("input", filterCommands);
    commandCategory?.addEventListener("change", filterCommands);
    commandReadiness?.addEventListener("change", filterCommands);
  }
})();
