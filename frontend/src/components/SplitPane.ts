export interface SplitPaneAPI {
  element: HTMLElement;
}

export function createSplitPane(
  direction: "row" | "column",
  children: HTMLElement[],
  sizes: number[]
): SplitPaneAPI {
  const container = document.createElement("div");
  container.className = `flex ${direction === "row" ? "flex-row" : "flex-col"} flex-1 min-w-0 min-h-0 overflow-hidden select-none`;

  const total = sizes.reduce((a, b) => a + b, 0) || 1;
  const wrappers: HTMLElement[] = [];

  for (let i = 0; i < children.length; i++) {
    const wrapper = document.createElement("div");
    wrapper.className = "flex flex-col min-w-0 min-h-0 overflow-hidden";
    wrapper.style.flex = "1 1 0%";
    wrapper.appendChild(children[i]);
    container.appendChild(wrapper);
    wrappers.push(wrapper);

    if (i < children.length - 1) {
      const divider = document.createElement("div");
      divider.className =
        direction === "row"
          ? "w-1 bg-tau-border hover:bg-tau-accent cursor-col-resize shrink-0"
          : "h-1 bg-tau-border hover:bg-tau-accent cursor-row-resize shrink-0";
      container.appendChild(divider);

      let isDragging = false;
      divider.addEventListener("mousedown", (e) => {
        e.preventDefault();
        isDragging = true;
        document.body.style.cursor =
          direction === "row" ? "col-resize" : "row-resize";
        document.body.style.userSelect = "none";
      });

      document.addEventListener("mousemove", (e) => {
        if (!isDragging) return;
        const rect = container.getBoundingClientRect();
        let ratio: number;
        if (direction === "row") {
          ratio = (e.clientX - rect.left) / rect.width;
        } else {
          ratio = (e.clientY - rect.top) / rect.height;
        }
        const clamped = Math.max(0.05, Math.min(0.95, ratio));
        applySizes(wrappers, clamped, i);
      });

      document.addEventListener("mouseup", () => {
        if (!isDragging) return;
        isDragging = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      });
    }
  }

  function applySizes(
    elements: HTMLElement[],
    ratio: number,
    dividerIndex: number
  ) {
    for (let j = 0; j < elements.length; j++) {
      elements[j].style.flex = "0 0 auto";
      if (direction === "row") {
        elements[j].style.width =
          j <= dividerIndex ? `${ratio * 100}%` : `${(1 - ratio) * 100}%`;
        elements[j].style.height = "";
      } else {
        elements[j].style.height =
          j <= dividerIndex ? `${ratio * 100}%` : `${(1 - ratio) * 100}%`;
        elements[j].style.width = "";
      }
    }
  }

  return { element: container };
}
