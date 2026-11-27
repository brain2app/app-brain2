import { describe, expect, it } from "vitest";
import { SKIN_DEFS, migrateSkinId, rgb, skinTokens, skinsCss } from "./skins";
import { BASE_PALETTES, THEME_TOKENS, normalizeSettings, parseThemeJson } from "./theme";
import { DEFAULT_SETTINGS } from "./types";

const lum = (hex: string) => {
  const c = rgb(hex)!.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe("built-in themes", () => {
  it("has the six themes in order", () => {
    expect(SKIN_DEFS.map((s) => s.name)).toEqual(["The Minimal", "The former", "The Solar", "The Gruver", "The typer", "The catpuccin"]);
  });

  it("keeps body text readable in both schemes", () => {
    for (const s of SKIN_DEFS)
      for (const c of [s.light, s.dark]) {
        expect(contrast(c.text, c.bg1), `${s.id} text`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(c.link, c.bg1), `${s.id} link`).toBeGreaterThanOrEqual(3);
      }
  });

  it("generates every editable token and a translucent selection", () => {
    for (const s of SKIN_DEFS) {
      const t = skinTokens(s.dark, true);
      for (const { key } of THEME_TOKENS) expect(t[`--${key}`], `${s.id} ${key}`).toBeTruthy();
      expect(t["--selection"]).toMatch(/^rgba\(/);
      expect(BASE_PALETTES[s.id].light["bg-primary"]).toBe(s.light.bg1);
    }
    expect(skinsCss()).toContain(':root[data-skin="catppuccin"][data-theme="dark"] .doc-light');
  });

  it("maps the old theme ids", () => {
    expect(migrateSkinId("typewriter")).toBe("typer");
    expect(migrateSkinId("primary")).toBe("former");
    expect(migrateSkinId("blue-topaz")).toBe("minimal");
    expect(migrateSkinId("nope")).toBe("minimal");
    const s = normalizeSettings({ ...DEFAULT_SETTINGS, skin: "primary" as never, customThemes: [{ id: "a", name: "A", base: "blue-topaz" as never, light: {}, dark: {} }] });
    expect(s.skin).toBe("former");
    expect(s.customThemes[0].base).toBe("minimal");
    expect(parseThemeJson(JSON.stringify({ name: "X", base: "typewriter", light: { accent: "#ff0000" } })).base).toBe("typer");
  });
});
