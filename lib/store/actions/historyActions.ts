import { PAGE_ROOT_ID } from "../../shapeshifter/scene/owners";
import type { EditorState } from "../editorStore";
import { commitDocumentV2, restoreHistoryEntry, snapshotHistoryEntry } from "../documentRuntime";
import { cloneLayers } from "../workspaceState";

type HistoryActionKey =
  | "pushHistory"
  | "beginHistoryGesture"
  | "endHistoryGesture"
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
      if (state.historyGestureActive && state.historyGesturePushed) return;
      const nextHistory = [...state.history, snapshotHistoryEntry(state)];
      set({
        history: nextHistory.slice(-100),
        future: [],
        historyCancelFuture: state.future,
        historyOverflow: nextHistory.length > 100 ? nextHistory[0]! : null,
        historyGesturePushed: state.historyGestureActive,
        canUndo: true,
        canRedo: false,
      });
    },

    beginHistoryGesture: () => {
      set({ historyGestureActive: true, historyGesturePushed: false });
    },

    endHistoryGesture: () => {
      set({ historyGestureActive: false, historyGesturePushed: false });
    },

    cancelLastHistoryTransaction: () => {
      const state = get();
      const entry = state.history.at(-1);
      if (!entry) return;
      const history = [
        ...(state.historyOverflow ? [state.historyOverflow] : []),
        ...state.history.slice(0, -1),
      ];
      const future = state.historyCancelFuture ?? [];
      set({
        ...restoreHistoryEntry(state, entry),
        history,
        future,
        historyOverflow: null,
        historyCancelFuture: null,
        historyGestureActive: false,
        historyGesturePushed: false,
        canUndo: history.length > 0,
        canRedo: future.length > 0,
      });
    },

    syncActiveOwner: (options) => {
      set((state) => {
        const next =
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
              };
        const merged = { ...state, ...next };
        return { ...next, documentV2: commitDocumentV2(merged) };
      });
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
        // Navigation neither creates nor cancels a capped push, so the displaced
        // entry stays recoverable by cancelLastHistoryTransaction.
        historyOverflow: state.historyOverflow,
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
        // Same discipline as undo: navigation never touches the overflow slot.
        historyOverflow: state.historyOverflow,
        canUndo: true,
        canRedo: state.future.length > 1,
      });
    },
  };
}
