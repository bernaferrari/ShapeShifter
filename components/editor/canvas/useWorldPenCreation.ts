"use client";
import { useCallback, type RefObject } from "react";
import { useEditorStore } from "@/lib/store/editorStore";
import {
  historySessionFromEditor,
  workspaceFromEditor,
  restoreHistoryEntry,
} from "@/lib/store/documentRuntime";
import { stageAgentCommands } from "@/lib/agent/commands";
import { PAGE_ROOT_ID } from "@/lib/pathshift/scene/owners";
import { snapValueToStep } from "@/lib/pathshift/camera";
import type { Point } from "@/lib/pathshift/types";

export function useWorldPenCreation({
  activeSubpathRef,
  beginPath,
  hitArtboard,
  snapStep,
}: {
  activeSubpathRef: RefObject<number | null>;
  beginPath: (anchor: Point) => void;
  hitArtboard: (point: Point) => string | null;
  snapStep: number;
}) {
  return useCallback(
    (point: Point, bypassSnap: boolean) => {
      const state = useEditorStore.getState();
      if (state.toolMode !== "pen" || state.isActionMode || activeSubpathRef.current != null)
        return false;
      const ownerId = hitArtboard(point) ?? PAGE_ROOT_ID;
      const frame = state.frames.find((item) => item.id === ownerId);
      if (ownerId !== PAGE_ROOT_ID && !frame) return false;
      const local = { x: point.x - (frame?.x ?? 0), y: point.y - (frame?.y ?? 0) };
      if (state.snapToGrid && !bypassSnap) {
        local.x = snapValueToStep(local.x, snapStep);
        local.y = snapValueToStep(local.y, snapStep);
      }
      const staged = stageAgentCommands(workspaceFromEditor(state), [
        { type: "createPath", ownerId, name: "Path", d: `M${local.x} ${local.y}` },
      ]);
      state.pushHistory();
      useEditorStore.setState(
        restoreHistoryEntry(state, {
          document: staged.document,
          session: historySessionFromEditor(state),
        }),
      );
      const next = useEditorStore.getState();
      next.selectLayerRefs(staged.created);
      useEditorStore
        .getState()
        .updateSelectedLayer(
          { fillColor: "none", strokeColor: "#000000", strokeWidth: 1 },
          { recordHistory: false },
        );
      useEditorStore.getState().setToolMode("pen");
      beginPath(local);
      return true;
    },
    [activeSubpathRef, beginPath, hitArtboard, snapStep],
  );
}
