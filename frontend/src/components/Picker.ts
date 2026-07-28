export interface PickerItem<T> {
  label: string;
  description?: string;
  value: T;
}

function score(query: string, text: string): number | null {
  const q = query.toLowerCase();
  const candidate = text.toLowerCase();
  if (!q) return 0;
  const direct = candidate.indexOf(q);
  if (direct >= 0) return direct;
  let cursor = 0;
  let total = 0;
  for (const char of q) {
    const index = candidate.indexOf(char, cursor);
    if (index < 0) return null;
    total += index - cursor;
    cursor = index + 1;
  }
  return total + 100;
}

export function pickItem<T>(
  title: string,
  items: PickerItem<T>[],
  placeholder = "Type to filter…"
): Promise<T | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className =
      "fixed inset-0 z-[200] flex items-start justify-center bg-black/50 pt-24";
    const panel = document.createElement("div");
    panel.className =
      "w-full max-w-xl mx-4 overflow-hidden rounded-md border border-tau-border bg-tau-panel shadow-2xl";
    const heading = document.createElement("div");
    heading.className = "px-3 pt-3 text-xs font-semibold uppercase tracking-wide text-tau-muted";
    heading.textContent = title;
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = placeholder;
    input.className =
      "w-full border-b border-tau-border bg-tau-panel px-3 py-2 text-sm text-tau-fg outline-none";
    const list = document.createElement("div");
    list.className = "max-h-96 overflow-y-auto py-1";
    panel.append(heading, input, list);
    overlay.appendChild(panel);

    let filtered = items;
    let selected = 0;
    let settled = false;

    const finish = (value: T | null) => {
      if (settled) return;
      settled = true;
      overlay.remove();
      resolve(value);
    };

    const render = () => {
      list.innerHTML = "";
      if (!filtered.length) {
        const empty = document.createElement("div");
        empty.className = "px-3 py-3 text-sm text-tau-muted";
        empty.textContent = "No matching items";
        list.appendChild(empty);
        return;
      }
      filtered.forEach((item, index) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = `flex w-full flex-col px-3 py-1.5 text-left text-sm ${
          index === selected ? "bg-tau-active" : "hover:bg-tau-active-hover"
        }`;
        const label = document.createElement("span");
        label.className = "text-tau-fg";
        label.textContent = item.label;
        row.appendChild(label);
        if (item.description) {
          const description = document.createElement("span");
          description.className = "truncate text-xs text-tau-muted";
          description.textContent = item.description;
          row.appendChild(description);
        }
        row.addEventListener("mousedown", (event) => {
          event.preventDefault();
          finish(item.value);
        });
        list.appendChild(row);
      });
    };

    input.addEventListener("input", () => {
      const query = input.value.trim();
      filtered = items
        .map((item) => ({ item, score: score(query, `${item.label} ${item.description ?? ""}`) }))
        .filter((entry): entry is { item: PickerItem<T>; score: number } => entry.score !== null)
        .sort((a, b) => a.score - b.score)
        .map((entry) => entry.item);
      selected = 0;
      render();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") finish(null);
      if (event.key === "ArrowDown" && filtered.length) {
        event.preventDefault();
        selected = (selected + 1) % filtered.length;
        render();
      }
      if (event.key === "ArrowUp" && filtered.length) {
        event.preventDefault();
        selected = (selected - 1 + filtered.length) % filtered.length;
        render();
      }
      if (event.key === "Enter" && filtered[selected]) finish(filtered[selected].value);
    });
    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) finish(null);
    });
    panel.addEventListener("mousedown", (event) => event.stopPropagation());

    document.body.appendChild(overlay);
    render();
    input.focus();
  });
}
