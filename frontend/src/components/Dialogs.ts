export interface DialogButton<T> {
  label: string;
  value: T;
  primary?: boolean;
  danger?: boolean;
}

function createOverlay(title: string, message?: string): {
  overlay: HTMLDivElement;
  panel: HTMLDivElement;
  body: HTMLDivElement;
  actions: HTMLDivElement;
} {
  const overlay = document.createElement("div");
  overlay.className =
    "fixed inset-0 z-[200] flex items-start justify-center bg-black/50 pt-32";

  const panel = document.createElement("div");
  panel.className =
    "w-full max-w-md mx-4 rounded-md border border-tau-border bg-tau-panel shadow-2xl";

  const heading = document.createElement("div");
  heading.className = "px-4 pt-4 text-sm font-semibold text-tau-fg";
  heading.textContent = title;

  const body = document.createElement("div");
  body.className = "px-4 py-3 text-sm text-tau-muted";
  if (message) body.textContent = message;

  const actions = document.createElement("div");
  actions.className = "flex justify-end gap-2 px-4 pb-4";

  panel.append(heading, body, actions);
  overlay.appendChild(panel);
  return { overlay, panel, body, actions };
}

export function chooseDialog<T>(
  title: string,
  message: string,
  buttons: DialogButton<T>[],
  cancelValue: T
): Promise<T> {
  return new Promise((resolve) => {
    const { overlay, panel, actions } = createOverlay(title, message);
    let settled = false;

    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      overlay.remove();
      resolve(value);
    };

    for (const option of buttons) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = option.label;
      button.className = option.primary
        ? "rounded bg-tau-accent px-3 py-1.5 text-xs font-medium text-tau-bg hover:bg-tau-accent-hover"
        : option.danger
          ? "rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500"
          : "rounded border border-tau-border px-3 py-1.5 text-xs text-tau-fg hover:bg-tau-active-hover";
      button.addEventListener("click", () => finish(option.value));
      actions.appendChild(button);
    }

    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) finish(cancelValue);
    });
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") finish(cancelValue);
    });
    panel.addEventListener("mousedown", (event) => event.stopPropagation());
    document.body.appendChild(overlay);
    overlay.tabIndex = -1;
    overlay.focus();
    (actions.querySelector("button") as HTMLButtonElement | null)?.focus();
  });
}

export function inputDialog(
  title: string,
  options: {
    message?: string;
    value?: string;
    placeholder?: string;
    confirmLabel?: string;
    validate?: (value: string) => string | null;
  } = {}
): Promise<string | null> {
  return new Promise((resolve) => {
    const { overlay, panel, body, actions } = createOverlay(title, options.message);
    let settled = false;

    const input = document.createElement("input");
    input.type = "text";
    input.value = options.value ?? "";
    input.placeholder = options.placeholder ?? "";
    input.className =
      "w-full rounded border border-tau-border bg-tau-bg px-2 py-1.5 text-sm text-tau-fg outline-none focus:border-tau-accent";

    const error = document.createElement("div");
    error.className = "mt-2 min-h-4 text-xs text-red-400";
    body.textContent = options.message ?? "";
    body.append(input, error);

    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      overlay.remove();
      resolve(value);
    };

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.className =
      "rounded border border-tau-border px-3 py-1.5 text-xs text-tau-fg hover:bg-tau-active-hover";
    cancel.addEventListener("click", () => finish(null));

    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.textContent = options.confirmLabel ?? "OK";
    confirm.className =
      "rounded bg-tau-accent px-3 py-1.5 text-xs font-medium text-tau-bg hover:bg-tau-accent-hover";

    const submit = () => {
      const value = input.value.trim();
      const validation = options.validate?.(value) ?? (value ? null : "A value is required.");
      if (validation) {
        error.textContent = validation;
        return;
      }
      finish(value);
    };

    confirm.addEventListener("click", submit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") submit();
      if (event.key === "Escape") finish(null);
    });
    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) finish(null);
    });
    panel.addEventListener("mousedown", (event) => event.stopPropagation());

    actions.append(cancel, confirm);
    document.body.appendChild(overlay);
    input.focus();
    input.select();
  });
}
