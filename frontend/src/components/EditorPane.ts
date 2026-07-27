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
import { getFileIcon } from "../fileIcons.js";

const closeIcon = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>`;

self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === "json") return new jsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new cssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
    if (label === "typescript" || label === "javascript") return new tsWorker();
    return new editorWorker();
  },
};

let languagesWarmed = false;
function warmLanguagesOnce() {
  if (languagesWarmed) return;
  languagesWarmed = true;
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
}

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
  updateContent: (tab: TabInfo | null) => void;
  getContent: () => string;
  focus: () => void;
  revealPosition: (
    line: number,
    column: number,
    endLine?: number,
    endColumn?: number
  ) => void;
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
    "h-9 bg-tau-panel border-b border-tau-border flex items-stretch px-2 gap-1 select-none overflow-x-auto overflow-y-hidden relative z-10 tab-scroll";

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
    renderValidationDecorations: "on",
  });

  const diffEditorEl = document.createElement("div");
  diffEditorEl.className = "absolute inset-0";
  diffEditorEl.style.visibility = "hidden";
  editorEl.appendChild(diffEditorEl);

  // The diff editor is expensive to construct, so it's only created lazily
  // the first time a diff tab is actually opened (see `ensureDiffEditor`).
  let diffEditor: monaco.editor.IStandaloneDiffEditor | null = null;

  function ensureDiffEditor(): monaco.editor.IStandaloneDiffEditor {
    if (diffEditor) return diffEditor;
    diffEditor = monaco.editor.createDiffEditor(diffEditorEl, {
      theme: "tau-dark",
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderValidationDecorations: "on",
      originalEditable: false,
    });
    diffEditor.getModifiedEditor().onDidChangeModelContent(() => {
      if (isSettingValue) return;
      onContentChange(diffEditor!.getModifiedEditor().getValue());
    });
    diffEditor.getModifiedEditor().addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => {
        onSave();
      }
    );
    return diffEditor;
  }

  warmLanguagesOnce();

  let isSettingValue = false;
  let activePath: string | null = null;
  let activeIsDiff = false;
  let diffOriginalKey: string | null = null;
  let diffOriginalModel: monaco.editor.ITextModel | null = null;
  let diffModifiedKey: string | null = null;
  let diffModifiedModel: monaco.editor.ITextModel | null = null;

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
      el.className = `group flex-1 shrink basis-0 min-w-[100px] max-w-[220px] px-2 py-1 text-xs cursor-default flex items-center gap-1.5 border-t ${
        isActive
          ? "bg-tau-active border-tau-accent"
          : "border-transparent hover:bg-tau-active-hover"
      }`;
      el.title = tab.path;

      const icon = document.createElement("span");
      icon.className =
        "shrink-0 w-3.5 h-3.5 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full";
      icon.innerHTML = getFileIcon(tab.name, false, false);
      el.appendChild(icon);

      const diffSuffix = tab.diff ? (tab.diff.staged ? " (Staged)" : " (Working Tree)") : "";
      const name = document.createElement("span");
      name.className = "flex-1 min-w-0 truncate";
      name.textContent = `${tab.name}${diffSuffix}`;
      el.appendChild(name);

      el.addEventListener("click", () => onTabClick(tab.path));
      el.draggable = true;
      el.addEventListener("dragstart", (e) => {
        const data = JSON.stringify({ ...tab, paneId });
        setDrag({ kind: "tab", data });
        e.dataTransfer?.setData("application/tau-tab", data);
      });
      el.addEventListener("dragend", () => clearDrag());

      const closeSlot = document.createElement("span");
      closeSlot.className = "relative shrink-0 w-4 h-4 flex items-center justify-center";

      if (tab.dirty) {
        const dot = document.createElement("span");
        dot.className =
          "w-1.5 h-1.5 rounded-full bg-tau-fg group-hover:hidden" +
          (isActive ? " hidden" : "");
        closeSlot.appendChild(dot);
      }

      const close = document.createElement("button");
      close.type = "button";
      close.innerHTML = closeIcon;
      close.title = "Close";
      close.className = `w-4 h-4 items-center justify-center rounded-sm border-0 bg-transparent p-0 text-tau-muted hover:bg-tau-active-hover hover:text-tau-fg [&>svg]:w-3 [&>svg]:h-3 ${
        isActive ? "flex" : "hidden group-hover:flex"
      }`;
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        onTabClose(tab.path);
      });
      closeSlot.appendChild(close);

      el.appendChild(closeSlot);
      tabsEl.appendChild(el);
    }
  }

  function disposeDiffModels() {
    diffOriginalModel?.dispose();
    diffOriginalModel = null;
    diffOriginalKey = null;
    diffModifiedModel?.dispose();
    diffModifiedModel = null;
    diffModifiedKey = null;
  }

  function updateContent(tab: TabInfo | null) {
    if (!tab) {
      placeholder.style.display = "flex";
      editor.getContainerDomNode().style.visibility = "hidden";
      diffEditorEl.style.visibility = "hidden";
      disposeDiffModels();
      activeIsDiff = false;
      isSettingValue = true;
      editor.setValue("");
      isSettingValue = false;
      return;
    }

    placeholder.style.display = "none";
    const language = languageForFile(tab.name);

    if (tab.diff) {
      activeIsDiff = true;
      editor.getContainerDomNode().style.visibility = "hidden";
      diffEditorEl.style.visibility = "visible";

      const origKey = `${tab.path}::${tab.diff.staged}::original`;
      if (diffOriginalKey !== origKey) {
        diffOriginalModel?.dispose();
        diffOriginalModel = monaco.editor.createModel(tab.diff.original, language);
        diffOriginalKey = origKey;
      } else if (diffOriginalModel && diffOriginalModel.getValue() !== tab.diff.original) {
        isSettingValue = true;
        diffOriginalModel.setValue(tab.diff.original);
        isSettingValue = false;
      }

      let modifiedModel: monaco.editor.ITextModel;
      if (tab.diff.editable) {
        if (diffModifiedModel) {
          diffModifiedModel.dispose();
          diffModifiedModel = null;
          diffModifiedKey = null;
        }
        const uri = monaco.Uri.file(tab.path);
        modifiedModel = monaco.editor.getModel(uri) ?? monaco.editor.createModel(tab.content, language, uri);
        if (modifiedModel.getValue() !== tab.content) {
          isSettingValue = true;
          modifiedModel.setValue(tab.content);
          isSettingValue = false;
        }
      } else {
        const modKey = `${tab.path}::staged::modified`;
        if (diffModifiedKey !== modKey) {
          diffModifiedModel?.dispose();
          diffModifiedModel = monaco.editor.createModel(tab.content, language);
          diffModifiedKey = modKey;
        } else if (diffModifiedModel && diffModifiedModel.getValue() !== tab.content) {
          isSettingValue = true;
          diffModifiedModel.setValue(tab.content);
          isSettingValue = false;
        }
        modifiedModel = diffModifiedModel!;
      }

      const diff = ensureDiffEditor();
      const currentModel = diff.getModel();
      if (!currentModel || currentModel.original !== diffOriginalModel || currentModel.modified !== modifiedModel) {
        diff.setModel({ original: diffOriginalModel!, modified: modifiedModel });
      }
      diff.updateOptions({ readOnly: !tab.diff.editable });
      return;
    }

    activeIsDiff = false;
    disposeDiffModels();
    diffEditorEl.style.visibility = "hidden";
    editor.getContainerDomNode().style.visibility = "visible";
    isSettingValue = true;
    const uri = monaco.Uri.file(tab.path);
    let model: monaco.editor.ITextModel | null = monaco.editor.getModel(uri);
    if (!model) {
      model = monaco.editor.createModel(tab.content, language, uri);
    } else {
      model.setValue(tab.content);
    }
    const oldModel = editor.getModel();
    if (oldModel === model && oldModel.getValue() === tab.content) {
      isSettingValue = false;
      return;
    }
    if (oldModel !== model) {
      editor.setModel(model);
      if (oldModel) oldModel.dispose();
    }
    isSettingValue = false;
  }

  function getContent() {
    return activeIsDiff && diffEditor ? diffEditor.getModifiedEditor().getValue() : editor.getValue();
  }

  function focus() {
    container.focus();
    onFocus();
  }

  function revealPosition(
    line: number,
    column: number,
    endLine?: number,
    endColumn?: number
  ) {
    const target = activeIsDiff && diffEditor ? diffEditor.getModifiedEditor() : editor;
    if (endLine !== undefined && endColumn !== undefined) {
      const range = {
        startLineNumber: line,
        startColumn: column,
        endLineNumber: endLine,
        endColumn,
      };
      target.setSelection(range);
      target.revealRangeInCenter(range);
    } else {
      target.setPosition({ lineNumber: line, column });
      target.revealPositionInCenter({ lineNumber: line, column });
    }
    target.focus();
    onFocus();
  }

  container.addEventListener("focus", onFocus);
  container.addEventListener("mousedown", onFocus);

  return { element: container, updateTabs, updateContent, getContent, focus, revealPosition };
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
