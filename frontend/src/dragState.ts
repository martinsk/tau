export type DragPayload =
  | { kind: "tab"; data: string }
  | { kind: "file"; data: string };

let currentDrag: DragPayload | null = null;

export function setDrag(payload: DragPayload) {
  currentDrag = payload;
}

export function clearDrag() {
  currentDrag = null;
}

export function getDrag(): DragPayload | null {
  return currentDrag;
}
