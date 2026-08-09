"use client";

import React from "react";

interface WorldCanvasShortcutOptions {
  enabled: boolean;
  penActiveSubpathRef: React.RefObject<number | null>;
  finishPen: () => void;
  hasObjectDrag: () => boolean;
  cancelObjectDrag: () => void;
  hasLayerTransform: () => boolean;
  cancelLayerTransform: () => void;
  hasFrameResize: () => boolean;
  cancelFrameResize: () => void;
  hasWorldPointDrag: () => boolean;
  cancelWorldPointEditing: () => void;
  isDraggingArtboards: boolean;
  cancelArtboardDrag: () => void;
  isWorldPanning: boolean;
  cancelWorldPan: () => void;
  isPointTool: boolean;
  isObjectTool: boolean;
  exitPointMode: () => void;
  clearObjectSelection: () => void;
  fitWorldToFrames: () => void;
  fitWorldToSelection: () => void;
  resetWorldZoom: () => void;
  zoomWorldAtCenter: (factor: number) => void;
}

function isTextEntryTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;
  return (
    element?.tagName === "INPUT" || element?.tagName === "TEXTAREA" || element?.isContentEditable
  );
}

/** Owns freeform-canvas keyboard semantics and gesture cancellation order. */
export function useWorldCanvasShortcuts({
  enabled,
  penActiveSubpathRef,
  finishPen,
  hasObjectDrag,
  cancelObjectDrag,
  hasLayerTransform,
  cancelLayerTransform,
  hasFrameResize,
  cancelFrameResize,
  hasWorldPointDrag,
  cancelWorldPointEditing,
  isDraggingArtboards,
  cancelArtboardDrag,
  isWorldPanning,
  cancelWorldPan,
  isPointTool,
  isObjectTool,
  exitPointMode,
  clearObjectSelection,
  fitWorldToFrames,
  fitWorldToSelection,
  resetWorldZoom,
  zoomWorldAtCenter,
}: WorldCanvasShortcutOptions) {
  React.useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target)) return;

      if (
        (event.key === "Escape" || event.key === "Enter") &&
        penActiveSubpathRef.current != null
      ) {
        event.preventDefault();
        finishPen();
        return;
      }

      const cancelGesture =
        event.key === "Escape" &&
        [
          [hasObjectDrag(), cancelObjectDrag],
          [hasLayerTransform(), cancelLayerTransform],
          [hasFrameResize(), cancelFrameResize],
          [hasWorldPointDrag(), cancelWorldPointEditing],
          [isDraggingArtboards, cancelArtboardDrag],
          [isWorldPanning, cancelWorldPan],
        ].find(([active]) => active);
      if (cancelGesture) {
        event.preventDefault();
        const cancel = cancelGesture[1];
        if (typeof cancel === "function") cancel();
        return;
      }

      if (event.key === "Escape" && isPointTool) {
        event.preventDefault();
        exitPointMode();
        return;
      }
      if (event.key === "Escape" && isObjectTool) {
        event.preventDefault();
        clearObjectSelection();
        return;
      }
      if (event.metaKey || event.ctrlKey) return;

      if (event.shiftKey && event.code === "Digit1") {
        event.preventDefault();
        fitWorldToFrames();
      } else if (event.shiftKey && event.code === "Digit2") {
        event.preventDefault();
        fitWorldToSelection();
      } else if (event.code === "Digit0") {
        event.preventDefault();
        resetWorldZoom();
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomWorldAtCenter(1.25);
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomWorldAtCenter(0.8);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    cancelArtboardDrag,
    cancelFrameResize,
    cancelLayerTransform,
    cancelObjectDrag,
    cancelWorldPan,
    cancelWorldPointEditing,
    clearObjectSelection,
    enabled,
    exitPointMode,
    finishPen,
    fitWorldToFrames,
    fitWorldToSelection,
    hasFrameResize,
    hasLayerTransform,
    hasObjectDrag,
    hasWorldPointDrag,
    isDraggingArtboards,
    isObjectTool,
    isPointTool,
    isWorldPanning,
    penActiveSubpathRef,
    resetWorldZoom,
    zoomWorldAtCenter,
  ]);
}
