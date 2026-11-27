// Boards module: the list of boards, the "New board" dialog and one board.
import { useEffect, useMemo, useState } from "react";
import { Icon, UserIcon } from "../components/Icon";
import { pickIcon } from "../components/IconPicker";
import { Modal } from "../components/Modal";
import { Spinner } from "../components/Spinner";
import { KanbanView } from "../kanban/KanbanView";
import { ApiError, boardApi } from "../lib/api";
import type { BoardInfo, BoardTemplate, GhProjectRef, VaultKanban } from "../lib/boardTypes";
import { bridge } from "../lib/bridge";
import { type MenuItem, confirmDialog, lastMenuPos, promptDialog, reportError, useApp } from "../store";
import { FixableError, runInTerminal } from "./FixCommand";
import { LiveBoard } from "./LiveBoard";
import { KIND_ICON, useMarkdownBoard, useSources } from "./sources";
import { useBoards } from "./store";

const KIND_LABEL: Record<BoardInfo["kind"], string> = {
  local: "Board",
  vault: "Vault kanban",
  github: "GitHub project",
  merged: "Merged board",
};

function describe(b: BoardInfo, all: BoardInfo[], vaults: { id: string; name: string }[]): string {
  if (b.kind === "vault") return `${vaults.find((v) => v.id === b.config.vault_id)?.name ?? "Vault"} · ${b.config.path}`;
  if (b.kind === "github") return `${b.config.owner} · project #${b.config.number}`;
  if (b.kind === "merged") {
    const names = (b.config.boards ?? []).map((id) => all.find((x) => x.id === id)?.name).filter(Boolean);
    return names.length ? names.join(" + ") : "No boards left to merge";
  }
  return "Local board";
}

// ---------------------------------------------------------------------------- actions
async function renameBoard(b: BoardInfo) {
  const name = await promptDialog("Rename board", { value: b.name, okLabel: "Rename" });
  if (!name?.trim()) return;
  try {
    await boardApi.update(b.id, { name: name.trim() });
    await useBoards.getState().load();
  } catch (e) {
    reportError(e);
  }
}

async function changeIcon(b: BoardInfo) {
  const icon = await pickIcon(lastMenuPos, b.icon ?? "");
  if (icon === null) return;
  try {
    await boardApi.update(b.id, { icon });
    await useBoards.getState().load();
  } catch (e) {
    reportError(e);
  }
}

async function deleteBoard(b: BoardInfo) {
  const what =
    b.kind === "local"
      ? "Its cards are deleted too."
      : b.kind === "vault"
        ? "The kanban file stays in the vault."
        : b.kind === "github"
          ? "The project on GitHub is not affected."
          : "The boards it merges are not affected.";
  if (!(await confirmDialog("Delete board", `Delete “${b.name}”? ${what}`, { okLabel: "Delete", danger: true }))) return;
  try {
    await boardApi.remove(b.id);
    await useBoards.getState().load();
    const r = useApp.getState().route;
    if (r.module === "board" && r.boardId === b.id) useApp.getState().navigate({ module: "boards" });
  } catch (e) {
    reportError(e);
  }
}

function openSource(b: BoardInfo, githubUrl?: string | null) {
  if (b.kind === "vault" && b.config.vault_id) useApp.getState().navigate({ module: "vault", vaultId: b.config.vault_id, file: b.config.path });
  else if (b.kind === "github" && githubUrl) bridge.openExternal(githubUrl);
}

function boardMenu(b: BoardInfo, extra: MenuItem[] = []): MenuItem[] {
  return [
    ...extra,
    { label: "Rename…", icon: "edit", action: () => renameBoard(b) },
    { label: "Change icon…", icon: "mood", action: () => changeIcon(b) },
    ...(b.kind === "vault" ? [{ label: "Open the file in its vault", icon: "inventory_2", action: () => openSource(b) }] : []),
    { separator: true },
    { label: "Delete board", icon: "delete", danger: true, action: () => deleteBoard(b) },
  ];
}

// ---------------------------------------------------------------------------- home
export function BoardsHome() {
  const { boards, loaded } = useBoards();
  const vaults = useApp((s) => s.vaults);
  const navigate = useApp((s) => s.navigate);
  const showMenu = useApp((s) => s.showMenu);
  const [creating, setCreating] = useState<false | Step>(false);
  useEffect(() => {
    useBoards.getState().load().catch(reportError);
  }, []);
  // A command the dialog needs (e.g. GitHub sign-in): close the dialog so the terminal below can be
  // used, run it, then reopen the dialog where the user was.
  const runThenReopen = async (command: string[], step: Step) => {
    setCreating(false);
    try {
      const code = await runInTerminal(command);
      if (code !== 0) useApp.getState().toast(`The command stopped with exit code ${code}. Check the terminal below.`, "error");
    } catch (e) {
      reportError(e);
    }
    setCreating(step);
  };
  if (!loaded) return <div className="page center"><Spinner /></div>;
  return (
    <div className={`page${boards.length ? "" : " center"}`}>
      {boards.length ? (
        <div className="page-inner">
          <div className="page-head">
            <h1 className="page-title">Boards</h1>
            <button className="btn btn-primary" onClick={() => setCreating("pick")}>
              <Icon name="add" size={18} /> New board
            </button>
          </div>
          <div className="card-grid">
            {boards.map((b) => (
              <button
                key={b.id}
                className="card board-card"
                onClick={() => navigate({ module: "board", boardId: b.id })}
                onContextMenu={(e) => (e.preventDefault(), showMenu(e, boardMenu(b)))}
              >
                <UserIcon value={b.icon ?? ""} fallback={KIND_ICON[b.kind]} size={26} />
                <strong>{b.name}</strong>
                <span className="muted small board-card-sub">{describe(b, boards, vaults)}</span>
                <span className="kind-badge">{KIND_LABEL[b.kind]}</span>
                <span role="button" className="icon-button card-sync" title="Board options" onClick={(e) => (e.stopPropagation(), showMenu(e, boardMenu(b)))}>
                  <Icon name="more_horiz" size={18} />
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="hero">
          <Icon name="view_kanban" size={56} />
          <h2>Create your first board</h2>
          <p className="muted">
            Start a fresh board, follow a GitHub project live, use a kanban from one of your vaults, or merge several boards into one.
          </p>
          <button className="btn btn-primary btn-large" onClick={() => setCreating("pick")}>
            <Icon name="add" size={20} /> New board
          </button>
        </div>
      )}
      {creating && <NewBoardDialog initialStep={creating} onClose={() => setCreating(false)} onRun={runThenReopen} />}
    </div>
  );
}

// ---------------------------------------------------------------------------- new board
type Step = "pick" | "local" | "github" | "vault" | "merged";

const CHOICES: { id: Exclude<Step, "pick">; icon: string; title: string; sub: string }[] = [
  { id: "local", icon: "view_kanban", title: "Fresh board", sub: "An empty board with your own columns" },
  { id: "github", icon: "hub", title: "GitHub project", sub: "Live: moving a card updates its Status on GitHub" },
  { id: "vault", icon: "inventory_2", title: "Kanban from a vault", sub: "Linked to the file: edits go both ways" },
  { id: "merged", icon: "join", title: "Merge boards", sub: "Several boards as one, columns matched by name" },
];

const TEMPLATES: { id: BoardTemplate; label: string; lanes: string }[] = [
  { id: "basic", label: "Basic", lanes: "To do · Doing · Done" },
  { id: "github", label: "Like a GitHub project", lanes: "Backlog · Ready · In progress · In review · Done" },
  { id: "empty", label: "Empty", lanes: "No columns" },
];

function NewBoardDialog({ onClose, initialStep, onRun }: {
  onClose: () => void;
  initialStep: Step;
  onRun: (command: string[], step: Step) => void;
}) {
  const [step, setStep] = useState<Step>(initialStep);
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<BoardTemplate>("basic");
  const [vaultPick, setVaultPick] = useState<VaultKanban | null>(null);
  const [ghPick, setGhPick] = useState<GhProjectRef | null>(null);
  const [merge, setMerge] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const boards = useBoards((s) => s.boards);
  const choice = CHOICES.find((c) => c.id === step);

  const ready =
    !!name.trim() &&
    (step === "local" || (step === "vault" && !!vaultPick) || (step === "github" && !!ghPick) || (step === "merged" && merge.length >= 2));

  const create = async () => {
    if (!ready) return;
    setSaving(true);
    try {
      const config =
        step === "vault"
          ? { vault_id: vaultPick!.vault_id, path: vaultPick!.path }
          : step === "github"
            ? { owner: ghPick!.owner, number: ghPick!.number }
            : step === "merged"
              ? { boards: merge }
              : undefined;
      const b = await boardApi.create({ name: name.trim(), kind: step, config, template });
      await useBoards.getState().load();
      onClose();
      useApp.getState().navigate({ module: "board", boardId: b.id });
    } catch (e) {
      reportError(e);
      setSaving(false);
    }
  };

  return (
    <Modal
      title={
        <>
          {step !== "pick" && (
            <button className="icon-button" title="Back" onClick={() => setStep("pick")}>
              <Icon name="arrow_back" size={18} />
            </button>
          )}
          <Icon name={choice?.icon ?? "view_kanban"} size={20} />
          {choice ? choice.title : "New board"}
        </>
      }
      onClose={onClose}
      className="modal-medium new-board-dialog"
      footer={
        step !== "pick" && (
          <>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={!ready || saving} onClick={create}>
              {saving ? "Creating…" : "Create board"}
            </button>
          </>
        )
      }
    >
      {step === "pick" ? (
        <div className="provider-grid">
          {CHOICES.map((c) => (
            <button key={c.id} className="provider-choice" onClick={() => setStep(c.id)}>
              <Icon name={c.icon} size={24} />
              <span className="provider-choice-text">
                <strong>{c.title}</strong>
                <span className="muted tiny">{c.sub}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="new-board-form">
          {step === "github" && (
            <GithubPicker value={ghPick} onPick={(p) => (setGhPick(p), name || setName(p.title))} onRun={(cmd) => onRun(cmd, "github")} />
          )}
          {step === "vault" && <VaultPicker value={vaultPick} onPick={(k) => (setVaultPick(k), name || setName(k.name))} />}
          {step === "merged" && <MergePicker boards={boards} value={merge} onChange={setMerge} />}
          <label className="field-label" htmlFor="board-name">Name</label>
          <input
            id="board-name"
            className="input"
            autoFocus={step === "local"}
            value={name}
            placeholder="e.g. Product roadmap"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
          {step === "local" && (
            <>
              <span className="field-label">Columns</span>
              <div className="template-list">
                {TEMPLATES.map((t) => (
                  <label key={t.id} className={`template-choice${template === t.id ? " active" : ""}`}>
                    <input type="radio" name="template" checked={template === t.id} onChange={() => setTemplate(t.id)} />
                    <span>
                      <strong>{t.label}</strong>
                      <span className="muted tiny">{t.lanes}</span>
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

function useLoad<T>(fn: () => Promise<T>) {
  const [state, setState] = useState<{ data?: T; error?: string; command?: string[]; loading: boolean }>({ loading: true });
  const load = () => {
    setState({ loading: true });
    fn().then(
      (data) => setState({ data, loading: false }),
      (e) => setState({ error: e instanceof Error ? e.message : String(e), command: e instanceof ApiError ? e.command : undefined, loading: false }),
    );
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);
  return { ...state, reload: load };
}

function GithubPicker({ value, onPick, onRun }: {
  value: GhProjectRef | null;
  onPick: (p: GhProjectRef) => void;
  onRun: (command: string[]) => void;
}) {
  const { data, error, command, loading, reload } = useLoad(boardApi.githubProjects);
  const [filter, setFilter] = useState("");
  const list = (data ?? []).filter((p) => `${p.owner} ${p.title}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="source-picker">
      <p className="muted small">Your projects and your organizations' projects, through the GitHub CLI (gh) you're signed in to.</p>
      {loading ? (
        <div className="center pad"><Spinner /></div>
      ) : error ? (
        <FixableError message={error} command={command} onFixed={reload} onRetry={reload} onRun={onRun} />
      ) : !data?.length ? (
        <p className="muted small">No GitHub projects found for your account.</p>
      ) : (
        <>
          {data.length > 6 && <input className="input" placeholder="Filter projects" value={filter} onChange={(e) => setFilter(e.target.value)} />}
          <div className="source-list">
            {list.map((p) => (
              <button
                key={`${p.owner}/${p.number}`}
                className={`source-item${value?.owner === p.owner && value.number === p.number ? " active" : ""}`}
                onClick={() => onPick(p)}
              >
                <Icon name="hub" size={18} />
                <span className="source-item-text">
                  <strong>{p.title}</strong>
                  <span className="muted tiny">{p.owner} · #{p.number}{p.closed ? " · closed" : ""}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function VaultPicker({ value, onPick }: { value: VaultKanban | null; onPick: (k: VaultKanban) => void }) {
  const { data, error, loading } = useLoad(boardApi.vaultKanbans);
  return (
    <div className="source-picker">
      <p className="muted small">Kanban files (Obsidian Kanban format) found in your vaults. The board stays linked to the file.</p>
      {loading ? (
        <div className="center pad"><Spinner /></div>
      ) : error ? (
        <pre className="danger-text small">{error}</pre>
      ) : !data?.length ? (
        <p className="muted small">No kanban files in your vaults yet. Create one in a vault (New kanban board) or start a fresh board instead.</p>
      ) : (
        <div className="source-list">
          {data.map((k) => (
            <button
              key={`${k.vault_id}/${k.path}`}
              className={`source-item${value?.vault_id === k.vault_id && value.path === k.path ? " active" : ""}`}
              onClick={() => onPick(k)}
            >
              <Icon name="view_kanban" size={18} />
              <span className="source-item-text">
                <strong>{k.name}</strong>
                <span className="muted tiny">{k.vault_name} · {k.path}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MergePicker({ boards, value, onChange }: { boards: BoardInfo[]; value: string[]; onChange: (ids: string[]) => void }) {
  const candidates = boards.filter((b) => b.kind !== "merged");
  return (
    <div className="source-picker">
      <p className="muted small">Pick two or more boards. Columns with the same name are shown together; changes go back to each board.</p>
      {candidates.length < 2 ? (
        <p className="muted small">You need at least two boards to merge. Create them first.</p>
      ) : (
        <div className="source-list">
          {candidates.map((b) => {
            const on = value.includes(b.id);
            return (
              <label key={b.id} className={`source-item${on ? " active" : ""}`}>
                <input type="checkbox" checked={on} onChange={() => onChange(on ? value.filter((x) => x !== b.id) : [...value, b.id])} />
                <Icon name={KIND_ICON[b.kind]} size={18} />
                <span className="source-item-text">
                  <strong>{b.name}</strong>
                  <span className="muted tiny">{KIND_LABEL[b.kind]}</span>
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------- one board
export function BoardPage({ boardId }: { boardId: string }) {
  const { boards, loaded } = useBoards();
  const board = boards.find((b) => b.id === boardId);
  useEffect(() => {
    useBoards.getState().load().catch(reportError);
  }, []);
  if (!loaded) return <div className="page center"><Spinner /></div>;
  if (!board) {
    return (
      <div className="page center">
        <div className="hero">
          <Icon name="view_kanban" size={48} />
          <h2>Board not found</h2>
          <button className="btn" onClick={() => useApp.getState().navigate({ module: "boards" })}>All boards</button>
        </div>
      </div>
    );
  }
  return board.kind === "local" || board.kind === "vault" ? (
    <MarkdownBoardPage board={board} />
  ) : (
    <LiveBoardPage board={board} sources={board.kind === "github" ? [board] : (board.config.boards ?? []).map((id) => boards.find((b) => b.id === id)).filter((b): b is BoardInfo => !!b)} />
  );
}

function BoardHeader({ board, children, menuExtra }: { board: BoardInfo; children?: React.ReactNode; menuExtra?: MenuItem[] }) {
  const boards = useBoards((s) => s.boards);
  const vaults = useApp((s) => s.vaults);
  return (
    <div className="board-head">
      <button className="icon-button" title="All boards" onClick={() => useApp.getState().navigate({ module: "boards" })}>
        <Icon name="arrow_back" size={20} />
      </button>
      <UserIcon value={board.icon ?? ""} fallback={KIND_ICON[board.kind]} size={22} />
      <div className="board-head-text">
        <h1 onDoubleClick={() => renameBoard(board)}>{board.name}</h1>
        <span className="muted tiny">{KIND_LABEL[board.kind]} · {describe(board, boards, vaults)}</span>
      </div>
      <div className="row">
        {children}
        <button className="icon-button" title="Board options" onClick={(e) => useApp.getState().showMenu(e, boardMenu(board, menuExtra))}>
          <Icon name="more_horiz" size={20} />
        </button>
      </div>
    </div>
  );
}

function MarkdownBoardPage({ board }: { board: BoardInfo }) {
  const { text, error, save, reload } = useMarkdownBoard(board);
  return (
    <div className="board-page">
      <BoardHeader board={board}>
        {board.kind === "vault" && (
          <button className="btn btn-small" onClick={() => openSource(board)} title="Open the kanban file in its vault">
            <Icon name="inventory_2" size={16} /> Open in vault
          </button>
        )}
      </BoardHeader>
      <div className="board-body">
        {error ? (
          <div className="center pad">
            <p className="danger-text">{error}</p>
            <button className="btn" onClick={reload}>Try again</button>
          </div>
        ) : text === null ? (
          <div className="center pad"><Spinner /></div>
        ) : (
          <KanbanView text={text} path={board.kind === "vault" ? board.config.path ?? "" : ""} onChange={save} />
        )}
      </div>
    </div>
  );
}

function LiveBoardPage({ board, sources }: { board: BoardInfo; sources: BoardInfo[] }) {
  const merged = board.kind === "merged";
  const { loaded, lanes, handlers, errors, reload, github } = useSources(sources, merged);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  };
  const extra = useMemo<MenuItem[]>(
    () => (github ? [{ label: "Open on GitHub", icon: "open_in_new", action: () => bridge.openExternal(github.project.url) }] : []),
    [github],
  );
  return (
    <div className="board-page">
      <BoardHeader board={board} menuExtra={extra}>
        {github && !merged && (
          <span className="muted tiny" title="Columns come from this single-select field">Columns: {github.project.field}</span>
        )}
        <button className="icon-button" title="Refresh" onClick={refresh} disabled={refreshing}>
          <Icon name="refresh" size={20} className={refreshing ? "spin" : ""} />
        </button>
      </BoardHeader>
      {errors.map((e) => (
        <div key={e.info.id} className="board-error">
          <Icon name="error" size={18} />
          <FixableError
            message={`${merged ? `${e.info.name}: ` : ""}${e.error}`}
            command={e.command}
            onFixed={() => reload(e.info.id)}
            onRetry={() => reload(e.info.id)}
          />
        </div>
      ))}
      {merged && sources.length < 2 && (
        <div className="board-error"><Icon name="info" size={18} /> <span>This merged board has fewer than two boards left.</span></div>
      )}
      <div className="board-body">
        {!loaded ? <div className="center pad"><Spinner /></div> : <LiveBoard
            lanes={lanes}
            laneNote={merged ? "Adds the column to every board in this merge" : "Adds a column to the GitHub project"}
            {...handlers}
          />}
      </div>
    </div>
  );
}
