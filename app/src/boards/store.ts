import { create } from "zustand";
import { boardApi } from "../lib/api";
import type { BoardInfo } from "../lib/boardTypes";

interface BoardsState {
  boards: BoardInfo[];
  loaded: boolean;
  load(): Promise<void>;
}

export const useBoards = create<BoardsState>((set) => ({
  boards: [],
  loaded: false,
  async load() {
    set({ boards: await boardApi.list(), loaded: true });
  },
}));

/** A board's source changed on disk (vault file or local board file): open board views reload it. */
export const SOURCE_CHANGED = "brain2:board-source-changed";
export interface SourceChange {
  vault_id?: string;
  paths?: string[];
  board_id?: string;
  origin?: string;
}
