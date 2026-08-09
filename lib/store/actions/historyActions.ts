import { PAGE_ROOT_ID } from "../../shapeshifter/scene/owners";
import type { EditorState } from "../editorStore";
import { cloneLayers, restoreHistoryEntry, snapshotHistoryEntry } from "../workspaceState";

type HistoryActionKey =
  | "pushHistory"
  | "cancelLastHistoryTransaction"
  | "syncActiveOwner"
  | "undo"
  | "redo";

type SetEditorState = (
  update: Partial<EditorState> | ((state: EditorState) => Partial<EditorState> | EditorState),
) => void;

export function createHistoryActions(
  set: SetEditorState,
  get: () => EditorState,
): Pick<EditorState, HistoryActionKey> {
  return {
    pushHistory: () => {
      const state = get();
      const nextHistory = [...state.history, snapshotHistoryEntry(state)];
      set({
        history: nextHistory.slice(-100),
        future: [],
        historyOverflow: nextHistory.length > 100 ? nextHistory[0]! : null,
        canUndo: true,
        canRedo: false,
      });
    },

    cancelLastHistoryTransaction: () => {
      const state = get();
      const entry = state.history.at(-1);
      if (!entry) return;
      const history = [
        ...(state.historyOverflow ? [state.historyOverflow] : []),
        ...state.history.slice(0, -1),
      ];
      set({
        ...restoreHistoryEntry(state, entry),
        history,
        future: [],
        historyOverflow: null,
        canUndo: history.length > 0,
        canRedo: false,
      });
    },

    syncActiveOwner: (options) => {
      set((state) =>
        state.selectedFrameId === PAGE_ROOT_ID
          ? {
              rootLayers: cloneLayers(state.layers),
              ...(options?.includeAnimation
                ? { rootAnimation: structuredClone(state.animation) }
                : {}),
            }
          : {
              frames: state.frames.map((frame) =>
                frame.id === state.selectedFrameId
                  ? {
                      ...frame,
                      layers: cloneLayers(state.layers),
                      ...(options?.includeAnimation
                        ? { animation: structuredClone(state.animation) }
                        : {}),
                    }
                  : frame,
              ),
            },
      );
    },

    undo: () => {
      const state = get();
      const entry = state.history.at(-1);
      if (!entry) return;
      const current = snapshotHistoryEntry(state);
      set({
        ...restoreHistoryEntry(state, entry),
        history: state.history.slice(0, -1),
        future: [current, ...state.future],
        historyOverflow: null,
        canUndo: state.history.length > 1,
        canRedo: true,
      });
    },

    redo: () => {
      const state = get();
      const entry = state.future[0];
      if (!entry) return;
      const current = snapshotHistoryEntry(state);
      set({
        ...restoreHistoryEntry(state, entry),
        future: state.future.slice(1),
        history: [...state.history, current],
        historyOverflow: null,
        canUndo: true,
        canRedo: state.future.length > 1,
      });
    },
  };
}
