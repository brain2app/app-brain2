// The built-in themes ("skins"). One definition per theme drives everything: the CSS variables
// (generated at startup), the settings previews and the starting colours of custom themes.
// Each theme is inspired by (not copied from) the Obsidian theme named in `source`.

export type SkinId = "minimal" | "former" | "solar" | "gruver" | "typer" | "catppuccin";

/** The colours a theme picks for one color scheme. Everything else is derived. */
export interface SkinColors {
  bg1: string; // document background
  bg2: string; // sidebars, panels
  bg3: string; // raised surfaces, inputs, badges
  border: string;
  text: string;
  muted: string;
  faint: string;
  accent: string;
  link: string;
  code: string; // code background
  headings: [string, string, string, string, string, string];
  highlight: string; // ==highlight== background (any CSS colour)
  syntax: { keyword: string; string: string; number: string; func: string; type: string; attr: string; meta: string };
  /** Optional colours for **bold** / *italic* text (Catppuccin style). */
  bold?: string;
  italic?: string;
}

export interface SkinDef {
  id: SkinId;
  name: string;
  description: string;
  source: string;
  /** Shape and typography: CSS variables set for both color schemes. */
  vars: Record<string, string>;
  light: SkinColors;
  dark: SkinColors;
}

const SANS = '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif';
const SYSTEM = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", Roboto, sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const sizes = (s: number[]) => Object.fromEntries(s.map((v, i) => [`--h${i + 1}-size`, `${v}em`]));

export const SKIN_DEFS: SkinDef[] = [
  {
    id: "minimal",
    name: "The Minimal",
    description: "A minimal theme for the app, no big surprises. Simple and reliable.",
    source: "https://github.com/kepano/obsidian-minimal",
    vars: {
      "--font-interface": SYSTEM, "--font-text": SYSTEM, "--font-mono": MONO,
      "--line-height": "1.5", "--readable-width": "640px",
      "--radius-s": "4px", "--radius-m": "6px", "--radius-l": "8px",
      ...sizes([1.125, 1.05, 1, 0.9, 0.85, 0.85]), "--heading-weight": "600",
    },
    light: {
      bg1: "#ffffff", bg2: "#f5f5f5", bg3: "#ebebeb", border: "#e6e6e6",
      text: "#1f1f1f", muted: "#757575", faint: "#b5b5b5",
      accent: "#6a8695", link: "#59717d", code: "#f5f5f5",
      headings: ["#1f1f1f", "#1f1f1f", "#1f1f1f", "#1f1f1f", "#1f1f1f", "#757575"],
      highlight: "rgba(255, 208, 0, 0.4)",
      syntax: { keyword: "#8a63d2", string: "#4e9a5a", number: "#b8691b", func: "#3a75c4", type: "#a4791c", attr: "#59717d", meta: "#c2524f" },
    },
    dark: {
      bg1: "#262626", bg2: "#212121", bg3: "#363636", border: "#333333",
      text: "#d1d1d1", muted: "#999999", faint: "#595959",
      accent: "#889eaa", link: "#a3b6bf", code: "#2e2e2e",
      headings: ["#dadada", "#dadada", "#dadada", "#dadada", "#dadada", "#999999"],
      highlight: "rgba(255, 208, 0, 0.25)",
      syntax: { keyword: "#b392f0", string: "#9ccc8b", number: "#e5a66c", func: "#7fb0f0", type: "#e6c07b", attr: "#a3b6bf", meta: "#f08a85" },
    },
  },
  {
    id: "former",
    name: "The former",
    description: "Everything comes from somewhere... This is the primal.",
    source: "https://github.com/primary-theme/obsidian",
    vars: {
      "--font-interface": SANS, "--font-text": SANS, "--font-mono": MONO,
      "--line-height": "1.65", "--readable-width": "720px",
      "--radius-s": "6px", "--radius-m": "10px", "--radius-l": "16px",
      ...sizes([1.9, 1.55, 1.3, 1.15, 1.05, 1]), "--heading-weight": "700",
    },
    light: {
      bg1: "#ffffff", bg2: "#f6f5fb", bg3: "#ecebf6", border: "#e6e4f2",
      text: "#2c2a3a", muted: "#6b6884", faint: "#a3a0b8",
      accent: "#7158e2", link: "#6a50e0", code: "#f4f3fa",
      headings: ["#2c2a3a", "#6a50e0", "#c0478f", "#2b8a9e", "#b4741d", "#6b6884"],
      highlight: "#fff1a8",
      syntax: { keyword: "#7158e2", string: "#2e9d6a", number: "#b4741d", func: "#2b8a9e", type: "#c0478f", attr: "#6a50e0", meta: "#d9534f" },
    },
    dark: {
      bg1: "#1e1d29", bg2: "#181722", bg3: "#272636", border: "#2d2b3c",
      text: "#e3e1f0", muted: "#a19eb8", faint: "#6b6884",
      accent: "#a594ff", link: "#b3a5ff", code: "#262534",
      headings: ["#f1effa", "#b3a5ff", "#f28cc4", "#6fd0e2", "#f3bd6a", "#a19eb8"],
      highlight: "rgba(255, 221, 87, 0.28)",
      syntax: { keyword: "#b3a5ff", string: "#8fd6a8", number: "#f3bd6a", func: "#6fd0e2", type: "#f28cc4", attr: "#c6bbff", meta: "#ff8f8f" },
    },
  },
  {
    id: "solar",
    name: "The Solar",
    description: "Solarized theme for the app. For those who like gigantic burning balls of fire out in the space.",
    source: "https://github.com/harmtemolder/obsidian-solarized",
    vars: {
      "--font-interface": SANS, "--font-text": SANS, "--font-mono": MONO,
      "--line-height": "1.6", "--readable-width": "700px",
      "--radius-s": "3px", "--radius-m": "6px", "--radius-l": "10px",
      ...sizes([1.75, 1.45, 1.25, 1.1, 1, 1]), "--heading-weight": "600",
    },
    // Ethan Schoonover's Solarized: base03…base3 plus the eight accent hues.
    light: {
      bg1: "#fdf6e3", bg2: "#eee8d5", bg3: "#e6dfca", border: "#e3dcc6",
      text: "#586e75", muted: "#839496", faint: "#b0b5a4",
      accent: "#268bd2", link: "#268bd2", code: "#eee8d5",
      headings: ["#cb4b16", "#b58900", "#859900", "#2aa198", "#6c71c4", "#93a1a1"],
      highlight: "rgba(181, 137, 0, 0.25)",
      syntax: { keyword: "#859900", string: "#2aa198", number: "#d33682", func: "#268bd2", type: "#b58900", attr: "#cb4b16", meta: "#dc322f" },
    },
    dark: {
      bg1: "#002b36", bg2: "#00212b", bg3: "#073642", border: "#0b3d49",
      text: "#93a1a1", muted: "#839496", faint: "#586e75",
      accent: "#268bd2", link: "#3c9de0", code: "#073642",
      headings: ["#cb4b16", "#b58900", "#859900", "#2aa198", "#6c71c4", "#657b83"],
      highlight: "rgba(181, 137, 0, 0.3)",
      syntax: { keyword: "#859900", string: "#2aa198", number: "#d33682", func: "#268bd2", type: "#b58900", attr: "#cb4b16", meta: "#dc322f" },
    },
  },
  {
    id: "gruver",
    name: "The Gruver",
    description: "Let's gruv it!",
    source: "https://github.com/insanum/obsidian_gruvbox",
    vars: {
      "--font-interface": SANS, "--font-text": SANS, "--font-mono": MONO,
      "--line-height": "1.6", "--readable-width": "700px",
      "--radius-s": "2px", "--radius-m": "4px", "--radius-l": "6px",
      ...sizes([1.7, 1.45, 1.25, 1.1, 1, 1]), "--heading-weight": "700",
    },
    // Pavel Pertsev's gruvbox: retro groove, warm bg, faded colours in light, bright in dark.
    light: {
      bg1: "#fbf1c7", bg2: "#f2e5bc", bg3: "#ebdbb2", border: "#e5d5ad",
      text: "#3c3836", muted: "#7c6f64", faint: "#a89984",
      accent: "#af3a03", link: "#076678", code: "#f2e5bc",
      headings: ["#9d0006", "#af3a03", "#b57614", "#79740e", "#427b58", "#8f3f71"],
      highlight: "rgba(215, 153, 33, 0.3)",
      syntax: { keyword: "#9d0006", string: "#79740e", number: "#8f3f71", func: "#427b58", type: "#b57614", attr: "#076678", meta: "#af3a03" },
    },
    dark: {
      bg1: "#282828", bg2: "#1d2021", bg3: "#3c3836", border: "#3c3836",
      text: "#ebdbb2", muted: "#a89984", faint: "#7c6f64",
      accent: "#fe8019", link: "#83a598", code: "#32302f",
      headings: ["#fb4934", "#fe8019", "#fabd2f", "#b8bb26", "#8ec07c", "#d3869b"],
      highlight: "rgba(250, 189, 47, 0.3)",
      syntax: { keyword: "#fb4934", string: "#b8bb26", number: "#d3869b", func: "#8ec07c", type: "#fabd2f", attr: "#83a598", meta: "#fe8019" },
    },
  },
  {
    id: "typer",
    name: "The typer",
    description: "For the ones who like the click!",
    source: "https://github.com/crashmoney/obsidian-typewriter",
    vars: {
      "--font-interface": SANS, "--font-text": MONO, "--font-mono": MONO,
      "--line-height": "1.75", "--readable-width": "680px",
      "--radius-s": "4px", "--radius-m": "8px", "--radius-l": "12px",
      ...sizes([1.5, 1.3, 1.15, 1.05, 1, 1]), "--heading-weight": "600",
    },
    // Paper and ink, one blue for the cursor and links (iA Writer style).
    light: {
      bg1: "#fbfaf7", bg2: "#f2f0ea", bg3: "#e9e6de", border: "#e2ded4",
      text: "#2a2925", muted: "#6d6a62", faint: "#a19d93",
      accent: "#1a9cf0", link: "#1a7fc4", code: "#f0ede5",
      headings: ["#1d1c19", "#1d1c19", "#1d1c19", "#1d1c19", "#1d1c19", "#6d6a62"],
      highlight: "rgba(255, 214, 10, 0.4)",
      syntax: { keyword: "#7b5ea7", string: "#4f7f3a", number: "#a86a1e", func: "#2f6fb0", type: "#9a7a1c", attr: "#1a7fc4", meta: "#b94a48" },
    },
    dark: {
      bg1: "#1c1c1b", bg2: "#161615", bg3: "#262624", border: "#2c2c2a",
      text: "#d9d6cf", muted: "#9a968d", faint: "#66635d",
      accent: "#2fb2ff", link: "#5cc0ff", code: "#242422",
      headings: ["#ecebe6", "#ecebe6", "#ecebe6", "#ecebe6", "#ecebe6", "#9a968d"],
      highlight: "rgba(255, 214, 10, 0.28)",
      syntax: { keyword: "#c39bd3", string: "#a3c585", number: "#e0a96d", func: "#7fb6e8", type: "#e3c27a", attr: "#5cc0ff", meta: "#ec8a85" },
    },
  },
  {
    id: "catppuccin",
    name: "The catpuccin",
    description: "Really loved",
    source: "https://github.com/anubisnekhet/AnuPpuccin",
    vars: {
      "--font-interface": SANS, "--font-text": SANS, "--font-mono": MONO,
      "--line-height": "1.6", "--readable-width": "720px",
      "--radius-s": "6px", "--radius-m": "10px", "--radius-l": "16px",
      ...sizes([2, 1.6, 1.37, 1.25, 1.12, 1.12]), "--heading-weight": "600",
    },
    // Catppuccin Latte (light) and Mocha (dark); rosewater accent and rainbow headings like AnuPpuccin.
    light: {
      bg1: "#eff1f5", bg2: "#e6e9ef", bg3: "#ccd0da", border: "#bcc0cc",
      text: "#4c4f69", muted: "#6c6f85", faint: "#9ca0b0",
      accent: "#dc8a78", link: "#1e66f5", code: "#e6e9ef",
      headings: ["#d20f39", "#fe640b", "#40a02b", "#179299", "#7287fd", "#8839ef"],
      highlight: "rgba(223, 142, 29, 0.25)",
      syntax: { keyword: "#8839ef", string: "#40a02b", number: "#fe640b", func: "#1e66f5", type: "#df8e1d", attr: "#04a5e5", meta: "#d20f39" },
      bold: "#d20f39",
      italic: "#40a02b",
    },
    dark: {
      bg1: "#1e1e2e", bg2: "#181825", bg3: "#313244", border: "#313244",
      text: "#cdd6f4", muted: "#a6adc8", faint: "#6c7086",
      accent: "#f5e0dc", link: "#b4befe", code: "#181825",
      headings: ["#f38ba8", "#fab387", "#a6e3a1", "#94e2d5", "#b4befe", "#cba6f7"],
      highlight: "rgba(249, 226, 175, 0.3)",
      syntax: { keyword: "#cba6f7", string: "#a6e3a1", number: "#fab387", func: "#89b4fa", type: "#f9e2af", attr: "#89dceb", meta: "#f38ba8" },
      bold: "#f38ba8",
      italic: "#a6e3a1",
    },
  },
];

export const SKIN_IDS = SKIN_DEFS.map((s) => s.id);
export const DEFAULT_SKIN: SkinId = "minimal";

/** Themes renamed in the rebuild: old settings keep working. */
const LEGACY: Record<string, SkinId> = { typewriter: "typer", primary: "former", "blue-topaz": "minimal" };
export function migrateSkinId(id: string | undefined | null): SkinId {
  if (id && (SKIN_IDS as string[]).includes(id)) return id as SkinId;
  return (id && LEGACY[id]) || DEFAULT_SKIN;
}

export function skinDef(id: string): SkinDef {
  return SKIN_DEFS.find((s) => s.id === id) ?? SKIN_DEFS[0];
}

// ---------------------------------------------------------------------------- CSS generation
export function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (hex: string, a: number) => {
  const c = rgb(hex);
  return c ? `rgba(${c.join(", ")}, ${a})` : hex;
};
const shift = (hex: string, k: number) => {
  const c = rgb(hex);
  if (!c) return hex;
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k))));
  return `rgb(${f(c[0])}, ${f(c[1])}, ${f(c[2])})`;
};
export const onAccentText = (hex: string) => {
  const c = rgb(hex);
  if (!c) return "#ffffff";
  return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 > 0.62 ? "#111111" : "#ffffff";
};

/** All CSS variables of one color scheme. */
export function skinTokens(c: SkinColors, dark: boolean): Record<string, string> {
  const t: Record<string, string> = {
    "--bg-primary": c.bg1,
    "--bg-secondary": c.bg2,
    "--bg-tertiary": c.bg3,
    "--bg-hover": rgba(c.text, dark ? 0.06 : 0.05),
    "--bg-active": rgba(c.text, dark ? 0.1 : 0.09),
    "--border": c.border,
    "--text-normal": c.text,
    "--text-muted": c.muted,
    "--text-faint": c.faint,
    "--accent": c.accent,
    "--accent-hover": shift(c.accent, dark ? 0.15 : -0.12),
    "--accent-text": onAccentText(c.accent),
    "--accent-soft": rgba(c.accent, 0.14),
    "--text-link": c.link,
    "--tag-bg": rgba(c.link, 0.12),
    "--tag-text": c.link,
    "--highlight-bg": c.highlight,
    "--code-bg": c.code,
    "--selection": rgba(c.accent, dark ? 0.3 : 0.24),
    "--heading-color": c.headings[0],
    "--shadow": dark
      ? "0 12px 34px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.35)"
      : `0 12px 32px ${rgba(c.text, 0.14)}, 0 2px 6px ${rgba(c.text, 0.08)}`,
    "--graph-line": rgba(c.text, dark ? 0.18 : 0.22),
    "--syn-keyword": c.syntax.keyword,
    "--syn-string": c.syntax.string,
    "--syn-number": c.syntax.number,
    "--syn-function": c.syntax.func,
    "--syn-type": c.syntax.type,
    "--syn-attr": c.syntax.attr,
    "--syn-meta": c.syntax.meta,
    "--bold-color": c.bold ?? "inherit",
    "--italic-color": c.italic ?? "inherit",
  };
  c.headings.forEach((h, i) => (t[`--h${i + 1}-color`] = h));
  return t;
}

const block = (sel: string, vars: Record<string, string>) =>
  `${sel} {\n${Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}`;

/** The stylesheet for every built-in theme. */
export function skinsCss(): string {
  return SKIN_DEFS.map((s) => {
    const r = `:root[data-skin="${s.id}"]`;
    return [
      block(r, s.vars),
      block(`${r}[data-theme="light"],\n${r}[data-theme="dark"] .doc-light`, skinTokens(s.light, false)),
      block(`${r}[data-theme="dark"]`, skinTokens(s.dark, true)),
    ].join("\n");
  }).join("\n\n");
}

export function installSkins() {
  let el = document.getElementById("brain2-skins") as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = "brain2-skins";
    // Before other <style>s so user overrides (inline vars, doc-light) still win.
    document.head.prepend(el);
  }
  el.textContent = skinsCss();
}
