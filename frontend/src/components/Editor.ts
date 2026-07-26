import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === "json") {
      return new jsonWorker();
    }
    if (label === "css" || label === "scss" || label === "less") {
      return new cssWorker();
    }
    if (label === "html" || label === "handlebars" || label === "razor") {
      return new htmlWorker();
    }
    if (label === "typescript" || label === "javascript") {
      return new tsWorker();
    }
    return new editorWorker();
  },
};

// Custom theme that matches the tau palette.
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

export interface EditorAPI {
  element: HTMLElement;
  updateContent: (content: string, language?: string) => void;
  getContent: () => string;
}

/**
 * Build the main editor pane using Monaco.
 */
export function createEditor(
  onContentChange: (content: string) => void,
  onSave: () => void
): EditorAPI {
  const container = document.createElement("div");
  container.className = "flex-1 min-h-0 bg-tau-bg";

  const editor = monaco.editor.create(container, {
    value: "",
    language: "plaintext",
    theme: "tau-dark",
    automaticLayout: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    renderValidationDecorations: "off",
  });

  // Pre-warm common language tokenizers in the background so the first file
  // open for each language is close to instant.
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
      } catch {
        // ignore unsupported languages
      }
    }
  }, 0);

  let isSettingValue = false;

  editor.onDidChangeModelContent(() => {
    if (isSettingValue) return;
    onContentChange(editor.getValue());
  });

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    onSave();
  });

  function updateContent(content: string, language: string = "plaintext") {
    isSettingValue = true;
    const oldModel = editor.getModel();
    const model = monaco.editor.createModel(content, language);
    editor.setModel(model);
    if (oldModel) {
      oldModel.dispose();
    }
    isSettingValue = false;
  }

  function getContent() {
    return editor.getValue();
  }

  return { element: container, updateContent, getContent };
}
