import type { SetStateAction } from "react";
import { create } from "zustand";

/**
 * One expand/collapse state for every layer list. The Layers panel and the
 * timeline both list the same tree, so collapsing a group in one collapses it
 * in the other, like a single outline. Groups are keyed `${ownerId}:${layerId}`.
 */
interface LayerTreeExpansion {
  collapsedOwners: Set<string>;
  collapsedGroups: Set<string>;
  setCollapsedOwners: (update: SetStateAction<Set<string>>) => void;
  setCollapsedGroups: (update: SetStateAction<Set<string>>) => void;
}

export const layerGroupKey = (ownerId: string, layerId: string | number) =>
  `${ownerId}:${String(layerId)}`;

export const useLayerTreeExpansion = create<LayerTreeExpansion>()((set) => ({
  collapsedOwners: new Set(),
  collapsedGroups: new Set(),
  setCollapsedOwners: (update) =>
    set((state) => ({
      collapsedOwners: typeof update === "function" ? update(state.collapsedOwners) : update,
    })),
  setCollapsedGroups: (update) =>
    set((state) => ({
      collapsedGroups: typeof update === "function" ? update(state.collapsedGroups) : update,
    })),
}));
