export type DragPayload =
  | { kind: "tab"; data: string }
  | { kind: "file"; data: string };

export interface DragState {
  setDrag(payload: DragPayload): void;
  clearDrag(): void;
  getDrag(): DragPayload | null;
}

export function createDragState(): DragState {
  let currentDrag: DragPayload | null = null;

  return {
    setDrag(payload: DragPayload) {
      currentDrag = payload;
    },
    clearDrag() {
      currentDrag = null;
    },
    getDrag() {
      return currentDrag;
    },
  };
}

const defaultDragState = createDragState();

export function setDrag(payload: DragPayload) {
  defaultDragState.setDrag(payload);
}

export function clearDrag() {
  defaultDragState.clearDrag();
}

export function getDrag(): DragPayload | null {
  return defaultDragState.getDrag();
}
