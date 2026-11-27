export type BoardKind = "local" | "vault" | "github" | "merged";

export interface BoardInfo {
  id: string;
  name: string;
  kind: BoardKind;
  icon: string | null;
  config: { vault_id?: string; path?: string; owner?: string; number?: number; field?: string | null; boards?: string[] };
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type BoardTemplate = "basic" | "github" | "empty";

export interface VaultKanban {
  vault_id: string;
  vault_name: string;
  path: string;
  name: string;
}

export interface GhProjectRef {
  owner: string;
  number: number;
  title: string;
  url: string;
  closed: boolean;
}

export interface GhCard {
  id: string;
  kind: "issue" | "pr" | "draft" | "redacted";
  title: string;
  body: string | null;
  draft_id: string | null;
  content_id: string | null;
  number: number | null;
  url: string | null;
  state: string | null;
  repo: string | null;
  assignees: string[];
  labels: { name: string; color: string }[];
}

export interface GhLane {
  id: string;
  title: string;
  color: string | null;
  cards: GhCard[];
}

export interface GhBoard {
  project: { id: string; title: string; url: string; field: string; field_id: string };
  lanes: GhLane[];
  fields: string[];
}
