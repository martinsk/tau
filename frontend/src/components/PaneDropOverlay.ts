import { type DragPayload, getDrag } from "../dragState.js";

export interface PaneDropOverlayAPI {
  element: HTMLElement;
  hide: () => void;
}

export type DropZone = "center" | "top" | "bottom" | "left" | "right";

export function createPaneDropOverlay(
  onDrop: (zone: DropZone, payload: DragPayload | null) => void
): PaneDropOverlayAPI {
  const overlay = document.createElement("div");
  overlay.className = "absolute inset-0 z-[100] hidden";

  function zoneClass(name: string, extra?: string): string {
    return `${name} absolute flex items-center justify-center bg-tau-accent/20 border border-tau-accent/40 opacity-0 transition-opacity duration-100 pointer-events-auto ${
      extra ?? ""
    }`;
  }

  function zoneLabel(text: string): HTMLElement {
    const span = document.createElement("span");
    span.textContent = text;
    span.className =
      "text-tau-fg text-xs font-medium uppercase tracking-wider pointer-events-none";
    return span;
  }

  const center = document.createElement("div");
  center.className = zoneClass("inset-[30%] rounded");
  center.appendChild(zoneLabel("Move"));

  const top = document.createElement("div");
  top.className = zoneClass("top-0 left-0 right-0 h-[20%]", "rounded-b");
  top.appendChild(zoneLabel("Split Top"));

  const bottom = document.createElement("div");
  bottom.className = zoneClass("bottom-0 left-0 right-0 h-[20%]", "rounded-t");
  bottom.appendChild(zoneLabel("Split Bottom"));

  const left = document.createElement("div");
  left.className = zoneClass("top-0 bottom-0 left-0 w-[20%]", "rounded-r");
  left.appendChild(zoneLabel("Split Left"));

  const right = document.createElement("div");
  right.className = zoneClass("top-0 bottom-0 right-0 w-[20%]", "rounded-l");
  right.appendChild(zoneLabel("Split Right"));

  const zones: { el: HTMLElement; zone: DropZone }[] = [
    { el: top, zone: "top" },
    { el: bottom, zone: "bottom" },
    { el: left, zone: "left" },
    { el: right, zone: "right" },
    { el: center, zone: "center" },
  ];

  for (const { el, zone } of zones) {
    el.addEventListener("dragenter", (e) => {
      e.preventDefault();
      el.classList.add("opacity-100");
    });
    el.addEventListener("dragover", (e) => {
      e.preventDefault();
    });
    el.addEventListener("dragleave", () => {
      el.classList.remove("opacity-100");
    });
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      el.classList.remove("opacity-100");
      const payload = extractPayload(e.dataTransfer) ?? getDrag();
      onDrop(zone, payload);
    });
    overlay.appendChild(el);
  }

  return { element: overlay, hide: () => overlay.classList.add("hidden") };
}

export function hasDroppablePayload(data: DataTransfer | null): boolean {
  if (getDrag()) return true;
  return (
    (data?.types.includes("application/tau-tab") ?? false) ||
    (data?.types.includes("application/tau-file") ?? false)
  );
}

function extractPayload(data: DataTransfer | null): DragPayload | null {
  const tab = data?.getData("application/tau-tab");
  if (tab) return { kind: "tab", data: tab };
  const file = data?.getData("application/tau-file");
  if (file) return { kind: "file", data: file };
  return null;
}
