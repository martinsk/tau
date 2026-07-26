export interface ResizerAPI {
  element: HTMLElement;
}

export interface ResizerOptions {
  direction: "row" | "column";
  onChange: (delta: number) => void;
}

export function createResizer(options: ResizerOptions): ResizerAPI {
  const { direction, onChange } = options;
  const resizer = document.createElement("div");
  resizer.className =
    direction === "row"
      ? "w-1 bg-tau-border hover:bg-tau-accent cursor-col-resize shrink-0"
      : "h-1 bg-tau-border hover:bg-tau-accent cursor-row-resize shrink-0";

  let start = 0;
  let isDragging = false;

  resizer.addEventListener("mousedown", (e) => {
    e.preventDefault();
    isDragging = true;
    start = direction === "row" ? e.clientX : e.clientY;
    document.body.style.cursor =
      direction === "row" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    const current = direction === "row" ? e.clientX : e.clientY;
    onChange(current - start);
    start = current;
  });

  document.addEventListener("mouseup", () => {
    if (!isDragging) return;
    isDragging = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });

  return { element: resizer };
}
