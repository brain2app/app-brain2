"""Boards: local markdown boards, linked vault boards, GitHub projects (mocked gh) and merged boards."""

import pytest
from fastapi.testclient import TestClient

from brain2.api.app import create_app
from brain2.boards import service as B
from brain2.config import load_config

KANBAN = "---\n\nkanban-plugin: board\n\n---\n\n## Todo\n\n- [ ] Write spec\n\n## Done\n\n**Complete**\n- [x] Ship\n"


class FakeGh:
    def __init__(self):
        self.calls = []

    def __call__(self, query, variables):
        self.calls.append((query, variables))
        if query is B.Q_LIST:
            return {"viewer": {"login": "me", "projectsV2": {"nodes": [{"number": 1, "title": "Mine", "url": "u1", "closed": False}]},
                               "organizations": {"nodes": [{"login": "acme", "projectsV2": {"nodes": [
                                   {"number": 7, "title": "Roadmap", "url": "u7", "closed": False}]}}]}}}
        if query is B.Q_PROJECT:
            return {"repositoryOwner": {"projectV2": {
                "id": "P1", "title": "Roadmap", "url": "u7", "closed": False,
                "fields": {"nodes": [{}, {"id": "F1", "name": "Status", "options": [
                    {"id": "o-todo", "name": "Todo", "color": "GRAY"}, {"id": "o-done", "name": "Done", "color": "GREEN"}]}]},
                "items": {"pageInfo": {"hasNextPage": False, "endCursor": None}, "nodes": [
                    {"id": "I1", "isArchived": False,
                     "fieldValues": {"nodes": [{"optionId": "o-todo", "field": {"id": "F1"}}]},
                     "content": {"__typename": "Issue", "title": "Bug", "number": 3, "url": "https://github.com/acme/x/issues/3",
                                 "state": "OPEN", "repository": {"nameWithOwner": "acme/x"},
                                 "assignees": {"nodes": [{"login": "me"}]}, "labels": {"nodes": [{"name": "bug", "color": "d73a4a"}]}}},
                    {"id": "I2", "isArchived": False, "fieldValues": {"nodes": []},
                     "content": {"__typename": "DraftIssue", "id": "D2", "title": "Idea", "body": "later"}},
                    {"id": "I3", "isArchived": True, "fieldValues": {"nodes": []},
                     "content": {"__typename": "DraftIssue", "id": "D3", "title": "Old", "body": ""}},
                ]}}}}
        if query is B.Q_OPTIONS:
            return {"node": {"id": "F1", "options": [
                {"id": "o-todo", "name": "Todo", "color": "GRAY", "description": ""},
                {"id": "o-done", "name": "Done", "color": "GREEN", "description": "finished"}]}}
        if query is B.M_ADD:
            return {"addProjectV2DraftIssue": {"projectItem": {"id": "I9"}}}
        return {}


@pytest.fixture
def env(tmp_path):
    gh = FakeGh()
    app = create_app(load_config(tmp_path / "home"), token=None, watch=False, gh=gh)
    with TestClient(app) as c:
        c.gh = gh
        c.home = tmp_path / "home"
        yield c


def test_local_board_lifecycle(env):
    b = env.post("/api/boards", json={"name": "Sprint", "template": "github"}).json()
    assert b["kind"] == "local"
    md = env.get(f"/api/boards/{b['id']}/content").json()["content"]
    assert "kanban-plugin: board" in md and "## In review" in md and "**Complete**" in md
    assert (env.home / "internal-boards" / f"{b['id']}.md").exists()

    env.put(f"/api/boards/{b['id']}/content", json={"content": KANBAN})
    assert env.get(f"/api/boards/{b['id']}/content").json()["content"] == KANBAN

    env.patch(f"/api/boards/{b['id']}", json={"name": "Sprint 2", "icon": "rocket"})
    assert env.get("/api/boards").json()[0]["name"] == "Sprint 2"
    env.delete(f"/api/boards/{b['id']}")
    assert env.get("/api/boards").json() == []
    assert not (env.home / "internal-boards" / f"{b['id']}.md").exists()
    assert env.post("/api/boards", json={"name": " "}).status_code == 400


def test_vault_board_links_to_kanban_file(env, tmp_path):
    root = tmp_path / "notes"
    root.mkdir()
    (root / "Plan.md").write_text(KANBAN)
    (root / "Note.md").write_text("# not a board\n")
    vault = env.post("/api/vaults", json={"name": "Notes", "path": str(root)}).json()
    found = env.get("/api/boards/sources/vault").json()
    assert found == [{"vault_id": vault["id"], "vault_name": "Notes", "path": "Plan.md", "name": "Plan"}]
    b = env.post("/api/boards", json={"name": "Plan", "kind": "vault", "config": {"vault_id": vault["id"], "path": "Plan.md"}}).json()
    assert b["config"] == {"vault_id": vault["id"], "path": "Plan.md"}
    bad = env.post("/api/boards", json={"name": "X", "kind": "vault", "config": {"vault_id": vault["id"], "path": "Nope.md"}})
    assert bad.status_code == 400
    # Deleting a linked board never touches the vault file.
    env.delete(f"/api/boards/{b['id']}")
    assert (root / "Plan.md").read_text() == KANBAN


def test_github_board(env):
    projects = env.get("/api/boards/sources/github").json()
    assert [(p["owner"], p["number"]) for p in projects] == [("me", 1), ("acme", 7)]
    b = env.post("/api/boards", json={"name": "Roadmap", "kind": "github", "config": {"owner": "acme", "number": 7}}).json()
    data = env.get(f"/api/boards/{b['id']}/github").json()
    assert data["project"]["field_id"] == "F1"
    assert [lane["title"] for lane in data["lanes"]] == ["No Status", "Todo", "Done"]
    assert data["lanes"][0]["cards"][0]["draft_id"] == "D2"  # archived item I3 hidden
    issue = data["lanes"][1]["cards"][0]
    assert issue["repo"] == "acme/x" and issue["labels"][0]["name"] == "bug" and issue["assignees"] == ["me"]

    env.post(f"/api/boards/{b['id']}/github/move", json={"project_id": "P1", "field_id": "F1", "item_id": "I1", "option_id": "o-done"})
    assert env.gh.calls[-1] == (B.M_SET, {"project": "P1", "item": "I1", "field": "F1", "option": "o-done"})
    env.post(f"/api/boards/{b['id']}/github/move", json={"project_id": "P1", "field_id": "F1", "item_id": "I1", "option_id": B.NO_STATUS})
    assert env.gh.calls[-1][0] is B.M_CLEAR
    r = env.post(f"/api/boards/{b['id']}/github/items", json={"project_id": "P1", "field_id": "F1", "title": "New", "option_id": "o-todo"})
    assert r.json() == {"id": "I9"} and env.gh.calls[-1][1]["item"] == "I9"


def test_github_errors_offer_a_fix_command(tmp_path):
    e = B.gh_error("Your token has not been granted the required scopes ... requires ['read:project']")
    assert str(e) == B.SCOPE_HELP and e.command == B.REFRESH_CMD
    assert B.gh_error("To get started with GitHub CLI, please run:  gh auth login").command == B.LOGIN_CMD
    assert B.gh_error("Could not resolve to a ProjectV2").command is None

    def boom(query, variables):
        raise B.gh_error("requires ['read:project'] scope")

    app = create_app(load_config(tmp_path / "home"), token=None, watch=False, gh=boom)
    with TestClient(app) as c:
        r = c.get("/api/boards/sources/github")
        assert r.status_code == 400 and r.json() == {"detail": B.SCOPE_HELP, "command": B.REFRESH_CMD}


def test_merged_board(env):
    a = env.post("/api/boards", json={"name": "A"}).json()
    b = env.post("/api/boards", json={"name": "B"}).json()
    assert env.post("/api/boards", json={"name": "M", "kind": "merged", "config": {"boards": [a["id"]]}}).status_code == 400
    m = env.post("/api/boards", json={"name": "M", "kind": "merged", "config": {"boards": [a["id"], b["id"], a["id"]]}}).json()
    assert m["config"]["boards"] == [a["id"], b["id"]]
    nested = env.post("/api/boards", json={"name": "N", "kind": "merged", "config": {"boards": [m["id"], a["id"]]}})
    assert nested.status_code == 400
    env.delete(f"/api/boards/{a['id']}")
    m2 = next(x for x in env.get("/api/boards").json() if x["id"] == m["id"])
    assert m2["config"]["boards"] == [b["id"]]


def test_github_edit_delete_and_columns(env):
    b = env.post("/api/boards", json={"name": "Roadmap", "kind": "github", "config": {"owner": "acme", "number": 7}}).json()
    u = f"/api/boards/{b['id']}/github"
    issue = env.get(u).json()["lanes"][1]["cards"][0]
    env.post(f"{u}/edit", json={"kind": "issue", "content_id": "X1", "title": " Fixed ", "body": "details"})
    assert env.gh.calls[-1] == (B.M_EDIT_ISSUE, {"id": "X1", "title": "Fixed", "body": "details"})
    env.post(f"{u}/edit", json={"kind": "draft", "content_id": "D2", "title": "Idea", "body": "more"})
    assert env.gh.calls[-1][0] is B.M_EDIT_DRAFT
    assert env.post(f"{u}/edit", json={"kind": "pr", "content_id": "P", "title": " "}).status_code == 400
    env.post(f"{u}/delete", json={"project_id": "P1", "item_id": issue["id"]})
    assert env.gh.calls[-1] == (B.M_DELETE, {"project": "P1", "item": "I1"})

    # Columns keep every existing option id, so cards keep their status.
    env.post(f"{u}/columns", json={"field_id": "F1", "action": "add", "name": "Review"})
    opts = env.gh.calls[-1][1]["options"]
    assert [o.get("id") for o in opts] == ["o-todo", "o-done", None] and opts[1]["description"] == "finished"
    assert opts[2]["name"] == "Review" and opts[2]["color"] in B.OPTION_COLORS
    env.post(f"{u}/columns", json={"field_id": "F1", "action": "rename", "option_id": "o-todo", "name": "Backlog"})
    assert [o["name"] for o in env.gh.calls[-1][1]["options"]] == ["Backlog", "Done"]
    env.post(f"{u}/columns", json={"field_id": "F1", "action": "delete", "option_id": "o-todo"})
    assert [o["id"] for o in env.gh.calls[-1][1]["options"]] == ["o-done"]
    assert env.post(f"{u}/columns", json={"field_id": "F1", "action": "add", "name": "done"}).status_code == 400
