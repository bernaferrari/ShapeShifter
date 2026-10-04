"use client";

import { useEffect } from "react";
import { useEditorStore } from "@/lib/store/editorStore";

/**
 * Point editing always targets the shape at the playhead. Whenever the playhead,
 * tool, selection, or document changes, re-resolve which path keyframe is edited.
 */
export function usePlayheadPathEditing() {
  useEffect(
    () =>
      useEditorStore.subscribe((state, previous) => {
        if (
          state.progress === previous.progress &&
          state.toolMode === previous.toolMode &&
          state.isPlaying === previous.isPlaying &&
          state.animation === previous.animation &&
          state.selectedLayerId === previous.selectedLayerId &&
          state.selectionKind === previous.selectionKind &&
          state.selectedFrameId === previous.selectedFrameId
        )
          return;
        state.syncPathEditingWithPlayhead();
      }),
    [],
  );
}
