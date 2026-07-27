document.addEventListener("DOMContentLoaded", () => {
  const gallery = document.querySelector(".screenshot-gallery");
  if (gallery) {
    const tabs = gallery.querySelectorAll("[data-screenshot-tab]");
    const panes = gallery.querySelectorAll("[data-screenshot-pane]");

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const target = tab.dataset.screenshotTab;

        tabs.forEach((t) => {
          t.classList.remove("is-active");
          t.setAttribute("aria-selected", "false");
        });
        tab.classList.add("is-active");
        tab.setAttribute("aria-selected", "true");

        panes.forEach((pane) => {
          pane.classList.toggle("is-active", pane.dataset.screenshotPane === target);
        });
      });
    });
  }

  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener("click", (event) => {
      const href = anchor.getAttribute("href");
      if (href === "#") return;
      const target = document.querySelector(href);
      if (target) {
        event.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
});
