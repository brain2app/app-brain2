// A kanban surface for boards whose cards come from elsewhere (GitHub projects, merged boards).
// The parent owns the data; this component only renders lanes and reports what the user did.
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { Modal } from "../components/Modal";
import { bridge } from "../lib/bridge";
import { renderMarkdown } from "../markdown/render";
import { type MenuItem, confirmDialog, promptDialog, useApp, useWorkspace } from "../store";

const CARD_TYPE = "application/x-brain2-live-card";

export interface LiveCard {
  id: string;
  /** Markdown cards: the whole card. GitHub cards: the title. */
  text: string;
  /** GitHub cards: the description, edited in the card dialog. */
  body?: string | null;
  /** "text": one markdown text, edited inline. "titleBody": title + description, edited in a dialog. */
  editMode?: "text" | "titleBody";
  /** Render `text` as markdown (vault/local cards) instead of plain text (GitHub titles). */
  markdown?: boolean;
  checked?: boolean;
  url?: string | null;
  /** Small line under the title, e.g. "acme/app #12". */
  sub?: string | null;
  icon?: string;
  iconClass?: string;
  labels?: { name: string; color: string }[];
  assignees?: string[];
  source?: { label: string; icon: string };
  canCheck?: boolean;
  canEdit?: boolean;
  canArchive?: boolean;
  canDelete?: boolean;
  /** e.g. "Remove from project" for GitHub issues (the issue itself stays). */
  deleteLabel?: string;
}

export interface LiveLane {
  key: string;
  title: string;
  color?: string | null;
  cards: LiveCard[];
  /** Where a new card in this lane can go (merged boards: one entry per source that has this lane). */
  addTargets: { id: string; label: string }[];
  /** Built-in lanes (GitHub's "No Status") can't be renamed or deleted. */
  fixed?: boolean;
}

export interface LiveBoardHandlers {
  onMove(cardId: string, laneKey: string): void;
  onAdd(laneKey: string, text: string, targetId: string): void;
  onToggle?(cardId: string): void;
  onEdit?(cardId: string, text: string, body?: string): void;
  onArchive?(cardId: string): void;
  onDelete?(cardId: string): void;
  onAddLane?(title: string): void;
  onRenameLane?(laneKey: string, title: string): void;
  onDeleteLane?(laneKey: string): void;
}

export function LiveBoard({ lanes, laneNote, ...h }: { lanes: LiveLane[]; laneNote?: string } & LiveBoardHandlers) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="kanban live-board">
      <div className="kanban-lanes">
        {lanes.map((lane) => (
          <LiveLaneView key={lane.key} lane={lane} h={h} />
        ))}
        {h.onAddLane && (
          <div className="kanban-add-lane">
            {adding ? (
              <CardInput
                rows={1}
                placeholder="Column name"
                onDone={(title) => {
                  setAdding(false);
                  if (title) h.onAddLane!(title);
                }}
              />
            ) : (
              <button className="kanban-add" onClick={() => setAdding(true)} title={laneNote}>
                <Icon name="add" size={18} /> Add a column
              </button>
            )}
          </div>
        )}
        {!lanes.length && !h.onAddLane && <p className="muted">This board has no columns yet.</p>}
      </div>
    </div>
  );
}

function LiveLaneView({ lane, h }: { lane: LiveLane; h: LiveBoardHandlers }) {
  const [over, setOver] = useState(false);
  const [adding, setAdding] = useState(false);
  const [target, setTarget] = useState(lane.addTargets[0]?.id ?? "");
  useEffect(() => {
    if (!lane.addTargets.some((t) => t.id === target)) setTarget(lane.addTargets[0]?.id ?? "");
  }, [lane.addTargets, target]);

  const rename = async () => {
    const title = await promptDialog("Rename column", { value: lane.title, okLabel: "Rename" });
    if (title?.trim() && title.trim() !== lane.title) h.onRenameLane?.(lane.key, title.trim());
  };
  const remove = async () => {
    const n = lane.cards.length;
    const msg = n
      ? `Delete the “${lane.title}” column? Its ${n} card${n === 1 ? "" : "s"} ${n === 1 ? "is" : "are"} deleted too (GitHub items move to “No Status”).`
      : `Delete the “${lane.title}” column?`;
    if (await confirmDialog("Delete column", msg, { okLabel: "Delete", danger: true })) h.onDeleteLane?.(lane.key);
  };
  const laneMenu: MenuItem[] = lane.fixed
    ? []
    : [
        ...(h.onRenameLane ? [{ label: "Rename column…", icon: "edit", action: rename }] : []),
        ...(h.onDeleteLane ? [{ separator: true } as MenuItem, { label: "Delete column", icon: "delete", danger: true, action: remove }] : []),
      ];

  return (
    <div
      className={`kanban-lane${over ? " lane-drop" : ""}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(CARD_TYPE)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(CARD_TYPE);
        setOver(false);
        if (!id || lane.cards.some((c) => c.id === id)) return;
        e.preventDefault();
        h.onMove(id, lane.key);
      }}
    >
      <div className="kanban-lane-header live" onDoubleClick={() => !lane.fixed && h.onRenameLane && rename()}>
        {lane.color && <span className="lane-dot" style={{ background: lane.color }} />}
        <span className="kanban-lane-title">{lane.title}</span>
        <span className="kanban-count">{lane.cards.length}</span>
        {laneMenu.length > 0 && (
          <button className="icon-button" title="Column options" onClick={(e) => useApp.getState().showMenu(e, laneMenu)}>
            <Icon name="more_horiz" size={18} />
          </button>
        )}
      </div>
      <div className="kanban-cards">
        {lane.cards.map((c) => (
          <LiveCardView key={c.id} card={c} h={h} />
        ))}
      </div>
      {lane.addTargets.length > 0 &&
        (adding ? (
          <div className="live-add">
            {lane.addTargets.length > 1 && (
              <select className="select live-add-target" value={target} onChange={(e) => setTarget(e.target.value)} title="Add to which board">
                {lane.addTargets.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            )}
            <CardInput
              placeholder="Card… (Enter to add, Shift+Enter for a new line)"
              onDone={(text, keepOpen) => {
                if (text) h.onAdd(lane.key, text, target);
                setAdding(!!keepOpen && !!text);
              }}
              keepOpen
            />
          </div>
        ) : (
          <button className="kanban-add" onClick={() => setAdding(true)}>
            <Icon name="add" size={18} /> Add a card
          </button>
        ))}
    </div>
  );
}

function LiveCardView({ card, h }: { card: LiveCard; h: LiveBoardHandlers }) {
  const [editing, setEditing] = useState(false);
  const canEdit = !!(card.canEdit && h.onEdit);
  const startEdit = () => canEdit && setEditing(true);
  const remove = async () => {
    const what = card.deleteLabel ?? "Delete card";
    const ok = await confirmDialog(what, card.deleteLabel ? `${card.deleteLabel}: “${card.text}”? The issue stays in its repository.` : `Delete “${card.text.split("\n")[0]}”?`, {
      okLabel: card.deleteLabel ? "Remove" : "Delete",
      danger: true,
    });
    if (ok) h.onDelete!(card.id);
  };
  const items: MenuItem[] = [
    ...(card.url ? [{ label: "Open on GitHub", icon: "open_in_new", action: () => bridge.openExternal(card.url!) }] : []),
    ...(canEdit ? [{ label: "Edit card", icon: "edit", action: startEdit }] : []),
    ...(card.canCheck && h.onToggle
      ? [{ label: card.checked ? "Mark as not done" : "Mark as done", icon: "check", action: () => h.onToggle!(card.id) }]
      : []),
    ...(card.canArchive && h.onArchive ? [{ label: "Archive card", icon: "archive", action: () => h.onArchive!(card.id) }] : []),
    ...(card.canDelete && h.onDelete
      ? [{ separator: true } as MenuItem, { label: card.deleteLabel ?? "Delete card", icon: "delete", danger: true, action: remove }]
      : []),
  ];

  if (editing && card.editMode !== "titleBody") {
    return (
      <div className="kanban-card editing">
        <CardInput
          initial={card.text}
          onDone={(text) => {
            setEditing(false);
            if (text && text !== card.text) h.onEdit?.(card.id, text);
          }}
        />
      </div>
    );
  }
  return (
    <>
      <div
        className={`kanban-card live-card${card.checked ? " checked" : ""}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(CARD_TYPE, card.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDoubleClick={() => (canEdit ? startEdit() : card.url && bridge.openExternal(card.url))}
        onContextMenu={(e) => {
          if (!items.length) return;
          e.preventDefault();
          useApp.getState().showMenu(e, items);
        }}
      >
        {card.canCheck && h.onToggle ? (
          <input type="checkbox" className="task-checkbox" checked={!!card.checked} onChange={() => h.onToggle!(card.id)} />
        ) : (
          card.icon && <Icon name={card.icon} size={16} className={`live-card-icon ${card.iconClass ?? ""}`} />
        )}
        <div className="live-card-main">
          {card.markdown ? <MarkdownBody text={card.text} /> : <div className="kanban-card-body">{card.text}</div>}
          {card.editMode === "titleBody" && card.body?.trim() && <div className="live-card-desc">{card.body.trim()}</div>}
          {card.sub && <div className="live-card-sub">{card.sub}</div>}
          {(card.labels?.length || card.assignees?.length || card.source) && (
            <div className="live-card-meta">
              {card.labels?.map((l) => (
                <span key={l.name} className="live-label" style={{ "--label": `#${l.color}` } as React.CSSProperties}>{l.name}</span>
              ))}
              {card.assignees?.map((a) => (
                <span key={a} className="live-assignee" title={a}>@{a}</span>
              ))}
              {card.source && (
                <span className="live-source" title={`From ${card.source.label}`}>
                  <Icon name={card.source.icon} size={12} /> {card.source.label}
                </span>
              )}
            </div>
          )}
        </div>
        {items.length > 0 && (
          <button className="icon-button kanban-card-edit" title="Card options" onClick={(e) => (e.stopPropagation(), useApp.getState().showMenu(e, items))}>
            <Icon name="more_horiz" size={15} />
          </button>
        )}
      </div>
      {editing && card.editMode === "titleBody" && (
        <CardDialog
          card={card}
          onClose={() => setEditing(false)}
          onSave={(title, body) => {
            setEditing(false);
            if (title !== card.text || body !== (card.body ?? "")) h.onEdit?.(card.id, title, body);
          }}
        />
      )}
    </>
  );
}

/** Title + description editor for GitHub cards (drafts, issues and pull requests). */
function CardDialog({ card, onClose, onSave }: { card: LiveCard; onClose: () => void; onSave: (title: string, body: string) => void }) {
  const [title, setTitle] = useState(card.text);
  const [body, setBody] = useState(card.body ?? "");
  const save = () => title.trim() && onSave(title.trim(), body);
  return (
    <Modal
      title={<><Icon name={card.icon ?? "edit"} size={20} /> Edit card</>}
      onClose={onClose}
      className="modal-medium card-dialog"
      footer={
        <>
          {card.url && (
            <button className="btn btn-small card-dialog-open" onClick={() => bridge.openExternal(card.url!)}>
              <Icon name="open_in_new" size={16} /> Open on GitHub
            </button>
          )}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!title.trim()} onClick={save}>Save</button>
        </>
      }
    >
      {card.sub && <p className="muted small">{card.sub}</p>}
      <label className="field-label" htmlFor="card-title">Title</label>
      <input id="card-title" className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
      <label className="field-label" htmlFor="card-body">Description</label>
      <textarea
        id="card-body"
        className="input card-dialog-body"
        rows={10}
        value={body}
        placeholder="Write on the card (Markdown)…"
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && save()}
      />
      <p className="muted tiny">{card.sub ? "Saved to GitHub." : "Saved to the GitHub draft."} ⌘/Ctrl+Enter saves.</p>
    </Modal>
  );
}

function MarkdownBody({ text }: { text: string }) {
  const resolver = useWorkspace((s) => s.resolver);
  const html = useMemo(() => renderMarkdown(text, { resolver, path: "" }).html, [text, resolver]);
  return (
    <div
      className="kanban-card-body markdown-rendered"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const ext = (e.target as HTMLElement).closest<HTMLAnchorElement>("a.external-link");
        if (ext) {
          e.preventDefault();
          bridge.openExternal(ext.href);
        }
      }}
    />
  );
}

/** Auto-growing textarea: Enter finishes, Shift+Enter adds a line, Escape cancels. */
export function CardInput({ initial = "", placeholder, onDone, keepOpen, rows = 2 }: {
  initial?: string;
  placeholder?: string;
  onDone: (value: string, keepOpen?: boolean) => void;
  /** After Enter, clear and stay open for the next card. */
  keepOpen?: boolean;
  rows?: number;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [value]);
  const finish = (v: string, stay = false) => {
    if (done.current) return;
    if (stay && v.trim()) {
      onDone(v.trim(), true);
      setValue("");
      return;
    }
    done.current = true;
    onDone(v.trim(), false);
  };
  return (
    <textarea
      ref={ref}
      className="kanban-input"
      rows={rows}
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          finish(value, keepOpen);
        } else if (e.key === "Escape") {
          e.preventDefault();
          done.current = true;
          onDone(initial, false); // cancel: editing keeps the old text, adding adds nothing
        }
      }}
    />
  );
}
