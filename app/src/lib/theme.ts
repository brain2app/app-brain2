// Applies user appearance settings (fonts, accent colour, sizes) on top of the active skin.
import { SKIN_DEFS, SKIN_IDS, type SkinColors, migrateSkinId, onAccentText, skinTokens } from "./skins";
import type { BaseSkin, CustomTheme, Settings } from "./types";

export const BUNDLED_FONTS = ["Inter", "IBM Plex Mono", "Source Serif 4"];
export const COMMON_FONTS = [
  "system-ui", "Helvetica Neue", "Arial", "Segoe UI", "Roboto", "Georgia", "Times New Roman",
  "Palatino", "Charter", "Iowan Old Style", "Menlo", "Monaco", "SF Mono", "Consolas", "Courier New",
  "JetBrains Mono", "Fira Code", "Cascadia Code",
];

function fontStack(name: string, fallback: string): string {
  const families = name
    .split(",")
    .map((f) => f.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean)
    .map((f) => (/^[\w-]+$/.test(f) && !/\s/.test(f) ? f : `"${f.replace(/"/g, "")}"`));
  return [...families, fallback].join(", ");
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Colour tokens a custom theme can override, with a human label. */
export const THEME_TOKENS: { key: string; label: string }[] = [
  { key: "bg-primary", label: "Background" },
  { key: "bg-secondary", label: "Sidebar background" },
  { key: "bg-tertiary", label: "Raised surfaces" },
  { key: "border", label: "Borders" },
  { key: "text-normal", label: "Text" },
  { key: "text-muted", label: "Muted text" },
  { key: "text-faint", label: "Faint text" },
  { key: "accent", label: "Accent" },
  { key: "text-link", label: "Links" },
  { key: "code-bg", label: "Code background" },
  { key: "h1-color", label: "Heading 1" },
  { key: "h2-color", label: "Heading 2" },
  { key: "h3-color", label: "Heading 3" },
  { key: "h4-color", label: "Heading 4" },
];

type Palette = Record<string, string>;

/** A theme's colours as editable custom-theme tokens. */
function paletteOf(c: SkinColors): Palette {
  const t = skinTokens(c, false);
  return Object.fromEntries(THEME_TOKENS.map(({ key }) => [key, t[`--${key}`]]));
}
/** Starting values for custom themes, from the built-in theme definitions. */
export const BASE_PALETTES = Object.fromEntries(
  SKIN_DEFS.map((d) => [d.id, { light: paletteOf(d.light), dark: paletteOf(d.dark) }]),
) as Record<BaseSkin, { light: Palette; dark: Palette }>;

export const BASE_SKINS: BaseSkin[] = SKIN_IDS;

/** Neutral starting point for a theme made from scratch: plain greys, no skin personality. */
export const BLANK_PALETTE: { light: Palette; dark: Palette } = {
  light: { "bg-primary": "#ffffff", "bg-secondary": "#f5f5f5", "bg-tertiary": "#ebebeb", border: "#e0e0e0", "text-normal": "#222222", "text-muted": "#666666", "text-faint": "#999999", accent: "#5c5c5c", "text-link": "#3d3d3d", "code-bg": "#f2f2f2", "h1-color": "#111111", "h2-color": "#111111", "h3-color": "#111111", "h4-color": "#111111" },
  dark: { "bg-primary": "#1e1e1e", "bg-secondary": "#181818", "bg-tertiary": "#272727", border: "#303030", "text-normal": "#dddddd", "text-muted": "#9a9a9a", "text-faint": "#666666", accent: "#a8a8a8", "text-link": "#c8c8c8", "code-bg": "#262626", "h1-color": "#f0f0f0", "h2-color": "#f0f0f0", "h3-color": "#f0f0f0", "h4-color": "#f0f0f0" },
};
const BLANK_FONTS = { interface: "system-ui", text: "system-ui", mono: "ui-monospace" };

/** The palette a theme starts from / resets to. */
export function startPalette(t: Pick<CustomTheme, "base" | "blank">): { light: Palette; dark: Palette } {
  return t.blank ? BLANK_PALETTE : BASE_PALETTES[t.base];
}

export function newBlankTheme(name: string): CustomTheme {
  return {
    id: Math.random().toString(36).slice(2, 10),
    name,
    base: "minimal",
    blank: true,
    light: { ...BLANK_PALETTE.light },
    dark: { ...BLANK_PALETTE.dark },
    fonts: { ...BLANK_FONTS },
  };
}

export function newCustomTheme(base: BaseSkin, name: string): CustomTheme {
  return {
    id: Math.random().toString(36).slice(2, 10),
    name,
    base,
    light: { ...BASE_PALETTES[base].light },
    dark: { ...BASE_PALETTES[base].dark },
    fonts: {},
  };
}

/** Settings saved before the theme rebuild use old theme ids; map them to the new ones. */
export function normalizeSettings(s: Settings): Settings {
  const skin = s.skin.startsWith("custom:") ? s.skin : migrateSkinId(s.skin);
  const customThemes = (s.customThemes ?? []).map((t) => (SKIN_IDS.includes(t.base) ? t : { ...t, base: migrateSkinId(t.base) }));
  return { ...s, skin, customThemes };
}

export function activeCustomTheme(s: Settings): CustomTheme | null {
  if (!s.skin.startsWith("custom:")) return null;
  const id = s.skin.slice("custom:".length);
  return (s.customThemes ?? []).find((t) => t.id === id) ?? null;
}

/** Validates/normalises an imported theme JSON. Throws on invalid input. */
export function parseThemeJson(text: string): CustomTheme {
  const raw = JSON.parse(text) as Partial<CustomTheme> & { brain2Theme?: number };
  if (!raw || typeof raw !== "object") throw new Error("Not a theme file");
  const base = migrateSkinId(raw.base);
  const blank = raw.blank === true;
  const start = startPalette({ base, blank });
  const clean = (p: unknown, fallback: Palette): Palette => {
    const out: Palette = { ...fallback };
    if (p && typeof p === "object")
      for (const [k, v] of Object.entries(p)) if (THEME_TOKENS.some((t) => t.key === k) && typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) out[k] = v;
    return out;
  };
  if (!raw.light && !raw.dark) throw new Error("Theme file has no colors");
  const fonts = raw.fonts && typeof raw.fonts === "object" ? raw.fonts : {};
  return {
    id: Math.random().toString(36).slice(2, 10),
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 60) : "Imported theme",
    base,
    ...(blank ? { blank: true } : {}),
    light: clean(raw.light, start.light),
    dark: clean(raw.dark, start.dark),
    fonts: {
      interface: typeof fonts.interface === "string" ? fonts.interface : undefined,
      text: typeof fonts.text === "string" ? fonts.text : undefined,
      mono: typeof fonts.mono === "string" ? fonts.mono : undefined,
    },
  };
}

export function themeToJson(t: CustomTheme): string {
  return JSON.stringify({ brain2Theme: 1, name: t.name, base: t.base, ...(t.blank ? { blank: true } : {}), light: t.light, dark: t.dark, fonts: t.fonts ?? {} }, null, 2);
}

const ACCENT_PROPS = ["--accent", "--accent-hover", "--accent-soft", "--selection", "--text-link", "--tag-text", "--tag-bg", "--accent-text"];
const PROPS = [
  "--font-interface", "--font-text", "--font-mono", ...ACCENT_PROPS, "--left-width", "--right-width",
  ...THEME_TOKENS.map((t) => `--${t.key}`), "--heading-color", "--bg-hover", "--bg-active",
];

type VarTarget = { style: { setProperty(name: string, value: string): void } };

function applyAccent(root: VarTarget, hex: string, dark: boolean) {
  const rgb = hexToRgb(hex);
  if (rgb) {
    const [r, g, b] = rgb;
    const shade = (k: number) => `rgb(${Math.round(r * k)}, ${Math.round(g * k)}, ${Math.round(b * k)})`;
    root.style.setProperty("--accent", `rgb(${r}, ${g}, ${b})`);
    root.style.setProperty("--accent-hover", dark ? `rgb(${Math.min(255, r + 25)}, ${Math.min(255, g + 25)}, ${Math.min(255, b + 25)})` : shade(0.88));
    root.style.setProperty("--accent-soft", `rgba(${r}, ${g}, ${b}, 0.14)`);
    root.style.setProperty("--selection", `rgba(${r}, ${g}, ${b}, 0.25)`);
    root.style.setProperty("--text-link", `rgb(${r}, ${g}, ${b})`);
    root.style.setProperty("--tag-text", `rgb(${r}, ${g}, ${b})`);
    root.style.setProperty("--tag-bg", `rgba(${r}, ${g}, ${b}, 0.13)`);
    // Text on accent-filled buttons: white on dark accents, near-black on light ones.
    root.style.setProperty("--accent-text", onAccentText(hex));
  }
}

/** Theme variables (custom palette, fonts, accent) for one color scheme, applied to ``target``. */
function themeVars(target: VarTarget, s: Settings, dark: boolean) {
  const custom = activeCustomTheme(s);
  const root = target;
  if (custom) {
    const pal = dark ? custom.dark : custom.light;
    const basePal = BASE_PALETTES[custom.base][dark ? "dark" : "light"];
    for (const { key } of THEME_TOKENS) {
      const v = pal[key];
      if (v && v.toLowerCase() !== basePal[key]?.toLowerCase()) root.style.setProperty(`--${key}`, v);
    }
    const tr = hexToRgb(pal["text-normal"] ?? "");
    if (tr && pal["text-normal"] !== basePal["text-normal"]) {
      root.style.setProperty("--bg-hover", `rgba(${tr.join(", ")}, 0.06)`);
      root.style.setProperty("--bg-active", `rgba(${tr.join(", ")}, 0.1)`);
    }
    if (pal.accent && pal.accent.toLowerCase() !== basePal.accent?.toLowerCase()) {
      applyAccent(root, pal.accent, dark);
      if (pal["text-link"]) root.style.setProperty("--text-link", pal["text-link"]);
    }
    const f = custom.fonts ?? {};
    if (f.interface?.trim()) root.style.setProperty("--font-interface", fontStack(f.interface, "system-ui, sans-serif"));
    if (f.text?.trim()) root.style.setProperty("--font-text", fontStack(f.text, "system-ui, sans-serif"));
    if (f.mono?.trim()) root.style.setProperty("--font-mono", fontStack(f.mono, "ui-monospace, monospace"));
  }
  if (s.interfaceFont.trim()) root.style.setProperty("--font-interface", fontStack(s.interfaceFont, "system-ui, sans-serif"));
  if (s.textFont.trim()) root.style.setProperty("--font-text", fontStack(s.textFont, "system-ui, sans-serif"));
  if (s.monoFont.trim()) root.style.setProperty("--font-mono", fontStack(s.monoFont, "ui-monospace, monospace"));
  if (s.accentColor) applyAccent(root, s.accentColor, dark);
}

export function applyAppearance(s: Settings, dark: boolean) {
  const root = document.documentElement;
  for (const p of PROPS) root.style.removeProperty(p);
  const custom = activeCustomTheme(s);
  root.dataset.skin = custom ? custom.base : migrateSkinId(s.skin.startsWith("custom:") ? null : s.skin);
  root.dataset.customTheme = custom ? custom.id : "";
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.docsLight = s.documentsAlwaysLight ? "true" : "";
  root.style.setProperty("--font-text-size", `${s.fontSize}px`);
  root.style.setProperty("--left-width", `${s.leftWidth}px`);
  root.style.setProperty("--right-width", `${s.rightWidth}px`);
  themeVars(root, s, dark);
  // "Documents always light": the light variant of the same theme, scoped to document views.
  let el = document.getElementById("brain2-doc-light") as HTMLStyleElement | null;
  if (s.documentsAlwaysLight && dark) {
    const vars: string[] = [];
    themeVars({ style: { setProperty: (n, v) => vars.push(`${n}: ${v};`) } }, s, false);
    if (!el) {
      el = document.createElement("style");
      el.id = "brain2-doc-light";
      document.head.append(el);
    }
    el.textContent = `html:root[data-skin][data-theme][data-docs-light] .doc-light { ${vars.join(" ")} }`;
  } else if (el) {
    el.textContent = "";
  }
}

/** Installed fonts via the Local Font Access API (Chromium/Electron), when permitted. */
export async function localFonts(): Promise<string[]> {
  const q = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts;
  if (!q) return [];
  try {
    const fonts = await q();
    return [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}
