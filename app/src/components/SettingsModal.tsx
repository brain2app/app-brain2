import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { api } from "../lib/api";
import { bridge, isNativeMobile, modKey, saveServer } from "../lib/bridge";
import {
  BASE_PALETTES, BASE_SKINS, BUNDLED_FONTS, COMMON_FONTS, THEME_TOKENS, activeCustomTheme, localFonts, newBlankTheme,
  newCustomTheme, parseThemeJson, startPalette, themeToJson,
} from "../lib/theme";
import { SKIN_DEFS, type SkinDef, migrateSkinId } from "../lib/skins";
import type { BaseSkin, CustomTheme, Settings } from "../lib/types";
import { useApp } from "../store";
import { Icon } from "./Icon";
import { Modal } from "./Modal";
import { VaultSettingsSection } from "../vaultSync";
import { ConnectorsSection } from "../connectors/ConnectorsSection";

const SECTIONS: { id: string; label: string; icon: string; group: string }[] = [
  { id: "general", label: "Appearance", icon: "palette", group: "System settings" },
  { id: "editor", label: "Editor", icon: "edit_note", group: "System settings" },
  { id: "files", label: "Files & links", icon: "folder", group: "System settings" },
  { id: "vaults", label: "Vault settings", icon: "inventory_2", group: "System settings" },
  { id: "about", label: "About", icon: "info", group: "System settings" },
  { id: "connectors", label: "Account connectors", icon: "hub", group: "Options" },
  { id: "system-prompts", label: "System prompts", icon: "terminal", group: "Options" },
  { id: "agent-prompts", label: "Agent prompts", icon: "smart_toy", group: "Options" },
  { id: "sync", label: "Sync & data", icon: "sync", group: "Options" },
];

export const SKINS = SKIN_DEFS;

/** A tiny picture of a theme: sidebar, page, heading colours, text lines and accent. */
function SkinPreview({ def, dark }: { def: SkinDef; dark: boolean }) {
  const c = dark ? def.dark : def.light;
  return (
    <span className="skin-preview" style={{ background: c.bg1, borderColor: c.border }} aria-hidden>
      <span className="skin-preview-side" style={{ background: c.bg2 }}>
        <i style={{ background: c.accent }} />
        <i style={{ background: c.faint }} />
        <i style={{ background: c.faint }} />
      </span>
      <span className="skin-preview-page">
        <b style={{ background: c.headings[0] }} />
        <i style={{ background: c.muted }} />
        <i style={{ background: c.muted, width: "70%" }} />
        <span className="skin-preview-dots">
          {c.headings.slice(1, 5).map((h, i) => <em key={i} style={{ background: h }} />)}
          <em style={{ background: c.link }} />
        </span>
      </span>
    </span>
  );
}

function Row({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-info">
        <div className="setting-title">{title}</div>
        {description && <div className="setting-description">{description}</div>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className={`toggle${value ? " on" : ""}`} role="switch" aria-checked={value} onClick={() => onChange(!value)}>
      <span />
    </button>
  );
}

function currentAccentHex(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(v);
  return m ? `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}` : "#1a9cf0";
}

let fontCache: Promise<string[]> | null = null;

/** Fonts that can actually be used here: bundled ones, then installed ones (like Obsidian's font list). */
function availableFonts(): Promise<string[]> {
  fontCache ??= localFonts().then((installed) => {
    // Without the Local Font Access API, keep only the common fonts this system really has.
    const fallback = installed.length ? [] : COMMON_FONTS.filter((f) => f.startsWith("system") || fontInstalled(f));
    return [...new Set([...BUNDLED_FONTS, ...fallback, ...installed])];
  });
  return fontCache;
}

function fontInstalled(name: string): boolean {
  try {
    const c = document.createElement("canvas").getContext("2d");
    if (!c) return false;
    const probe = "mmmmmmmmmlli10";
    c.font = "32px monospace";
    const mono = c.measureText(probe).width;
    c.font = "32px serif";
    const serif = c.measureText(probe).width;
    c.font = `32px "${name}", monospace`;
    const a = c.measureText(probe).width;
    c.font = `32px "${name}", serif`;
    const b = c.measureText(probe).width;
    return a !== mono || b !== serif;
  } catch {
    return false;
  }
}

/** Font picker: type to filter, scrollable list (each font shown in itself), or type any family name. */
function FontInput({ value, onChange, mono }: { value: string; onChange: (v: string) => void; mono?: boolean }) {
  const [fonts, setFonts] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    availableFonts().then(setFonts);
  }, []);
  const q = query.trim().toLowerCase();
  const shown = q ? fonts.filter((f) => f.toLowerCase().includes(q)) : fonts;

  const place = () => {
    const r = wrap.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const width = Math.max(r.width, 260);
    const left = Math.min(r.left, window.innerWidth - width - 8);
    if (below >= 220 || below >= above) setPos({ left, top: r.bottom + 4, width, maxHeight: Math.min(320, below) });
    else setPos({ left, bottom: window.innerHeight - r.top + 4, width, maxHeight: Math.min(320, above) });
  };
  const show = () => {
    place();
    setQuery("");
    setHi(Math.max(0, fonts.indexOf(value)));
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e.type === "mousedown" && (wrap.current?.contains(e.target as Node) || listRef.current?.contains(e.target as Node))) return;
      if (e.type === "scroll" && listRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: "nearest" });
  }, [hi, open]);
  const pick = (f: string) => {
    onChange(f);
    setOpen(false);
  };
  return (
    <div className="font-input" ref={wrap}>
      <input
        className="input"
        role="combobox"
        aria-expanded={open}
        aria-controls={id}
        value={open ? query || value : value}
        placeholder="Skin default"
        style={value ? { fontFamily: `"${value}", ${mono ? "monospace" : "sans-serif"}` } : undefined}
        onFocus={show}
        onClick={() => !open && show()}
        onChange={(e) => {
          setQuery(e.target.value);
          setHi(0);
          if (!open) show();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setHi((h) => Math.min(h + 1, shown.length - 1)));
          else if (e.key === "ArrowUp") (e.preventDefault(), setHi((h) => Math.max(h - 1, 0)));
          else if (e.key === "Enter") pick(shown[hi] ?? query.trim());
          else if (e.key === "Escape") setOpen(false);
        }}
        onBlur={() => {
          // A typed family name that isn't in the list is still accepted.
          if (query.trim() && !listRef.current?.matches(":hover")) onChange(query.trim());
        }}
      />
      <button className="icon-button" title="Choose a font" tabIndex={-1} onMouseDown={(e) => (e.preventDefault(), open ? setOpen(false) : show())}>
        <Icon name="expand_more" size={16} />
      </button>
      {value && (
        <button className="icon-button" title="Use skin default" onClick={() => onChange("")}>
          <Icon name="close" size={16} />
        </button>
      )}
      {open && pos && (
        <div
          ref={listRef}
          id={id}
          role="listbox"
          className="font-menu"
          style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: pos.maxHeight }}
        >
          {shown.length ? (
            shown.map((f, i) => (
              <div
                key={f}
                data-i={i}
                role="option"
                aria-selected={f === value}
                className={`font-option${i === hi ? " hi" : ""}${f === value ? " selected" : ""}`}
                style={{ fontFamily: `"${f}", ${mono ? "monospace" : "sans-serif"}` }}
                onMouseEnter={() => setHi(i)}
                onMouseDown={(e) => (e.preventDefault(), pick(f))}
              >
                {f}
              </div>
            ))
          ) : (
            <div className="font-option muted">Press Enter to use “{query.trim()}”</div>
          )}
        </div>
      )}
    </div>
  );
}

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const SKIN_NAME = Object.fromEntries(SKIN_DEFS.map((d) => [d.id, d.name])) as Record<BaseSkin, string>;

/** List + editor for user-made themes (skin "custom:<id>"). */
function CustomThemes({ settings, update }: { settings: Settings; update: (p: Partial<Settings>) => void }) {
  const themes = settings.customThemes ?? [];
  const active = activeCustomTheme(settings);
  const prefersDark = document.documentElement.dataset.theme === "dark";
  const [mode, setMode] = useState<"light" | "dark">(prefersDark ? "dark" : "light");
  const [newBase, setNewBase] = useState<BaseSkin | "blank">("blank");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const save = (list: CustomTheme[], skin?: Settings["skin"]) => update(skin ? { customThemes: list, skin } : { customThemes: list });
  const patch = (id: string, p: Partial<CustomTheme>) => save(themes.map((t) => (t.id === id ? { ...t, ...p } : t)));
  const add = (t: CustomTheme) => save([...themes, t], `custom:${t.id}`);
  const remove = (t: CustomTheme) => {
    const rest = themes.filter((x) => x.id !== t.id);
    save(rest, settings.skin === `custom:${t.id}` ? (rest.length ? `custom:${rest[rest.length - 1].id}` : t.base) : undefined);
  };
  const uniqueName = (base: string) => {
    let n = base;
    for (let i = 2; themes.some((t) => t.name === n); i++) n = `${base} ${i}`;
    return n;
  };
  const onImport = async (files: FileList | null) => {
    setError("");
    const imported: CustomTheme[] = [];
    for (const f of Array.from(files ?? [])) {
      try {
        imported.push(parseThemeJson(await f.text()));
      } catch (e) {
        setError(`${f.name}: ${(e as Error).message}`);
      }
    }
    if (imported.length) save([...themes, ...imported], `custom:${imported[imported.length - 1].id}`);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="custom-themes">
      <h3>Custom themes</h3>
      <div className="row wrap">
        <select className="select" value={newBase} onChange={(e) => setNewBase(e.target.value as BaseSkin)} title="Base skin for the new theme">
          <option value="blank">From scratch (blank)</option>
          {BASE_SKINS.map((b) => (
            <option key={b} value={b}>Based on {SKIN_NAME[b]}</option>
          ))}
        </select>
        <button
          className="btn btn-small"
          onClick={() => add(newBase === "blank" ? newBlankTheme(uniqueName("My theme")) : newCustomTheme(newBase, uniqueName("My theme")))}
        >
          <Icon name="add" size={16} /> New theme
        </button>
        <button className="btn btn-small" onClick={() => fileRef.current?.click()}>
          <Icon name="upload_file" size={16} /> Import JSON…
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json" multiple hidden onChange={(e) => onImport(e.target.files)} />
      </div>
      {error && <div className="form-error">{error}</div>}
      {themes.length > 0 && (
        <div className="theme-list">
          {themes.map((t) => (
            <div key={t.id} className={`theme-item${active?.id === t.id ? " active" : ""}`} onClick={() => update({ skin: `custom:${t.id}` })}>
              <span
                className="theme-dot"
                style={{ background: `linear-gradient(135deg, ${t.light["bg-primary"]} 50%, ${t.light.accent} 50%)` }}
              />
              <span className="theme-name">{t.name}</span>
              <span className="muted small">{t.blank ? "Blank" : SKIN_NAME[t.base]}</span>
              <span className="spacer" />
              <button
                className="icon-button"
                title="Duplicate"
                onClick={(e) => {
                  e.stopPropagation();
                  add({ ...structuredClone(t), id: Math.random().toString(36).slice(2, 10), name: uniqueName(`${t.name} copy`) });
                }}
              >
                <Icon name="content_copy" size={16} />
              </button>
              <button
                className="icon-button"
                title="Export as JSON"
                onClick={(e) => {
                  e.stopPropagation();
                  downloadText(`${t.name.replace(/[^\w.-]+/g, "-") || "theme"}.brain2-theme.json`, themeToJson(t));
                }}
              >
                <Icon name="download" size={16} />
              </button>
              <button
                className="icon-button"
                title="Delete"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(t);
                }}
              >
                <Icon name="delete" size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
      {active && (
        <div className="theme-editor">
          <div className="row wrap">
            <input className="input" value={active.name} onChange={(e) => patch(active.id, { name: e.target.value })} placeholder="Theme name" />
            <select
              className="select"
              value={active.blank ? "blank" : active.base}
              title="Base skin"
              onChange={(e) => {
                if (e.target.value === "blank") {
                  const b = newBlankTheme(active.name);
                  patch(active.id, { blank: true, base: b.base, light: b.light, dark: b.dark, fonts: b.fonts });
                  return;
                }
                const base = e.target.value as BaseSkin;
                patch(active.id, { base, blank: false, light: { ...BASE_PALETTES[base].light }, dark: { ...BASE_PALETTES[base].dark } });
              }}
            >
              <option value="blank">Base: none (blank)</option>
              {BASE_SKINS.map((b) => (
                <option key={b} value={b}>Base: {SKIN_NAME[b]}</option>
              ))}
            </select>
            <div className="segmented">
              {(["light", "dark"] as const).map((m) => (
                <button key={m} className={mode === m ? "active" : ""} onClick={() => setMode(m)}>
                  <Icon name={m === "light" ? "light_mode" : "dark_mode"} size={16} /> {m === "light" ? "Light" : "Dark"}
                </button>
              ))}
            </div>
            <button className="btn btn-small" onClick={() => patch(active.id, { [mode]: { ...startPalette(active)[mode] } })}>
              Reset {mode} colors
            </button>
            <button
              className="btn btn-small"
              title="Save this theme as a .json file you can share or import later"
              onClick={() => downloadText(`${active.name.replace(/[^\w.-]+/g, "-") || "theme"}.brain2-theme.json`, themeToJson(active))}
            >
              <Icon name="download" size={16} /> Export JSON
            </button>
          </div>
          <div className="token-grid">
            {THEME_TOKENS.map(({ key, label }) => (
              <label key={key} className="token">
                <input
                  type="color"
                  className="color-input"
                  value={active[mode][key] ?? startPalette(active)[mode][key]}
                  onChange={(e) => patch(active.id, { [mode]: { ...active[mode], [key]: e.target.value } })}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <p className="muted small">
            Editing the {mode} variant. Switch the color scheme above to preview the other one. The global accent color and fonts above
            override the theme when set.
          </p>
          <Row title="Theme interface font">
            <FontInput value={active.fonts?.interface ?? ""} onChange={(v) => patch(active.id, { fonts: { ...active.fonts, interface: v } })} />
          </Row>
          <Row title="Theme text font">
            <FontInput value={active.fonts?.text ?? ""} onChange={(v) => patch(active.id, { fonts: { ...active.fonts, text: v } })} />
          </Row>
          <Row title="Theme monospace font">
            <FontInput value={active.fonts?.mono ?? ""} onChange={(v) => patch(active.id, { fonts: { ...active.fonts, mono: v } })} mono />
          </Row>
        </div>
      )}
    </div>
  );
}

function Coming({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="coming">
      <Icon name="construction" size={32} />
      <h3>{title}</h3>
      <p className="muted">This area arrives in a later wave. Planned:</p>
      <ul>
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  );
}

export function SettingsModal() {
  const section = useApp((s) => s.settingsSection);
  const settings = useApp((s) => s.settings);
  const update = useApp((s) => s.updateSettings);
  const [system, setSystem] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    if (section) api.system().then(setSystem).catch(() => undefined);
  }, [section]);

  if (!section) return null;
  const close = () => useApp.setState({ settingsSection: null });
  const go = (id: string) => useApp.setState({ settingsSection: id });
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => update({ [k]: v } as Partial<Settings>);
  const groups = [...new Set(SECTIONS.map((s) => s.group))];

  return (
    <Modal onClose={close} className="modal-settings">
      <div className="settings">
        <nav className="settings-nav">
          {groups.map((g) => (
            <div key={g}>
              <div className="settings-group">{g}</div>
              {SECTIONS.filter((s) => s.group === g).map((s) => (
                <button key={s.id} className={`settings-nav-item${section === s.id ? " active" : ""}`} onClick={() => go(s.id)}>
                  <Icon name={s.icon} size={18} /> {s.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="settings-content">
          <button className="icon-button settings-close" onClick={close} aria-label="Close">
            <Icon name="close" size={20} />
          </button>
          {section === "general" && (
            <>
              <h2>Appearance</h2>
              <Row title="Theme" description="Built-in themes inspired by popular Obsidian themes. Pick one, or customize it into your own.">
                <div className="skin-grid">
                  {SKINS.map((s) => (
                    <button
                      key={s.id}
                      className={`skin-card${settings.skin === s.id ? " active" : ""}`}
                      data-skin-preview={s.id}
                      onClick={() => set("skin", s.id)}
                      title={`Inspired by ${s.source.replace("https://github.com/", "")}`}
                    >
                      <span className="skin-previews">
                        <SkinPreview def={s} dark={false} />
                        <SkinPreview def={s} dark />
                      </span>
                      <strong>{s.name}</strong>
                      <span className="muted small">{s.description}</span>
                    </button>
                  ))}
                  <button
                    className={`skin-card${settings.skin.startsWith("custom:") ? " active" : ""}`}
                    data-skin-preview="custom"
                    onClick={() => {
                      const themes = settings.customThemes ?? [];
                      if (themes.length) {
                        set("skin", `custom:${themes[themes.length - 1].id}`);
                      } else {
                        const base = migrateSkinId(settings.skin.startsWith("custom:") ? null : settings.skin);
                        const t = newCustomTheme(base, "My theme");
                        update({ customThemes: [t], skin: `custom:${t.id}` });
                      }
                    }}
                  >
                    <span className="skin-swatch" />
                    <strong>Custom</strong>
                    <span className="muted small">Your own themes, built on any skin. Import &amp; export as JSON.</span>
                  </button>
                </div>
              </Row>
              {!settings.skin.startsWith("custom:") && (
                <div className="row customize-skin">
                  <button
                    className="btn btn-small"
                    title="Copy this theme into a custom theme you can edit, export and share"
                    onClick={() => {
                      const base = migrateSkinId(settings.skin);
                      const t = newCustomTheme(base, `${SKIN_NAME[base]} (custom)`);
                      update({ customThemes: [...(settings.customThemes ?? []), t], skin: `custom:${t.id}` });
                    }}
                  >
                    <Icon name="palette" size={16} /> Customize {SKIN_NAME[migrateSkinId(settings.skin)]}…
                  </button>
                </div>
              )}
              <CustomThemes settings={settings} update={update} />
              <Row title="Color scheme">
                <select className="select" value={settings.colorScheme} onChange={(e) => set("colorScheme", e.target.value as Settings["colorScheme"])}>
                  <option value="system">Follow system</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </Row>
              <Row title="Accent color" description="Links, tags, selection and highlights. Reset to use the skin's color.">
                <div className="row">
                  <input
                    type="color"
                    className="color-input"
                    value={settings.accentColor || currentAccentHex()}
                    onChange={(e) => set("accentColor", e.target.value)}
                  />
                  <button className="btn btn-small" disabled={!settings.accentColor} onClick={() => set("accentColor", "")}>
                    Reset
                  </button>
                </div>
              </Row>
              <h3>Fonts</h3>
              <Row title="Interface font" description="Menus, sidebars and dialogs. Empty = skin default.">
                <FontInput value={settings.interfaceFont} onChange={(v) => set("interfaceFont", v)} />
              </Row>
              <Row title="Text font" description="Notes in the editor and reading view.">
                <FontInput value={settings.textFont} onChange={(v) => set("textFont", v)} />
              </Row>
              <Row title="Monospace font" description="Code blocks, inline code, JSON/YAML files.">
                <FontInput value={settings.monoFont} onChange={(v) => set("monoFont", v)} mono />
              </Row>
              <Row title="Font size" description={`${settings.fontSize}px`}>
                <input
                  type="range"
                  className="slider"
                  min={10}
                  max={32}
                  value={settings.fontSize}
                  style={{ "--fill": `${((settings.fontSize - 10) / 22) * 100}%` } as React.CSSProperties}
                  onChange={(e) => set("fontSize", Number(e.target.value))}
                />
              </Row>
              <Row title="Quick font size adjustment" description={`Hold ${modKey} and scroll (or pinch) over a note to change the font size.`}>
                <Toggle value={settings.ctrlScrollZoom} onChange={(v) => set("ctrlScrollZoom", v)} />
              </Row>
              <Row title="Readable line length" description="Limit the line width of notes. Off = notes use the full width.">
                <Toggle value={settings.readableLineLength} onChange={(v) => set("readableLineLength", v)} />
              </Row>
              <Row title="Documents always light" description="Notes keep the light colors of your skin, even when the app is dark.">
                <Toggle value={settings.documentsAlwaysLight} onChange={(v) => set("documentsAlwaysLight", v)} />
              </Row>
            </>
          )}
          {section === "editor" && (
            <>
              <h2>Editor</h2>
              <Row title="Default view for new tabs" description="Live preview hides markdown syntax except where you are editing.">
                <select className="select" value={settings.defaultViewMode} onChange={(e) => set("defaultViewMode", e.target.value as Settings["defaultViewMode"])}>
                  <option value="live">Live preview</option>
                  <option value="source">Source mode</option>
                  <option value="reading">Reading view</option>
                </select>
              </Row>
              <Row title="Properties in document" description="How YAML frontmatter is shown at the top of notes.">
                <select className="select" value={settings.propertiesInDocument} onChange={(e) => set("propertiesInDocument", e.target.value as Settings["propertiesInDocument"])}>
                  <option value="visible">Visible (as properties)</option>
                  <option value="source">Source (raw YAML)</option>
                  <option value="hidden">Hidden</option>
                </select>
              </Row>
              <Row title="Show inline title" description="Display the file name as an editable title above the note.">
                <Toggle value={settings.showInlineTitle} onChange={(v) => set("showInlineTitle", v)} />
              </Row>
              <Row title="Show format bar" description="A floating bar above notes with bold, headings, lists, tables, callouts and more.">
                <Toggle value={settings.showFormatBar} onChange={(v) => set("showFormatBar", v)} />
              </Row>
              <Row title="Show line numbers">
                <Toggle value={settings.showLineNumbers} onChange={(v) => set("showLineNumbers", v)} />
              </Row>
              <Row title="Highlight current line" description="Tint the line the cursor is on.">
                <Toggle value={settings.highlightActiveLine} onChange={(v) => set("highlightActiveLine", v)} />
              </Row>
              <Row title="Fold headings and lists" description="Show fold arrows next to headings and list items.">
                <Toggle value={settings.foldHeadings} onChange={(v) => set("foldHeadings", v)} />
              </Row>
              <Row title="Strict line breaks" description="Markdown spec: a single line break is ignored in reading view. Off = every line break is kept.">
                <Toggle value={settings.strictLineBreaks} onChange={(v) => set("strictLineBreaks", v)} />
              </Row>
              <Row title="Spellcheck">
                <Toggle value={settings.spellcheck} onChange={(v) => set("spellcheck", v)} />
              </Row>
              <Row title="Vim key bindings" description="Use Vim keys in the editor.">
                <Toggle value={settings.vimMode} onChange={(v) => set("vimMode", v)} />
              </Row>
              <Row title="Autosave delay" description={`Changes are saved ${settings.autosaveDelay} ms after you stop typing.`}>
                <input
                  type="range"
                  className="slider"
                  min={200}
                  max={5000}
                  step={100}
                  value={settings.autosaveDelay}
                  style={{ "--fill": `${((settings.autosaveDelay - 200) / 4800) * 100}%` } as React.CSSProperties}
                  onChange={(e) => set("autosaveDelay", Number(e.target.value))}
                />
              </Row>
            </>
          )}
          {section === "files" && (
            <>
              <h2>Files &amp; links</h2>
              <Row title="Default location for new notes">
                <select className="select" value={settings.newNoteLocation} onChange={(e) => set("newNoteLocation", e.target.value as Settings["newNoteLocation"])}>
                  <option value="current">Same folder as current file</option>
                  <option value="root">Vault root</option>
                </select>
              </Row>
              <Row title="Attachment folder" description="Pasted and dropped files are stored here (relative to the vault root).">
                <input className="input" value={settings.attachmentFolder} onChange={(e) => set("attachmentFolder", e.target.value)} />
              </Row>
              <Row title="Daily notes folder">
                <input className="input" value={settings.dailyNotesFolder} onChange={(e) => set("dailyNotesFolder", e.target.value)} />
              </Row>
              <Row title="Automatically update internal links" description="When a file is renamed or moved, update [[links]] pointing to it.">
                <Toggle value={settings.updateLinksOnMove} onChange={(v) => set("updateLinksOnMove", v)} />
              </Row>
              <Row title="Confirm file deletion" description="Deleted files go to the vault trash (.brain2/trash).">
                <Toggle value={settings.confirmDelete} onChange={(v) => set("confirmDelete", v)} />
              </Row>
            </>
          )}
          {section === "vaults" && <VaultSettingsSection />}
          {section === "about" && (
            <>
              <h2>About BRAIN2</h2>
              <p className="muted">The Personal Assistant Harness. Free and open source — please credit BRAIN2 when you reuse it.</p>
              {system && (
                <div className="kv">
                  <span>Version</span><code>{system.version}</code>
                  <span>Home</span>
                  <code className="link" onClick={() => bridge.openPath(system.home)}>{system.home}</code>
                  <span>Your settings</span>
                  <code className="link" title="Stored outside the app: updates never overwrite it" onClick={() => bridge.openPath(system.config_dir)}>
                    {system.settings_file}
                  </code>
                  <span>Index (SQLite)</span><code>{system.db}</code>
                  <span>Internal vaults</span><code>{system.internal_vaults}</code>
                  <span>Platform</span><code>{system.platform} · Python {system.python}</code>
                </div>
              )}
              {isNativeMobile && (
                <p>
                  <button className="btn" onClick={() => (saveServer(null), location.reload())}>
                    <Icon name="link_off" size={16} /> Connect to another BRAIN2 server
                  </button>
                </p>
              )}
              <h3>API &amp; MCP</h3>
              <p className="muted small">
                Every vault feature is available over the local HTTP API (<code>/api/…</code>, see <code>/docs</code>) and as an MCP
                server: <code>brain2 mcp</code>.
              </p>
            </>
          )}
          {section === "connectors" && <ConnectorsSection />}
          {section === "system-prompts" && <Coming title="System prompts" items={["View and edit the prompts BRAIN2 uses internally"]} />}
          {section === "agent-prompts" && <Coming title="Agent prompts" items={["See and edit which prompts your Echoes use, and when"]} />}
          {section === "sync" && (
            <Coming title="Sync & data" items={["Back up everything to a private git repository", "Export / import all data as an archive"]} />
          )}
        </div>
      </div>
    </Modal>
  );
}
