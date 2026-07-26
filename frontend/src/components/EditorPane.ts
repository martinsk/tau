import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import type { TabInfo } from "./Tabs.js";
import {
  createPaneDropOverlay,
  hasDroppablePayload,
  type DropZone,
} from "./PaneDropOverlay.js";
import { setDrag, clearDrag } from "../dragState.js";

self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === "json") return new jsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new cssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
    if (label === "typescript" || label === "javascript") return new tsWorker();
    return new editorWorker();
  },
};

monaco.editor.defineTheme("tau-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#1b1b1f",
    "editor.foreground": "#d7d7d9",
    "editor.lineHighlightBackground": "#2c2c31",
    "editorCursor.foreground": "#c69c6d",
    "editor.selectionBackground": "#3a3a40",
    "editor.inactiveSelectionBackground": "#2c2c31",
    "editorLineNumber.foreground": "#6b6b73",
    "editorLineNumber.activeForeground": "#c69c6d",
  },
});

export interface EditorPaneAPI {
  element: HTMLElement;
  updateTabs: (tabs: TabInfo[], activePath: string | null) => void;
  updateContent: (name: string | null, content: string) => void;
  getContent: () => string;
  focus: () => void;
}

export interface EditorPaneCallbacks {
  paneId: string;
  onTabClick: (path: string) => void;
  onTabClose: (path: string) => void;
  onContentChange: (content: string) => void;
  onSave: () => void;
  onFocus: () => void;
  onTabDrop: (data: string) => void;
  onSplitRequest: (direction: DropZone, data?: string) => void;
  onFileDrop: (path: string, name: string, zone: DropZone) => void;
}

export function createEditorPane(callbacks: EditorPaneCallbacks): EditorPaneAPI {
  const { paneId, onTabClick, onTabClose, onContentChange, onSave, onFocus, onTabDrop, onSplitRequest, onFileDrop } = callbacks;
  const container = document.createElement("div");
  container.className = "relative flex flex-col flex-1 min-w-0 min-h-0 bg-tau-bg";

  const overlay = createPaneDropOverlay((zone, payload) => {
    if (payload?.kind === "file") {
      const { path, name } = JSON.parse(payload.data) as {
        path: string;
        name: string;
      };
      onFileDrop(path, name, zone);
      return;
    }
    if (zone === "center") {
      if (payload?.kind === "tab") onTabDrop(payload.data);
      return;
    }
    if (payload?.kind === "tab") {
      onSplitRequest(zone, payload.data);
    }
  });
  container.appendChild(overlay.element);

  container.addEventListener(
    "dragenter",
    (e) => {
      if (hasDroppablePayload(e.dataTransfer)) {
        overlay.element.classList.remove("hidden");
      }
    },
    { capture: true }
  );
  container.addEventListener(
    "dragover",
    (e) => {
      if (hasDroppablePayload(e.dataTransfer)) {
        e.preventDefault();
        overlay.element.classList.remove("hidden");
      }
    },
    { capture: true }
  );
  container.addEventListener(
    "dragleave",
    (e) => {
      if (
        hasDroppablePayload(e.dataTransfer) &&
        !container.contains(e.relatedTarget as Node)
      ) {
        overlay.hide();
      }
    },
    { capture: true }
  );
  container.addEventListener(
    "drop",
    () => {
      overlay.hide();
    },
    { capture: true }
  );
  container.tabIndex = 0;

  const tabsEl = document.createElement("div");
  tabsEl.className =
    "h-9 bg-tau-panel border-b border-tau-border flex items-center px-2 gap-1 select-none overflow-hidden relative z-10";

  const editorEl = document.createElement("div");
  editorEl.className = "flex-1 min-h-0 bg-tau-bg relative";

  const placeholder = document.createElement("div");
  placeholder.className =
    "absolute inset-0 flex flex-col items-center justify-center text-tau-muted text-sm pointer-events-none";
  placeholder.innerHTML =
    '<span class="text-tau-accent mb-1">+</span><span>Drag a file here or open a folder</span>';
  placeholder.style.display = "none";
  editorEl.appendChild(placeholder);

  container.appendChild(tabsEl);
  container.appendChild(editorEl);

  const editor = monaco.editor.create(editorEl, {
    value: "",
    language: "plaintext",
    theme: "tau-dark",
    automaticLayout: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    renderValidationDecorations: "off",
  });

  setTimeout(() => {
    const languages = [
      "rust",
      "typescript",
      "javascript",
      "json",
      "html",
      "css",
      "markdown",
      "python",
      "ini",
    ];
    for (const language of languages) {
      try {
        monaco.editor.createModel("", language).dispose();
      } catch {}
    }
  }, 0);

  let isSettingValue = false;
  let activePath: string | null = null;

  editor.onDidChangeModelContent(() => {
    if (isSettingValue) return;
    onContentChange(editor.getValue());
  });

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    onSave();
  });

  function updateTabs(tabs: TabInfo[], active: string | null) {
    activePath = active;
    tabsEl.innerHTML = "";
    for (const tab of tabs) {
      const isActive = tab.path === active;
      const el = document.createElement("div");
      el.className = `px-3 py-1 text-xs cursor-default flex items-center gap-2 border-t max-w-[200px] ${
        isActive
          ? "bg-tau-active border-tau-accent"
          : "border-transparent hover:bg-tau-active-hover"
      }`;
      el.title = tab.path;
      el.textContent = `${tab.dirty ? "• " : ""}${tab.name}`;
      el.addEventListener("click", () => onTabClick(tab.path));
      el.draggable = true;
      el.addEventListener("dragstart", (e) => {
        const data = JSON.stringify({ ...tab, paneId });
        setDrag({ kind: "tab", data });
        e.dataTransfer?.setData("application/tau-tab", data);
      });
      el.addEventListener("dragend", () => clearDrag());

      const close = document.createElement("span");
      close.textContent = "×";
      close.className = "ml-2 hover:text-tau-accent shrink-0";
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        onTabClose(tab.path);
      });
      el.appendChild(close);
      tabsEl.appendChild(el);
    }
  }

  function updateContent(name: string | null, content: string) {
    if (!name) {
      placeholder.style.display = "flex";
      editor.getContainerDomNode().style.visibility = "hidden";
      isSettingValue = true;
      editor.setValue("");
      isSettingValue = false;
      return;
    }
    placeholder.style.display = "none";
    editor.getContainerDomNode().style.visibility = "visible";
    isSettingValue = true;
    const language = languageForFile(name);
    const uri = activePath ? monaco.Uri.file(activePath) : undefined;
    let model: monaco.editor.ITextModel | null = null;
    if (uri) {
      model = monaco.editor.getModel(uri);
    }
    if (!model) {
      model = monaco.editor.createModel(content, language, uri);
    } else {
      model.setValue(content);
    }
    const oldModel = editor.getModel();
    if (oldModel !== model) {
      editor.setModel(model);
      if (oldModel) oldModel.dispose();
    }
    isSettingValue = false;
  }

  function getContent() {
    return editor.getValue();
  }

  function focus() {
    container.focus();
    onFocus();
  }

  container.addEventListener("focus", onFocus);
  container.addEventListener("mousedown", onFocus);

  return { element: container, updateTabs, updateContent, getContent, focus };
}

function languageForFile(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "rs":
      return "rust";
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
      return "javascript";
    case "json":
      return "json";
    case "html":
      return "html";
    case "css":
      return "css";
    case "md":
    case "markdown":
      return "markdown";
    case "py":
      return "python";
    case "toml":
      return "ini";
    default:
      return "plaintext";
  }
}
