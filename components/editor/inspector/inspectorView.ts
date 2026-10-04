import { create } from "zustand";

/** UI-only: which view the properties panel shows. Never part of the document. */
interface InspectorViewState {
  easingBlockId: string | null;
  openEasing: (blockId: string) => void;
  close: () => void;
}

export const useInspectorView = create<InspectorViewState>()((set) => ({
  easingBlockId: null,
  openEasing: (easingBlockId) => set({ easingBlockId }),
  close: () => set({ easingBlockId: null }),
}));
