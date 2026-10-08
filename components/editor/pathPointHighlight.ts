import { create } from "zustand";
import type { PointAddress } from "@/lib/pathshift/path/pointPresentation";

export type PathHighlight = {
  ownerId: string;
  layerId: string | number;
  side: "from" | "to";
  source: "canvas" | "list";
} & (
  | { kind: "point"; point: PointAddress }
  | { kind: "edge"; subPathIndex: number; commandIndex: number }
);

/** Correspondence is transient UI state. It never selects, authors, or saves geometry. */
export const usePathPointHighlight = create<{
  highlight: PathHighlight | null;
  show: (highlight: PathHighlight) => void;
  clear: (source?: PathHighlight["source"]) => void;
}>((set) => ({
  highlight: null,
  show: (highlight) =>
    set((state) =>
      JSON.stringify(state.highlight) === JSON.stringify(highlight) ? state : { highlight },
    ),
  clear: (source) =>
    set((state) =>
      source && state.highlight?.source !== source
        ? state
        : state.highlight
          ? { highlight: null }
          : state,
    ),
}));
