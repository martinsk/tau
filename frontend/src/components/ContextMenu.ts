export interface ContextMenuItem {
  label: string;
  run: () => void;
  danger?: boolean;
  separatorBefore?: boolean;
}

export function showContextMenu(x: number, y: number, items: ContextMenuItem[]): void {
  document.querySelector("[data-tau-context-menu]")?.remove();
  const menu = document.createElement("div");
  menu.dataset.tauContextMenu = "true";
  menu.className =
    "fixed z-[250] min-w-48 rounded border border-tau-border bg-tau-panel py-1 text-sm shadow-2xl";
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const close = () => menu.remove();
  for (const item of items) {
    if (item.separatorBefore) {
      const separator = document.createElement("div");
      separator.className = "my-1 border-t border-tau-border";
      menu.appendChild(separator);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = `block w-full px-3 py-1.5 text-left hover:bg-tau-active-hover ${
      item.danger ? "text-red-400" : "text-tau-fg"
    }`;
    button.textContent = item.label;
    button.addEventListener("click", () => {
      close();
      item.run();
    });
    menu.appendChild(button);
  }

  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = `${Math.max(0, x - rect.width)}px`;
  if (rect.bottom > window.innerHeight) menu.style.top = `${Math.max(0, y - rect.height)}px`;

  const dismiss = (event: Event) => {
    if (!menu.contains(event.target as Node)) close();
  };
  setTimeout(() => {
    window.addEventListener("mousedown", dismiss, { once: true, capture: true });
    window.addEventListener("blur", close, { once: true });
  });
}
