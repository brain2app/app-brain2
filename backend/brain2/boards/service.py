"""Boards: kanban boards of four kinds.

* ``local``  — a markdown board in ``<home>/internal-boards/<id>.md`` (Obsidian Kanban plugin format).
* ``vault``  — linked to a kanban file inside a vault; edits go straight to that file.
* ``github`` — live view of a GitHub Project (v2) through the user's ``gh`` CLI. Columns are the
  options of a single-select field (``Status`` by default); moving a card sets that field on GitHub.
* ``merged`` — several boards shown together, columns matched by name. Edits go back to each source.

Markdown parsing/serializing lives in the UI (``app/src/kanban/format.ts``); the backend only stores
files, so local and vault boards stay plain markdown the user can open anywhere.
"""

from __future__ import annotations

import json
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from .. import gitcli
from ..db import Database

SCHEMA = """
CREATE TABLE IF NOT EXISTS boards (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL,           -- local | vault | github | merged
  icon        TEXT,
  config      TEXT NOT NULL DEFAULT '{}',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
"""

KINDS = ("local", "vault", "github", "merged")

TEMPLATES: dict[str, list[tuple[str, bool]]] = {
    "basic": [("To do", False), ("Doing", False), ("Done", True)],
    "github": [("Backlog", False), ("Ready", False), ("In progress", False), ("In review", False), ("Done", True)],
    "empty": [],
}

SCOPE_HELP = "The GitHub CLI (gh) needs permission to read and update your projects."
LOGIN_HELP = "Sign in to GitHub with the GitHub CLI (gh) to use GitHub boards."
INSTALL_HELP = "GitHub boards use the GitHub CLI (gh), which isn't installed."


class BoardError(Exception):
    status = 400

    def __init__(self, message: str, command: list[str] | None = None):
        super().__init__(message)
        #: A command that fixes the problem; the UI offers to run it in the built-in terminal.
        self.command = command


REFRESH_CMD = ["gh", "auth", "refresh", "-h", "github.com", "-s", "project"]
LOGIN_CMD = ["gh", "auth", "login", "-h", "github.com", "-s", "project"]


def _install_gh_cmd() -> list[str] | None:
    if sys.platform == "darwin" and gitcli.which("brew"):
        return ["brew", "install", "gh"]
    if sys.platform == "win32" and gitcli.which("winget"):
        return ["winget", "install", "--id", "GitHub.cli"]
    return None


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def board_markdown(template: str) -> str:
    """A new markdown board in the Obsidian Kanban plugin format."""
    lanes = TEMPLATES.get(template)
    if lanes is None:
        raise BoardError(f"Unknown template: {template}")
    out = ["---", "", "kanban-plugin: board", "", "---", ""]
    for title, complete in lanes:
        out += [f"## {title}", ""]
        if complete:
            out.append("**Complete**")
        out += ["", ""]
    out += ["%% kanban:settings", "```", '{"kanban-plugin":"board"}', "```", "%%", ""]
    return "\n".join(out)


GhRunner = Callable[[str, dict[str, Any]], dict[str, Any]]


def gh_graphql(query: str, variables: dict[str, Any]) -> dict[str, Any]:
    """Run a GraphQL request with the user's ``gh`` login."""
    if not gitcli.which("gh"):
        raise BoardError(INSTALL_HELP, _install_gh_cmd())
    try:
        out = gitcli.run(["gh", "api", "graphql", "--input", "-"],
                         input=json.dumps({"query": query, "variables": variables}), timeout=40)
    except gitcli.GitError as e:
        raise gh_error(str(e)) from e
    data = json.loads(out or "{}")
    if data.get("errors"):
        raise gh_error("; ".join(err.get("message", "") for err in data["errors"]))
    return data.get("data") or {}


def gh_error(msg: str) -> BoardError:
    """Turn a gh failure into a message, plus the command that fixes it when there is one."""
    low = msg.lower()
    if "scope" in low and "project" in low:
        return BoardError(SCOPE_HELP, REFRESH_CMD)
    if "gh auth login" in low or "not logged" in low or "authentication" in low:
        return BoardError(LOGIN_HELP, LOGIN_CMD)
    return BoardError(msg.strip() or "GitHub request failed")


# --------------------------------------------------------------------------- GitHub GraphQL
_PROJECT_FIELDS = """
  id title url closed
  fields(first: 50) { nodes { ... on ProjectV2SingleSelectField { id name options { id name color description } } } }
"""

Q_LIST = """
query {
  viewer {
    login
    projectsV2(first: 50) { nodes { number title url closed } }
    organizations(first: 50) { nodes { login projectsV2(first: 50) { nodes { number title url closed } } } }
  }
}"""

Q_PROJECT = """
query($owner: String!, $number: Int!, $after: String) {
  repositoryOwner(login: $owner) {
    ... on ProjectV2Owner {
      projectV2(number: $number) {
        %s
        items(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id isArchived
            fieldValues(first: 30) { nodes {
              ... on ProjectV2ItemFieldSingleSelectValue { optionId field { ... on ProjectV2SingleSelectField { id } } }
            } }
            content {
              __typename
              ... on DraftIssue { id title body }
              ... on Issue { id title body number url state repository { nameWithOwner }
                             assignees(first: 5) { nodes { login } } labels(first: 10) { nodes { name color } } }
              ... on PullRequest { id title body number url state repository { nameWithOwner }
                                   assignees(first: 5) { nodes { login } } labels(first: 10) { nodes { name color } } }
            }
          }
        }
      }
    }
  }
}""" % _PROJECT_FIELDS

M_SET = """
mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
  updateProjectV2ItemFieldValue(input: {projectId: $project, itemId: $item, fieldId: $field,
                                        value: {singleSelectOptionId: $option}}) { projectV2Item { id } }
}"""
M_CLEAR = """
mutation($project: ID!, $item: ID!, $field: ID!) {
  clearProjectV2ItemFieldValue(input: {projectId: $project, itemId: $item, fieldId: $field}) { projectV2Item { id } }
}"""
M_ADD = """
mutation($project: ID!, $title: String!, $body: String) {
  addProjectV2DraftIssue(input: {projectId: $project, title: $title, body: $body}) { projectItem { id } }
}"""
M_EDIT_DRAFT = """
mutation($draft: ID!, $title: String!, $body: String) {
  updateProjectV2DraftIssue(input: {draftIssueId: $draft, title: $title, body: $body}) { draftIssue { id } }
}"""
M_EDIT_ISSUE = """
mutation($id: ID!, $title: String!, $body: String) {
  updateIssue(input: {id: $id, title: $title, body: $body}) { issue { id } }
}"""
M_EDIT_PR = """
mutation($id: ID!, $title: String!, $body: String) {
  updatePullRequest(input: {pullRequestId: $id, title: $title, body: $body}) { pullRequest { id } }
}"""
M_DELETE = """
mutation($project: ID!, $item: ID!) {
  deleteProjectV2Item(input: {projectId: $project, itemId: $item}) { deletedItemId }
}"""
Q_OPTIONS = """
query($field: ID!) {
  node(id: $field) { ... on ProjectV2SingleSelectField { id options { id name color description } } }
}"""
# Sending every existing option back *with its id* keeps the cards' values; the list replaces the old one.
M_OPTIONS = """
mutation($field: ID!, $options: [ProjectV2SingleSelectFieldOptionInput!]) {
  updateProjectV2Field(input: {fieldId: $field, singleSelectOptions: $options}) { projectV2Field { ... on ProjectV2SingleSelectField { id } } }
}"""
OPTION_COLORS = ("GRAY", "BLUE", "GREEN", "YELLOW", "ORANGE", "RED", "PINK", "PURPLE")
M_ARCHIVE = """
mutation($project: ID!, $item: ID!) {
  archiveProjectV2Item(input: {projectId: $project, itemId: $item}) { item { id } }
}"""

NO_STATUS = "__none__"


class BoardService:
    def __init__(self, db: Database, home: Path, publish: Callable[[dict], None] | None = None,
                 gh: GhRunner | None = None):
        self.db = db
        self.dir = Path(home) / "internal-boards"
        self.publish = publish or (lambda ev: None)
        self.gh = gh or gh_graphql
        with db._lock:  # noqa: SLF001
            db._conn.executescript(SCHEMA)  # noqa: SLF001

    # ---------------------------------------------------------------- boards
    def _row(self, bid: str) -> dict[str, Any]:
        row = self.db.one("SELECT * FROM boards WHERE id = ?", (bid,))
        if not row:
            err = BoardError("Board not found")
            err.status = 404
            raise err
        d = dict(row)
        d["config"] = json.loads(d["config"] or "{}")
        return d

    def _file(self, bid: str) -> Path:
        return self.dir / f"{bid}.md"

    def list(self) -> list[dict[str, Any]]:
        out = []
        for r in self.db.query("SELECT * FROM boards ORDER BY sort_order, name COLLATE NOCASE"):
            d = dict(r)
            d["config"] = json.loads(d["config"] or "{}")
            out.append(d)
        return out

    def get(self, bid: str) -> dict[str, Any]:
        return self._row(bid)

    def _check_config(self, kind: str, config: dict[str, Any]) -> dict[str, Any]:
        if kind == "vault":
            if not config.get("vault_id") or not config.get("path"):
                raise BoardError("Pick a kanban file from a vault")
            row = self.db.one("SELECT 1 FROM files WHERE vault_id = ? AND path = ?", (config["vault_id"], config["path"]))
            if not row:
                raise BoardError("That vault file no longer exists")
            return {"vault_id": config["vault_id"], "path": config["path"]}
        if kind == "github":
            owner, number = str(config.get("owner") or "").strip(), config.get("number")
            if not owner or not isinstance(number, int):
                raise BoardError("Pick a GitHub project")
            return {"owner": owner, "number": number, "field": (config.get("field") or "").strip() or None}
        if kind == "merged":
            ids = [i for i in dict.fromkeys(config.get("boards") or []) if isinstance(i, str)]
            if len(ids) < 2:
                raise BoardError("Pick at least two boards to merge")
            for i in ids:
                if self._row(i)["kind"] == "merged":
                    raise BoardError("A merged board can't include another merged board")
            return {"boards": ids}
        return {}

    def create(self, name: str, kind: str, config: dict[str, Any] | None = None, template: str = "basic",
               icon: str | None = None) -> dict[str, Any]:
        name = (name or "").strip()
        if not name:
            raise BoardError("Give the board a name")
        if kind not in KINDS:
            raise BoardError(f"Unknown board type: {kind}")
        cfg = self._check_config(kind, config or {})
        bid = uuid.uuid4().hex[:12]
        if kind == "local":
            self.dir.mkdir(parents=True, exist_ok=True)
            self._file(bid).write_text(board_markdown(template), encoding="utf-8")
        count = (self.db.one("SELECT COUNT(*) AS n FROM boards") or {"n": 0})["n"]
        ts = now_iso()
        self.db.execute("INSERT INTO boards(id, name, kind, icon, config, sort_order, created_at, updated_at) "
                        "VALUES (?,?,?,?,?,?,?,?)", (bid, name, kind, icon, json.dumps(cfg), count, ts, ts))
        self.publish({"type": "boards.changed"})
        return self.get(bid)

    def update(self, bid: str, name: str | None = None, icon: str | None = None,
               config: dict[str, Any] | None = None, sort_order: int | None = None) -> dict[str, Any]:
        row = self._row(bid)
        sets, params = [], []
        if name is not None and name.strip():
            sets.append("name = ?")
            params.append(name.strip())
        if icon is not None:
            sets.append("icon = ?")
            params.append(icon or None)
        if sort_order is not None:
            sets.append("sort_order = ?")
            params.append(sort_order)
        if config is not None:
            sets.append("config = ?")
            params.append(json.dumps(self._check_config(row["kind"], {**row["config"], **config})))
        if sets:
            self.db.execute(f"UPDATE boards SET {', '.join(sets)}, updated_at = ? WHERE id = ?", (*params, now_iso(), bid))
            self.publish({"type": "boards.changed"})
        return self.get(bid)

    def delete(self, bid: str) -> None:
        row = self._row(bid)
        self.db.execute("DELETE FROM boards WHERE id = ?", (bid,))
        if row["kind"] == "local":
            self._file(bid).unlink(missing_ok=True)
        # Drop it from merged boards; a merged board left with < 2 sources keeps what remains.
        for m in self.db.query("SELECT id, config FROM boards WHERE kind = 'merged'"):
            cfg = json.loads(m["config"] or "{}")
            if bid in cfg.get("boards", []):
                cfg["boards"] = [i for i in cfg["boards"] if i != bid]
                self.db.execute("UPDATE boards SET config = ? WHERE id = ?", (json.dumps(cfg), m["id"]))
        self.publish({"type": "boards.changed"})

    # ---------------------------------------------------------------- local markdown
    def content(self, bid: str) -> dict[str, Any]:
        row = self._row(bid)
        if row["kind"] != "local":
            raise BoardError("Only local boards store their own file")
        f = self._file(bid)
        if not f.exists():
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(board_markdown("basic"), encoding="utf-8")
        return {"content": f.read_text(encoding="utf-8"), "mtime": f.stat().st_mtime}

    def save_content(self, bid: str, content: str) -> dict[str, Any]:
        row = self._row(bid)
        if row["kind"] != "local":
            raise BoardError("Only local boards store their own file")
        f = self._file(bid)
        f.parent.mkdir(parents=True, exist_ok=True)
        tmp = f.with_suffix(".md.tmp")
        tmp.write_text(content, encoding="utf-8")
        tmp.replace(f)
        self.db.execute("UPDATE boards SET updated_at = ? WHERE id = ?", (now_iso(), bid))
        self.publish({"type": "board.content", "board_id": bid})
        return {"mtime": f.stat().st_mtime}

    # ---------------------------------------------------------------- vault kanban files
    def vault_candidates(self) -> list[dict[str, Any]]:
        rows = self.db.query(
            "SELECT f.vault_id, f.path, f.name, f.frontmatter, v.name AS vault_name FROM files f "
            "JOIN vaults v ON v.id = f.vault_id WHERE f.kind = 'markdown' AND f.frontmatter LIKE '%kanban-plugin%' "
            "ORDER BY v.name COLLATE NOCASE, f.path COLLATE NOCASE")
        out = []
        for r in rows:
            try:
                fm = json.loads(r["frontmatter"] or "{}")
            except ValueError:
                continue
            if isinstance(fm, dict) and "kanban-plugin" in fm:
                out.append({"vault_id": r["vault_id"], "vault_name": r["vault_name"], "path": r["path"],
                            "name": r["name"].rsplit(".", 1)[0]})
        return out

    # ---------------------------------------------------------------- GitHub projects
    def github_projects(self) -> list[dict[str, Any]]:
        v = (self.gh(Q_LIST, {}) or {}).get("viewer") or {}
        out = []
        for p in (v.get("projectsV2") or {}).get("nodes") or []:
            if p:
                out.append({**p, "owner": v.get("login")})
        for org in (v.get("organizations") or {}).get("nodes") or []:
            for p in ((org or {}).get("projectsV2") or {}).get("nodes") or []:
                if p:
                    out.append({**p, "owner": org["login"]})
        return out

    def _gh_cfg(self, bid: str) -> dict[str, Any]:
        row = self._row(bid)
        if row["kind"] != "github":
            raise BoardError("Not a GitHub board")
        return row["config"]

    def github_board(self, bid: str) -> dict[str, Any]:
        cfg = self._gh_cfg(bid)
        project, items, after = None, [], None
        for _ in range(20):  # at most 2000 items
            data = self.gh(Q_PROJECT, {"owner": cfg["owner"], "number": cfg["number"], "after": after})
            project = ((data.get("repositoryOwner") or {}).get("projectV2"))
            if not project:
                raise BoardError(f"GitHub project {cfg['owner']} #{cfg['number']} was not found (or you have no access)")
            page = project["items"]
            items += page["nodes"] or []
            if not page["pageInfo"]["hasNextPage"]:
                break
            after = page["pageInfo"]["endCursor"]
        selects = [f for f in (project["fields"]["nodes"] or []) if f and f.get("options") is not None]
        if not selects:
            raise BoardError("This project has no single-select field (like Status) to use as columns")
        want = (cfg.get("field") or "Status").lower()
        field = next((f for f in selects if f["name"].lower() == want), selects[0])
        lanes = [{"id": NO_STATUS, "title": f"No {field['name']}", "color": None, "cards": []}]
        lanes += [{"id": o["id"], "title": o["name"], "color": o.get("color"), "cards": []} for o in field["options"]]
        by_id = {lane["id"]: lane for lane in lanes}
        for it in items:
            if not it or it.get("isArchived"):
                continue
            option = next((fv["optionId"] for fv in (it.get("fieldValues") or {}).get("nodes") or []
                           if fv and (fv.get("field") or {}).get("id") == field["id"]), None)
            c = it.get("content") or {}
            kind = {"DraftIssue": "draft", "Issue": "issue", "PullRequest": "pr"}.get(c.get("__typename"), "redacted")
            by_id.get(option or NO_STATUS, lanes[0])["cards"].append({
                "id": it["id"],
                "kind": kind,
                "title": c.get("title") or "(no access to this item)",
                "body": c.get("body"),
                "draft_id": c.get("id") if kind == "draft" else None,
                "content_id": c.get("id"),
                "number": c.get("number"),
                "url": c.get("url"),
                "state": c.get("state"),
                "repo": (c.get("repository") or {}).get("nameWithOwner"),
                "assignees": [a["login"] for a in ((c.get("assignees") or {}).get("nodes") or []) if a],
                "labels": [lb for lb in ((c.get("labels") or {}).get("nodes") or []) if lb],
            })
        if not lanes[0]["cards"]:
            lanes = lanes[1:]
        return {"project": {"id": project["id"], "title": project["title"], "url": project["url"],
                            "field": field["name"], "field_id": field["id"]}, "lanes": lanes,
                "fields": [f["name"] for f in selects]}

    def github_move(self, bid: str, project_id: str, field_id: str, item_id: str, option_id: str | None) -> None:
        self._gh_cfg(bid)
        if option_id and option_id != NO_STATUS:
            self.gh(M_SET, {"project": project_id, "item": item_id, "field": field_id, "option": option_id})
        else:
            self.gh(M_CLEAR, {"project": project_id, "item": item_id, "field": field_id})

    def github_add(self, bid: str, project_id: str, field_id: str, title: str, body: str | None,
                   option_id: str | None) -> str:
        self._gh_cfg(bid)
        title = (title or "").strip()
        if not title:
            raise BoardError("Give the card a title")
        res = self.gh(M_ADD, {"project": project_id, "title": title, "body": body or ""})
        item = res["addProjectV2DraftIssue"]["projectItem"]["id"]
        if option_id and option_id != NO_STATUS:
            self.gh(M_SET, {"project": project_id, "item": item, "field": field_id, "option": option_id})
        return item

    def github_edit_draft(self, bid: str, draft_id: str, title: str, body: str | None) -> None:
        self._gh_cfg(bid)
        if not (title or "").strip():
            raise BoardError("Give the card a title")
        self.gh(M_EDIT_DRAFT, {"draft": draft_id, "title": title.strip(), "body": body or ""})

    def github_archive(self, bid: str, project_id: str, item_id: str) -> None:
        self._gh_cfg(bid)
        self.gh(M_ARCHIVE, {"project": project_id, "item": item_id})

    def github_edit(self, bid: str, kind: str, content_id: str, title: str, body: str | None) -> None:
        """Change a card's title and text: drafts in the project, issues/PRs in their repository."""
        self._gh_cfg(bid)
        title = (title or "").strip()
        if not title:
            raise BoardError("Give the card a title")
        if kind == "draft":
            self.gh(M_EDIT_DRAFT, {"draft": content_id, "title": title, "body": body or ""})
        elif kind == "issue":
            self.gh(M_EDIT_ISSUE, {"id": content_id, "title": title, "body": body or ""})
        elif kind == "pr":
            self.gh(M_EDIT_PR, {"id": content_id, "title": title, "body": body or ""})
        else:
            raise BoardError("You don't have access to edit this item")

    def github_delete(self, bid: str, project_id: str, item_id: str) -> None:
        """Remove an item from the project (a draft is deleted; an issue/PR stays in its repository)."""
        self._gh_cfg(bid)
        self.gh(M_DELETE, {"project": project_id, "item": item_id})

    def github_column(self, bid: str, field_id: str, action: str, name: str | None = None,
                      option_id: str | None = None) -> None:
        """Add, rename or delete a column (an option of the board's single-select field)."""
        self._gh_cfg(bid)
        node = (self.gh(Q_OPTIONS, {"field": field_id}) or {}).get("node") or {}
        current = node.get("options")
        if current is None:
            raise BoardError("This project's column field was not found")
        opts = [{"id": o["id"], "name": o["name"], "color": o.get("color") or "GRAY", "description": o.get("description") or ""}
                for o in current]
        name = (name or "").strip()
        if action == "add":
            if not name:
                raise BoardError("Give the column a name")
            if any(o["name"].lower() == name.lower() for o in opts):
                raise BoardError(f"There is already a “{name}” column")
            opts.append({"name": name, "color": OPTION_COLORS[len(opts) % len(OPTION_COLORS)], "description": ""})
        elif action == "rename":
            if not name:
                raise BoardError("Give the column a name")
            target = next((o for o in opts if o["id"] == option_id), None)
            if not target:
                raise BoardError("That column no longer exists")
            target["name"] = name
        elif action == "delete":
            if not any(o["id"] == option_id for o in opts):
                raise BoardError("That column no longer exists")
            if len(opts) == 1:
                raise BoardError("A GitHub project needs at least one column")
            opts = [o for o in opts if o["id"] != option_id]
        else:
            raise BoardError(f"Unknown column action: {action}")
        self.gh(M_OPTIONS, {"field": field_id, "options": opts})
