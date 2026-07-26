const folderIcon = (open: boolean): string =>
  open
    ? `<svg viewBox="0 0 16 16" fill="#dcb67a" width="16" height="16"><path d="M14 4h-5l-1-1H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1z"/></svg>`
    : `<svg viewBox="0 0 16 16" fill="#dcb67a" width="16" height="16"><path d="M14 3H7L6 2H2a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1z"/></svg>`;

const defaultFileIcon = `<svg viewBox="0 0 16 16" fill="#9ca3af" width="16" height="16"><path d="M3 2h7l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/></svg>`;

const extensionIcons: Record<string, { color: string; letter: string }> = {
  rs: { color: "#dea584", letter: "R" },
  ts: { color: "#3178c6", letter: "TS" },
  tsx: { color: "#3178c6", letter: "TSX" },
  js: { color: "#f7df1e", letter: "JS" },
  jsx: { color: "#61dafb", letter: "JSX" },
  json: { color: "#f7df1e", letter: "{}" },
  html: { color: "#e44d26", letter: "H" },
  css: { color: "#264de4", letter: "C" },
  scss: { color: "#cd6799", letter: "S" },
  md: { color: "#ffffff", letter: "M" },
  py: { color: "#3776ab", letter: "Py" },
  c: { color: "#555555", letter: "C" },
  cpp: { color: "#f34b7d", letter: "C++" },
  h: { color: "#a8b9cc", letter: "H" },
  go: { color: "#00add8", letter: "Go" },
  toml: { color: "#9ca3af", letter: "T" },
  yaml: { color: "#cb4b16", letter: "Y" },
  yml: { color: "#cb4b16", letter: "Y" },
  lock: { color: "#9ca3af", letter: "L" },
};

function fileSvg(color: string, letter: string): string {
  return `<svg viewBox="0 0 16 16" width="16" height="16">
    <path d="M3 2h7l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" fill="${color}"/>
    <text x="8" y="11" text-anchor="middle" fill="#1b1b1f" font-size="5" font-weight="bold" font-family="sans-serif">${letter}</text>
  </svg>`;
}

export function getFileIcon(
  name: string,
  isDir: boolean,
  isOpen: boolean
): string {
  if (isDir) return folderIcon(isOpen);
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const config = extensionIcons[ext];
  return config ? fileSvg(config.color, config.letter) : defaultFileIcon;
}
