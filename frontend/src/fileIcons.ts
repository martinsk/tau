const folderIcon = (open: boolean): string =>
  open
    ? `<svg viewBox="0 0 16 16">
        <path d="M14 3H7L6 2H2a1 1 0 0 0-1 1v9.3l1.62-6.1A1 1 0 0 1 3.58 5.5H14z" fill="#c9a35f"/>
        <path d="M3.58 6.5H14.5a1 1 0 0 1 .97 1.24l-1.2 4.8a1 1 0 0 1-.97.76H2.4a1 1 0 0 1-.97-1.24l1.2-4.8a1 1 0 0 1 .95-.76z" fill="#f0c37c"/>
      </svg>`
    : `<svg viewBox="0 0 16 16" fill="#dcb67a"><path d="M14 3H7L6 2H2a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1z"/></svg>`;

const defaultFileIcon = `<svg viewBox="0 0 16 16" fill="#9ca3af"><path d="M3 2h7l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/></svg>`;

const markdownIcon = `<svg viewBox="0 0 16 16">
  <rect x="1" y="3.5" width="14" height="9" rx="1.4" fill="none" stroke="#e0e0e0" stroke-width="1.3"/>
  <text x="8" y="11.2" text-anchor="middle" fill="#e0e0e0" font-size="7.6" font-weight="bold" font-family="sans-serif">M↓</text>
</svg>`;

const cIcon = `<svg viewBox="0 0 16 16">
  <circle cx="8" cy="8" r="6.4" fill="none" stroke="#5c9fd6" stroke-width="1.6"/>
  <text x="8" y="11.3" text-anchor="middle" fill="#5c9fd6" font-size="9" font-weight="bold" font-family="serif">C</text>
</svg>`;

const specialIcons: Record<string, string> = {
  md: markdownIcon,
  c: cIcon,
};

const extensionIcons: Record<string, { color: string; letter: string }> = {
  rs: { color: "#dea584", letter: "RS" },
  ts: { color: "#3178c6", letter: "TS" },
  tsx: { color: "#3178c6", letter: "TSX" },
  js: { color: "#f7df1e", letter: "JS" },
  jsx: { color: "#61dafb", letter: "JSX" },
  json: { color: "#f7df1e", letter: "{}" },
  html: { color: "#e44d26", letter: "H" },
  css: { color: "#264de4", letter: "#" },
  scss: { color: "#cd6799", letter: "S" },
  py: { color: "#3776ab", letter: "Py" },
  cpp: { color: "#f34b7d", letter: "C++" },
  h: { color: "#a8b9cc", letter: "H" },
  go: { color: "#00add8", letter: "Go" },
  toml: { color: "#9ca3af", letter: "T" },
  yaml: { color: "#cb4b16", letter: "Y" },
  yml: { color: "#cb4b16", letter: "Y" },
  lock: { color: "#9ca3af", letter: "L" },
};

function fileSvg(color: string, letter: string): string {
  const fontSize = letter.length >= 3 ? 5.4 : letter.length === 2 ? 7 : 9;
  return `<svg viewBox="0 0 16 16">
    <path d="M3 2h7l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" fill="${color}"/>
    <path d="M10 2v3h3" fill="none" stroke="#1b1b1f" stroke-opacity="0.25" stroke-width="0.6"/>
    <text x="8" y="11.3" text-anchor="middle" fill="#1b1b1f" font-size="${fontSize}" font-weight="bold" font-family="sans-serif">${letter}</text>
  </svg>`;
}

export function getFileIcon(
  name: string,
  isDir: boolean,
  isOpen: boolean
): string {
  if (isDir) return folderIcon(isOpen);
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (specialIcons[ext]) return specialIcons[ext];
  const config = extensionIcons[ext];
  return config ? fileSvg(config.color, config.letter) : defaultFileIcon;
}
