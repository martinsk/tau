# Tau

An editor that feels like home. Tau is a fast, minimal desktop code editor built with Rust and Tauri — made to bring the fun back into writing code.

- Explore your project in a clean sidebar
- Arrange files in tabs and split panes
- Edit with syntax highlighting, diagnostics, and LSP support
- Run commands in an integrated terminal
- Stage, commit, and review diffs with built-in git support
- Pair with Claude Code in a dedicated agent panel

## Build from source

Requires [Rust](https://rustup.rs) and [Node.js](https://nodejs.org).

```bash
npm install --prefix frontend
npm run build   # produces the macOS .app bundle
npm run dev     # runs the Tauri dev server
```

Open a folder via **File → Open Folder** (or `Cmd+Shift+O`).
