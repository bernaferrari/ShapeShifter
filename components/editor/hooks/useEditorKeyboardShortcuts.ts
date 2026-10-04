"use client";

import { useEffect } from "react";
import { useTimelineViewSettings } from "../timeline/timelineViewSettings";
import { useEditorStore } from "@/lib/store/editorStore";

type SpaceGestureWindow = Window & {
  __ssSpacePanUsed?: boolean;
  __ssSpaceDownAt?: number;
};

export function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

/** Shared by global and canvas shortcuts so local UI keeps its keyboard input. */
export function isEditorShortcutBlocked(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || isEditableTarget(event.target)) return true;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="menubar"]')) {
    return true;
  }
  if (
    document.querySelector(
      '[role="dialog"][aria-modal="true"]:not([hidden]):not([data-closed]), [role="alertdialog"][aria-modal="true"]:not([hidden]):not([data-closed])',
    )
  ) {
    return true;
  }
  const control = target?.closest(
    'button, a[href], summary, [role="button"], [role="slider"], [role="spinbutton"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [role="combobox"], [role="listbox"], [role="option"]',
  );
  const timelineDelete =
    (event.key === "Delete" || event.key === "Backspace") &&
    target?.closest("[data-timeline-keyframe-block-id], [data-timeline-block-id]");
  const controlKey =
    [
      "Enter",
      " ",
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "Home",
      "End",
      "PageUp",
      "PageDown",
    ].includes(event.key) || event.code === "Space";
  return Boolean(control && controlKey && !event.metaKey && !event.ctrlKey && !timelineDelete);
}

/**
 * Owns application-level editor shortcuts. Canvas-local framing and escape
 * behavior stay with the canvas because they depend on its active gesture.
 */
export function useEditorKeyboardShortcuts() {
  useEffect(() => {
    let spacePressed = false;
    let handPressed = false;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditorShortcutBlocked(event)) return;

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
      if (command && event.shiftKey && key === "l") {
        event.preventDefault();
        store.toggleLayerLock(store.selectedLayerId);
        return;
      }
      if (command || event.altKey) return;

      if (!command && !event.shiftKey) {
        const toolByKey = {
          v: "select",
          a: "direct",
          d: "direct",
          p: "pen",
          l: "pencil",
          b: "paint",
          k: "knife",
          r: "rectangle",
          o: "ellipse",
        } as const;
        const nextTool = toolByKey[key as keyof typeof toolByKey];
        if (nextTool) {
          event.preventDefault();
          if (nextTool === "rectangle" || nextTool === "ellipse") store.closeActionMode();
          store.setToolMode(nextTool);
          return;
        }
        if (key === "h") {
          event.preventDefault();
          handPressed = true;
          store.setSpacePanActive(true);
          return;
        }
      }

      if (event.shiftKey && !command) {
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

      if (key === "x" && !command && !event.shiftKey) {
        event.preventDefault();
        store.splitSelectedCommand?.();
        return;
      }
      if (key === "f" && !command && !event.shiftKey && store.isActionMode) {
        event.preventDefault();
        store.setSelectedCommandAsFirst?.();
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

      if (
        (event.key === "," || event.key === "." || event.key === "<" || event.key === ">") &&
        !command
      ) {
        event.preventDefault();
        if (store.isPlaying) store.togglePlayback();
        const frames =
          (event.key === "," || event.key === "<" ? -1 : 1) * (event.shiftKey ? 10 : 1);
        const duration = Math.max(1, store.animation.duration);
        const time =
          store.progress * duration + (frames * 1000) / useTimelineViewSettings.getState().fps;
        store.setProgress(Math.max(0, Math.min(1, time / duration)));
        return;
      }

      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        const step = event.shiftKey ? 5 : 0.5;
        const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        if (store.selectionKind === "frame") store.moveFrames(store.selectedFrameIds, dx, dy);
        else if (store.selectedPoints.length > 0) {
          store.ensurePathKeyframeAtPlayhead();
          useEditorStore.getState().translateSelectedPoints(dx, dy);
        }
        else if (store.selection) {
          const point = store.getCurrentSelectedPoint();
          if (point) store.updateSelectedPoint({ x: point.x + dx, y: point.y + dy });
        } else if (store.selectedSubPaths.length > 0) store.translateSelectedSubPaths(dx, dy);
        else if (store.selectionKind === "layer") store.translateSelectedLayer(dx, dy);
        return;
      }

      if (event.code === "Space" || event.key === " ") {
        if (event.repeat || spacePressed || command || event.altKey) return;
        event.preventDefault();
        spacePressed = true;
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
      if ((event.code === "Space" || event.key === " ") && spacePressed) {
        spacePressed = false;
        const blocked = isEditorShortcutBlocked(event);
        event.preventDefault();
        const store = useEditorStore.getState();
        const gestureWindow = window as SpaceGestureWindow;
        const wasBrief = performance.now() - (gestureWindow.__ssSpaceDownAt ?? 0) < 450;
        store.setSpacePanActive(handPressed);
        if (!blocked && !gestureWindow.__ssSpacePanUsed && wasBrief) store.togglePlayback();
        delete gestureWindow.__ssSpaceDownAt;
        delete gestureWindow.__ssSpacePanUsed;
      }
      if (event.key.toLowerCase() === "h" && handPressed) {
        handPressed = false;
        useEditorStore.getState().setSpacePanActive(spacePressed);
      }
    };

    const resetPan = () => {
      spacePressed = false;
      handPressed = false;
      const gestureWindow = window as SpaceGestureWindow;
      delete gestureWindow.__ssSpaceDownAt;
      delete gestureWindow.__ssSpacePanUsed;
      useEditorStore.getState().setSpacePanActive(false);
    };
    const handleVisibilityChange = () => {
      if (document.hidden) resetPan();
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", resetPan);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", resetPan);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      resetPan();
    };
  }, []);
}
