"use client";

import { useEffect } from "react";
import { useEditorStore } from "@/lib/store/editorStore";

type SpaceGestureWindow = Window & {
  __ssSpacePanUsed?: boolean;
  __ssSpaceDownAt?: number;
};

export function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

/**
 * Owns application-level editor shortcuts. Canvas-local framing and escape
 * behavior stay with the canvas because they depend on its active gesture.
 */
export function useEditorKeyboardShortcuts() {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      const store = useEditorStore.getState();
      const key = event.key.toLowerCase();
      const command = event.metaKey || event.ctrlKey;

      if (command && key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          if (store.canRedo) store.redo();
        } else if (store.canUndo) {
          store.undo();
        }
        return;
      }

      if (!event.metaKey) {
        const toolByKey = {
          v: "select",
          a: "direct",
          d: "direct",
          p: "pen",
          l: "pencil",
          b: "paint",
          k: "knife",
        } as const;
        const nextTool = toolByKey[key as keyof typeof toolByKey];
        if (nextTool) {
          event.preventDefault();
          store.setToolMode(nextTool);
          return;
        }
        if (key === "h") {
          event.preventDefault();
          store.setSpacePanActive(true);
          return;
        }
      }

      if (event.shiftKey && !event.metaKey) {
        if (key === "r") {
          event.preventDefault();
          store.reverseSelectedLayer();
          return;
        }
        if (key === "s") {
          event.preventDefault();
          store.shiftSelectedLayer(1);
          return;
        }
        if (key === "f") {
          event.preventDefault();
          store.autoFixSelectedLayer();
          return;
        }
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        const keyframeTarget =
          event.target instanceof HTMLElement
            ? event.target.closest<HTMLElement>("[data-timeline-keyframe-block-id]")
            : null;
        const keyframeBlockId = keyframeTarget?.dataset.timelineKeyframeBlockId;
        const keyframeEdge = keyframeTarget?.dataset.timelineKeyframeEdge;
        if (keyframeBlockId && (keyframeEdge === "start" || keyframeEdge === "end")) {
          store.removeTimelineKeyframe(keyframeBlockId, keyframeEdge);
        } else if (store.selectedBlockIds.length > 0) {
          store.removeTimelineBlocks(store.selectedBlockIds);
        } else if (store.selectedPoints.length > 0 || store.selection) store.deleteSelectedPoint();
        else if (store.selectedSubPaths.length > 0) store.deleteSelectedSubPath();
        else if (store.selectionKind === "layer") store.deleteSelectedLayers();
        return;
      }

      if (key === "x" && !event.metaKey && !event.shiftKey) {
        event.preventDefault();
        store.splitSelectedCommand?.();
        return;
      }
      if (key === "f" && !command && !event.shiftKey && store.isActionMode) {
        event.preventDefault();
        store.setSelectedCommandAsFirst?.();
        return;
      }
      if (command && key === "w") {
        event.preventDefault();
        store.closeActionMode?.();
        return;
      }
      if (command && key === "g") {
        event.preventDefault();
        if (event.shiftKey) store.ungroupSelectedLayer();
        else store.groupSelectedLayers();
        return;
      }
      if (event.key === "]" && !command) {
        event.preventDefault();
        store.nudgeLayerZOrder(store.selectedLayerId, 1);
        return;
      }
      if (event.key === "[" && !command) {
        event.preventDefault();
        store.nudgeLayerZOrder(store.selectedLayerId, -1);
        return;
      }
      if (command && event.shiftKey && key === "l") {
        event.preventDefault();
        store.toggleLayerLock(store.selectedLayerId);
        return;
      }

      const selectedIds =
        store.selectedLayerIds.length > 0 ? store.selectedLayerIds : [store.selectedLayerId];
      if (command && key === "c") {
        event.preventDefault();
        store.copyLayers?.(selectedIds);
        return;
      }
      if (command && key === "v") {
        event.preventDefault();
        store.pasteLayers?.();
        return;
      }
      if (command && key === "x") {
        event.preventDefault();
        store.cutLayers?.(selectedIds);
        return;
      }
      if (command && !event.shiftKey && key === "d") {
        event.preventDefault();
        store.copyLayers?.(selectedIds);
        store.pasteLayers?.();
        return;
      }

      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        const step = event.shiftKey ? 5 : 0.5;
        const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        if (store.selectedPoints.length > 0) store.translateSelectedPoints(dx, dy);
        else if (store.selection) {
          const point = store.getCurrentSelectedPoint();
          if (point) store.updateSelectedPoint({ x: point.x + dx, y: point.y + dy });
        } else if (store.selectedSubPaths.length > 0) store.translateSelectedSubPaths(dx, dy);
        else store.translateSelectedLayer(dx, dy);
        return;
      }

      if (event.code === "Space" || event.key === " ") {
        if (event.repeat) return;
        event.preventDefault();
        store.setSpacePanActive(true);
        const gestureWindow = window as SpaceGestureWindow;
        gestureWindow.__ssSpacePanUsed = false;
        gestureWindow.__ssSpaceDownAt = performance.now();
        return;
      }

      if (store.isActionMode && !event.shiftKey && !command && event.key === "1") {
        event.preventDefault();
        store.setEditingSide("from");
        return;
      }
      if (store.isActionMode && !event.shiftKey && !command && event.key === "2") {
        event.preventDefault();
        store.setEditingSide("to");
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (event.code === "Space" || event.key === " ") {
        event.preventDefault();
        const store = useEditorStore.getState();
        const gestureWindow = window as SpaceGestureWindow;
        const wasBrief = performance.now() - (gestureWindow.__ssSpaceDownAt ?? 0) < 450;
        store.setSpacePanActive(false);
        if (!gestureWindow.__ssSpacePanUsed && wasBrief) store.togglePlayback();
      }
      if (event.key.toLowerCase() === "h" && !event.metaKey) {
        useEditorStore.getState().setSpacePanActive(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);
}
