// Loading and editing the boards behind a board view. Markdown boards (local or a vault file) are
// parsed with the same format as the vault kanban; GitHub boards come from the backend's gh bridge.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, boardApi } from "../lib/api";
import type { BoardInfo, GhBoard, GhCard } from "../lib/boardTypes";
import { reportError, useApp } from "../store";
import { type Board, type Card, parseBoard, serializeBoard, uid } from "../kanban/format";
import type { LiveBoardHandlers, LiveCard, LiveLane } from "./LiveBoard";
import { SOURCE_CHANGED, type SourceChange } from "./store";

export const KIND_ICON: Record<BoardInfo["kind"], string> = {
  local: "view_kanban",
  vault: "inventory_2",
  github: "hub",
  merged: "join",
};

// ---------------------------------------------------------------------------- markdown files
export function markdownFile(info: BoardInfo) {
  if (info.kind === "local") {
    return {
      read: async () => (await boardApi.content(info.id)).content,
      write: (text: string) => boardApi.saveContent(info.id, text),
      matches: (d: SourceChange) => d.board_id === info.id,
    };
  }
  const { vault_id = "", path = "" } = info.config;
  return {
    read: async () => (await api.readFile(vault_id, path)).content ?? "",
    write: (text: string) => api.writeFile(vault_id, path, text),
    matches: (d: SourceChange) => d.vault_id === vault_id && !!d.paths?.includes(path),
  };
}

/** A markdown board's text, saved on every change, reloaded when the file changes elsewhere. */
export function useMarkdownBoard(info: BoardInfo) {
  const file = useMemo(() => markdownFile(info), [info]);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saved = useRef<string | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(0);

  const load = useCallback(async () => {
    try {
      const t = await file.read();
      if (pending.current) return;
      if (t !== saved.current) {
        saved.current = t;
        setText(t);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [file]);

  useEffect(() => {
    load();
    const onChange = (e: Event) => {
      if (file.matches((e as CustomEvent<SourceChange>).detail)) load();
    };
    window.addEventListener(SOURCE_CHANGED, onChange);
    return () => window.removeEventListener(SOURCE_CHANGED, onChange);
  }, [file, load]);

  const save = useCallback(
    (next: string) => {
      saved.current = next;
      setText(next);
      pending.current++;
      chain.current = chain.current
        .then(() => file.write(next))
        .catch(reportError)
        .finally(() => pending.current--);
    },
    [file],
  );
  return { text, error, save, reload: load };
}

// ---------------------------------------------------------------------------- sources (GitHub + merged)
type Source =
  | { info: BoardInfo; type: "md"; board: Board }
  | { info: BoardInfo; type: "gh"; data: GhBoard }
  | { info: BoardInfo; type: "error"; error: string; command?: string[] };

const norm = (s: string) => s.trim().toLowerCase();

const GH_COLORS: Record<string, string> = {
  GRAY: "#8b949e", BLUE: "#2f81f7", GREEN: "#3fb950", YELLOW: "#d29922",
  ORANGE: "#db6d28", RED: "#f85149", PINK: "#db61a2", PURPLE: "#a371f7",
};

function ghIcon(c: GhCard): { icon: string; cls: string } {
  if (c.kind === "draft") return { icon: "edit_note", cls: "muted" };
  if (c.kind === "pr") return { icon: "merge", cls: c.state === "MERGED" ? "gh-merged" : c.state === "CLOSED" ? "gh-closed" : "gh-open" };
  if (c.kind === "issue") return { icon: c.state === "CLOSED" ? "check_circle" : "adjust", cls: c.state === "CLOSED" ? "gh-merged" : "gh-open" };
  return { icon: "lock", cls: "muted" };
}

async function loadSource(info: BoardInfo): Promise<Source> {
  try {
    if (info.kind === "github") return { info, type: "gh", data: await boardApi.github(info.id) };
    return { info, type: "md", board: parseBoard(await markdownFile(info).read()) };
  } catch (e) {
    return { info, type: "error", error: e instanceof Error ? e.message : String(e), command: e instanceof ApiError ? e.command : undefined };
  }
}

const SEP = "::";
const NO_STATUS = "__none__";

/** Several boards shown as one: columns matched by name, edits written back to each source. */
export function useSources(infos: BoardInfo[], showSource: boolean) {
  const [sources, setSources] = useState<Source[] | null>(null);
  const ref = useRef<Source[]>([]);
  const busy = useRef(0);
  const key = infos.map((i) => `${i.id}:${i.updated_at}`).join(",");

  const put = (next: Source[]) => {
    ref.current = next;
    setSources(next);
  };
  const replace = (s: Source) => put(ref.current.map((x) => (x.info.id === s.info.id ? s : x)));

  const reload = useCallback(async (only?: string) => {
    if (only) {
      const info = ref.current.find((s) => s.info.id === only)?.info;
      if (info) replace(await loadSource(info));
      return;
    }
    put(await Promise.all(infos.map(loadSource)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Markdown sources follow their files; GitHub sources refresh every minute.
  useEffect(() => {
    const onChange = (e: Event) => {
      if (busy.current) return;
      const d = (e as CustomEvent<SourceChange>).detail;
      for (const s of ref.current) if (s.info.kind !== "github" && markdownFile(s.info).matches(d)) reload(s.info.id);
    };
    window.addEventListener(SOURCE_CHANGED, onChange);
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || busy.current) return;
      for (const s of ref.current) if (s.info.kind === "github") reload(s.info.id);
    }, 60_000);
    return () => (window.removeEventListener(SOURCE_CHANGED, onChange), window.clearInterval(timer));
  }, [reload]);

  const lanes = useMemo<LiveLane[]>(() => {
    const out: LiveLane[] = [];
    const byKey = new Map<string, LiveLane>();
    const lane = (title: string, color?: string | null) => {
      const k = norm(title);
      let l = byKey.get(k);
      if (!l) {
        l = { key: k, title, color, cards: [], addTargets: [] };
        byKey.set(k, l);
        out.push(l);
      }
      if (!l.color && color) l.color = color;
      return l;
    };
    for (const s of sources ?? []) {
      const source = showSource ? { label: s.info.name, icon: KIND_ICON[s.info.kind] } : undefined;
      const target = { id: s.info.id, label: s.info.name };
      if (s.type === "md") {
        for (const l of s.board.lanes) {
          const L = lane(l.title);
          L.addTargets.push(target);
          for (const c of l.cards)
            L.cards.push({
              id: s.info.id + SEP + c.id, text: c.text, markdown: true, checked: c.checked, source,
              canCheck: true, canEdit: true, canArchive: true, canDelete: true,
            });
        }
      } else if (s.type === "gh") {
        for (const l of s.data.lanes) {
          const L = lane(l.title, l.color ? GH_COLORS[l.color] : null);
          L.addTargets.push(target);
          if (l.id === NO_STATUS) L.fixed = true;
          for (const c of l.cards) {
            const ic = ghIcon(c);
            L.cards.push({
              id: s.info.id + SEP + c.id, text: c.title, url: c.url, icon: ic.icon, iconClass: ic.cls,
              sub: c.repo ? `${c.repo}${c.number ? ` #${c.number}` : ""}` : c.kind === "draft" ? "Draft" : null,
              labels: c.labels, assignees: c.assignees, source,
              body: c.body, editMode: "titleBody",
              canEdit: c.kind !== "redacted", canArchive: true, canDelete: true,
              deleteLabel: c.kind === "draft" ? undefined : "Remove from project",
            } satisfies LiveCard);
          }
        }
      }
    }
    return out;
  }, [sources, showSource]);

  // ------------------------------------------------------------------ edits
  const find = (cardId: string) => {
    const i = cardId.indexOf(SEP);
    const s = ref.current.find((x) => x.info.id === cardId.slice(0, i));
    return { s, id: cardId.slice(i + SEP.length) };
  };

  const run = async (fn: () => Promise<unknown>, sourceId: string) => {
    busy.current++;
    try {
      await fn();
    } catch (e) {
      reportError(e);
      await reload(sourceId);
    } finally {
      busy.current--;
    }
  };

  const ghColumn = (s: Extract<Source, { type: "gh" }>, body: { action: "add" | "rename" | "delete"; name?: string; option_id?: string }) =>
    run(async () => {
      await boardApi.githubColumn(s.info.id, { field_id: s.data.project.field_id, ...body });
      await reload(s.info.id);
    }, s.info.id);

  const writeMd = (s: Extract<Source, { type: "md" }>, board: Board) => {
    replace({ ...s, board });
    return run(() => markdownFile(s.info).write(serializeBoard(board)), s.info.id);
  };

  const mapCard = (board: Board, id: string, fn: (c: Card) => Card | null): Board => ({
    ...board,
    lanes: board.lanes.map((l) => ({
      ...l,
      cards: l.cards.flatMap((c) => {
        if (c.id !== id) return [c];
        const next = fn(c);
        return next ? [next] : [];
      }),
    })),
  });

  const handlers: LiveBoardHandlers = {
    onMove(cardId, laneKey) {
      const { s, id } = find(cardId);
      if (!s || s.type === "error") return;
      const title = lanes.find((l) => l.key === laneKey)?.title ?? laneKey;
      if (s.type === "md") {
        const to = s.board.lanes.find((l) => norm(l.title) === laneKey);
        if (!to) return useApp.getState().toast(`“${s.info.name}” has no “${title}” column`, "error");
        const card = s.board.lanes.flatMap((l) => l.cards).find((c) => c.id === id);
        if (!card) return;
        const without = mapCard(s.board, id, () => null);
        writeMd(s, {
          ...without,
          lanes: without.lanes.map((l) => (l.id === to.id ? { ...l, cards: [...l.cards, to.complete ? { ...card, checked: true } : card] } : l)),
        });
      } else {
        const to = s.data.lanes.find((l) => norm(l.title) === laneKey);
        if (!to) return useApp.getState().toast(`“${s.info.name}” has no “${title}” column`, "error");
        const card = s.data.lanes.flatMap((l) => l.cards).find((c) => c.id === id);
        if (!card) return;
        replace({
          ...s,
          data: {
            ...s.data,
            lanes: s.data.lanes.map((l) => ({
              ...l,
              cards: l.id === to.id ? [...l.cards.filter((c) => c.id !== id), card] : l.cards.filter((c) => c.id !== id),
            })),
          },
        });
        const p = s.data.project;
        run(() => boardApi.githubMove(s.info.id, { project_id: p.id, field_id: p.field_id, item_id: id, option_id: to.id }), s.info.id);
      }
    },
    onAdd(laneKey, text, targetId) {
      const s = ref.current.find((x) => x.info.id === targetId);
      if (!s || s.type === "error") return;
      if (s.type === "md") {
        const to = s.board.lanes.find((l) => norm(l.title) === laneKey);
        if (!to) return;
        writeMd(s, {
          ...s.board,
          lanes: s.board.lanes.map((l) => (l.id === to.id ? { ...l, cards: [...l.cards, { id: uid(), text, checked: l.complete }] } : l)),
        });
      } else {
        const to = s.data.lanes.find((l) => norm(l.title) === laneKey);
        const p = s.data.project;
        const [title, ...rest] = text.split("\n");
        run(async () => {
          await boardApi.githubAdd(s.info.id, { project_id: p.id, field_id: p.field_id, title, body: rest.join("\n").trim() || undefined, option_id: to?.id ?? null });
          await reload(s.info.id);
        }, s.info.id);
      }
    },
    onToggle(cardId) {
      const { s, id } = find(cardId);
      if (s?.type === "md") writeMd(s, mapCard(s.board, id, (c) => ({ ...c, checked: !c.checked })));
    },
    onEdit(cardId, text, body) {
      const { s, id } = find(cardId);
      if (s?.type === "md") writeMd(s, mapCard(s.board, id, (c) => ({ ...c, text })));
      else if (s?.type === "gh") {
        const card = s.data.lanes.flatMap((l) => l.cards).find((c) => c.id === id);
        if (!card?.content_id) return;
        const next = { title: text, body: body ?? card.body ?? "" };
        replace({ ...s, data: { ...s.data, lanes: s.data.lanes.map((l) => ({ ...l, cards: l.cards.map((c) => (c.id === id ? { ...c, ...next } : c)) })) } });
        run(() => boardApi.githubEdit(s.info.id, { kind: card.kind, content_id: card.content_id!, ...next }), s.info.id);
      }
    },
    onArchive(cardId) {
      const { s, id } = find(cardId);
      if (s?.type === "md") {
        const card = s.board.lanes.flatMap((l) => l.cards).find((c) => c.id === id);
        if (card) writeMd(s, { ...mapCard(s.board, id, () => null), archive: [...s.board.archive, card] });
      } else if (s?.type === "gh") {
        replace({ ...s, data: { ...s.data, lanes: s.data.lanes.map((l) => ({ ...l, cards: l.cards.filter((c) => c.id !== id) })) } });
        run(() => boardApi.githubArchive(s.info.id, { project_id: s.data.project.id, item_id: id }), s.info.id);
      }
    },
    onDelete(cardId) {
      const { s, id } = find(cardId);
      if (s?.type === "md") writeMd(s, mapCard(s.board, id, () => null));
      else if (s?.type === "gh") {
        replace({ ...s, data: { ...s.data, lanes: s.data.lanes.map((l) => ({ ...l, cards: l.cards.filter((c) => c.id !== id) })) } });
        run(() => boardApi.githubDelete(s.info.id, { project_id: s.data.project.id, item_id: id }), s.info.id);
      }
    },
    // Columns: on a merged board a column exists in each board that has it, so changes apply to all of them.
    onAddLane(title) {
      for (const s of ref.current) {
        if (s.type === "md" && !s.board.lanes.some((l) => norm(l.title) === norm(title)))
          writeMd(s, { ...s.board, lanes: [...s.board.lanes, { id: uid(), title, cards: [], complete: false }] });
        else if (s.type === "gh" && !s.data.lanes.some((l) => norm(l.title) === norm(title)))
          ghColumn(s, { action: "add", name: title });
      }
    },
    onRenameLane(laneKey, title) {
      for (const s of ref.current) {
        if (s.type === "md" && s.board.lanes.some((l) => norm(l.title) === laneKey))
          writeMd(s, { ...s.board, lanes: s.board.lanes.map((l) => (norm(l.title) === laneKey ? { ...l, title } : l)) });
        else if (s.type === "gh") {
          const l = s.data.lanes.find((x) => norm(x.title) === laneKey && x.id !== NO_STATUS);
          if (l) ghColumn(s, { action: "rename", option_id: l.id, name: title });
        }
      }
    },
    onDeleteLane(laneKey) {
      for (const s of ref.current) {
        if (s.type === "md" && s.board.lanes.some((l) => norm(l.title) === laneKey))
          writeMd(s, { ...s.board, lanes: s.board.lanes.filter((l) => norm(l.title) !== laneKey) });
        else if (s.type === "gh") {
          const l = s.data.lanes.find((x) => norm(x.title) === laneKey && x.id !== NO_STATUS);
          if (l) ghColumn(s, { action: "delete", option_id: l.id });
        }
      }
    },
  };

  const errors = (sources ?? []).filter((s): s is Extract<Source, { type: "error" }> => s.type === "error");
  const github = (sources ?? []).find((s): s is Extract<Source, { type: "gh" }> => s.type === "gh")?.data ?? null;
  return { loaded: sources !== null, lanes, handlers, errors, reload, github };
}
