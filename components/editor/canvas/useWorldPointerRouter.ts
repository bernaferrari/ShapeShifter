"use client";

import React from "react";
import { snapValueToStep } from "@/lib/shapeshifter/camera";
import {
  inverseAffine,
  transformPointWithMatrix,
  type AffineMatrix,
} from "@/lib/shapeshifter/scene/layerTransform";
import type { Layer, Point, Selection } from "@/lib/shapeshifter/types";
import { useEditorStore, type EditorState, type LayerSelectionRef } from "@/lib/store/editorStore";

interface PointerModifiers {
  shift: boolean;
  alt: boolean;
  bypassSnap: boolean;
}

interface WorldPointerRouterOptions {
  svgRef: React.RefObject<SVGSVGElement | null>;
  worldPointFromEvent: (clientX: number, clientY: number) => Point | null;
  toolMode: EditorState["toolMode"];
  spacePanActive: boolean;
  snapToGrid: boolean;
  snapStep: number;
  editOrigin: Point | null;
  editWorldMatrix?: AffineMatrix | null;
  editLayerLocked?: boolean;
  editPathPresent: boolean;
  layers: Layer[];
  selectedLayerId: string | number;
  selectedFrameId: string;
  worldSelectedIds: string[];
  selectedLayerRefs: LayerSelectionRef[];
  selectedLayerRefKeys: Set<string>;
  selectionKind: EditorState["selectionKind"];
  hasCanvasSelection: boolean;
  startWorldPan: (clientX: number, clientY: number, pointerId: number) => void;
  updateWorldPan: (clientX: number, clientY: number) => boolean;
  finishWorldPan: () => void;
  cancelWorldPan: () => void;
  startShapeDrawing?: (point: Point, bypassSnap: boolean) => boolean;
  startPenPath?: (point: Point, bypassSnap: boolean) => boolean;
  updateShapeDrawing?: (point: Point, modifiers: PointerModifiers) => boolean;
  finishShapeDrawing?: () => boolean;
  cancelShapeDrawing?: () => void;
  penDragRef: React.RefObject<unknown>;
  penPointerDown: (point: Point) => void;
  penPointerDrag: (point: Point) => void;
  penPointerUp: () => void;
  penPointerCancel?: () => void;
  applyWorldPaint: (point: Point) => void;
  hitWorldAnchor: (point: Point) => Selection | null;
  startWorldPointEditing: (selection: Selection, additive?: boolean) => void;
  updateWorldPointEditing: (point: Point, bypassSnap: boolean) => boolean;
  finishWorldPointEditing: () => boolean;
  cancelWorldPointEditing: () => void;
  hitLayerAtWorld: (point: Point | null) => LayerHit | null;
  hitArtboard: (point: Point | null) => string | null;
  selectOwnedLayer: (hit: LayerHit) => void;
  clearPendingObjectDrag: () => void;
  startObjectDrag: (point: Point) => void;
  updateObjectDrag: (point: Point, modifiers: PointerModifiers) => boolean;
  finishObjectDrag: (point: Point | null, modifiers: PointerModifiers) => void;
  cancelObjectDrag: () => void;
  hasObjectDrag: () => boolean;
  clearObjectFeedback: () => void;
  selectFrame: (frameId: string) => void;
  selectFrames: (frameIds: string[], primaryFrameId?: string) => void;
  selectLayerRefs: (refs: LayerSelectionRef[]) => void;
  beginLayerMarquee: (point: Point, frameId: string, additive: boolean) => void;
  beginFrameMarquee: (point: Point, additive: boolean) => void;
  updateMarquee: (point: Point) => boolean;
  finishMarquee: () => void;
  cancelMarquee: () => void;
  beginWorldLasso: (point: Point) => void;
  updateWorldLasso: (point: Point) => void;
  finishWorldLasso: (additive: boolean) => void;
  cancelWorldLasso: () => void;
  updateFrameResize: (point: Point, bypassSnap: boolean) => boolean;
  finishFrameResize: () => boolean;
  cancelFrameResize: () => void;
  hasFrameResize: () => boolean;
  updateLayerTransform: (
    point: Point,
    modifiers: { preserveAspect: boolean; bypassSnap: boolean },
  ) => boolean;
  finishLayerTransform: () => boolean;
  cancelLayerTransform: () => void;
  hasLayerTransform: () => boolean;
  updateArtboardDrag: (clientX: number, clientY: number, modifiers: PointerModifiers) => boolean;
  finishArtboardDrag: (clientX: number, clientY: number, modifiers: PointerModifiers) => void;
  cancelArtboardDrag: () => void;
  startArtboardDrag: (clientX: number, clientY: number, frameIds: string[]) => void;
  isDraggingArtboards: boolean;
  updateIdlePointerPreview: (clientX: number, clientY: number, event: React.PointerEvent) => void;
  updatePaintPreview: (point: Point) => void;
  clearPaintPreview: () => void;
}

interface LayerHit {
  frameId: string;
  layerId: string | number;
}

function capturePointer(svg: SVGSVGElement | null, pointerId: number) {
  try {
    svg?.setPointerCapture(pointerId);
  } catch {
    // The element can lose native capture between browser and React events.
  }
}

function releasePointer(svg: SVGSVGElement | null, pointerId: number) {
  try {
    if (svg?.hasPointerCapture(pointerId)) svg.releasePointerCapture(pointerId);
  } catch {
    // Native cancellation may already have released it.
  }
}

/** Routes pointer input to one active canvas gesture without owning document state. */
export function useWorldPointerRouter(options: WorldPointerRouterOptions) {
  const touchPan = React.useRef<{
    id: number;
    x: number;
    y: number;
    moved: boolean;
    frameId: string | null;
    timer: ReturnType<typeof setTimeout> | null;
  } | null>(null);
  const latestOptions = React.useRef(options);
  latestOptions.current = options;
  const clearTouchHold = React.useCallback(() => {
    const tap = touchPan.current;
    if (tap?.timer) clearTimeout(tap.timer);
    if (tap) tap.timer = null;
  }, []);
  React.useEffect(() => {
    return () => {
      clearTouchHold();
      touchPan.current = null;
    };
  }, [clearTouchHold, options.toolMode]);
  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent) => {
      if (!event.isPrimary || (event.button !== 0 && event.button !== 1)) return;
      const point = options.worldPointFromEvent(event.clientX, event.clientY);
      if (event.button === 1 || options.spacePanActive || options.toolMode === "hand") {
        if (options.spacePanActive) {
          (window as unknown as { __ssSpacePanUsed?: boolean }).__ssSpacePanUsed = true;
        }
        options.startWorldPan(event.clientX, event.clientY, event.pointerId);
        return;
      }
      if (!point) return;
      if (options.startPenPath?.(point, event.metaKey || event.ctrlKey)) {
        capturePointer(options.svgRef.current, event.pointerId);
        return;
      }
      if (options.startShapeDrawing?.(point, event.metaKey || event.ctrlKey)) {
        capturePointer(options.svgRef.current, event.pointerId);
        return;
      }

      const ownerPoint = {
        x: point.x - (options.editOrigin?.x ?? 0),
        y: point.y - (options.editOrigin?.y ?? 0),
      };
      const inverse = options.editWorldMatrix ? inverseAffine(options.editWorldMatrix) : null;
      const rawLocal = options.editWorldMatrix
        ? inverse
          ? transformPointWithMatrix(ownerPoint, inverse)
          : null
        : ownerPoint;
      if (!rawLocal) return;
      const bypassSnap = event.metaKey || event.ctrlKey;
      const snappedLocal =
        options.snapToGrid && !bypassSnap
          ? {
              x: snapValueToStep(rawLocal.x, options.snapStep),
              y: snapValueToStep(rawLocal.y, options.snapStep),
            }
          : rawLocal;

      if (options.toolMode === "pen") {
        if (options.editLayerLocked || !options.editPathPresent || !options.editOrigin) return;
        options.penPointerDown(snappedLocal);
        capturePointer(options.svgRef.current, event.pointerId);
        return;
      }
      if (options.toolMode === "paint") {
        if (options.editLayerLocked) return;
        if (!options.editOrigin) {
          const frameId = options.hitArtboard(point);
          if (frameId) options.selectFrame(frameId);
          return;
        }
        options.applyWorldPaint(rawLocal);
        return;
      }
      if (options.toolMode === "knife") {
        if (options.editLayerLocked) return;
        if (!options.editOrigin) {
          const frameId = options.hitArtboard(point);
          if (frameId) options.selectFrame(frameId);
          return;
        }
        const layer = options.layers.find(
          (candidate) => String(candidate.id) === String(options.selectedLayerId),
        );
        if (!layer || layer.locked) return;
        useEditorStore.getState().ensurePathKeyframeAtPlayhead();
        useEditorStore.getState().addPointOnPath(rawLocal.x, rawLocal.y);
        return;
      }

      if (options.toolMode === "direct" && options.editPathPresent && options.editOrigin) {
        const anchor = options.hitWorldAnchor(point);
        if (anchor) {
          options.startWorldPointEditing(anchor, event.shiftKey);
          options.clearPendingObjectDrag();
          capturePointer(options.svgRef.current, event.pointerId);
          return;
        }
        const layerHit = options.hitLayerAtWorld(point);
        if (layerHit) {
          options.selectOwnedLayer(layerHit);
          useEditorStore.getState().clearSelection?.();
          capturePointer(options.svgRef.current, event.pointerId);
          return;
        }
        useEditorStore.getState().clearSelection?.();
      }

      if (options.toolMode === "pencil") {
        options.beginWorldLasso(point);
        capturePointer(options.svgRef.current, event.pointerId);
        return;
      }

      const additive = event.shiftKey;
      options.clearPendingObjectDrag();
      options.cancelLayerTransform();
      options.cancelWorldPointEditing();

      if (options.toolMode === "select") {
        const layerHit = options.hitLayerAtWorld(point);
        if (layerHit) {
          const hitKey = `${layerHit.frameId}:${String(layerHit.layerId)}`;
          if (additive && options.selectionKind === "layer") {
            const next = options.selectedLayerRefKeys.has(hitKey)
              ? options.selectedLayerRefs.filter(
                  (ref) => `${ref.ownerId}:${String(ref.layerId)}` !== hitKey,
                )
              : [
                  ...options.selectedLayerRefs,
                  { ownerId: layerHit.frameId, layerId: layerHit.layerId },
                ];
            options.selectLayerRefs(next);
          } else {
            if (!options.selectedLayerRefKeys.has(hitKey)) options.selectOwnedLayer(layerHit);
            options.startObjectDrag(point);
          }
          capturePointer(options.svgRef.current, event.pointerId);
          return;
        }
      }

      const frameId = options.hitArtboard(point);
      if (event.pointerType === "touch" && options.toolMode === "select") {
        // An immediate drag navigates; holding inside a frame picks it up.
        // A tap selects a frame or clears selection without moving the camera.
        touchPan.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          moved: false,
          frameId,
          timer: null,
        };
        options.startWorldPan(event.clientX, event.clientY, event.pointerId);
        if (frameId) {
          const tap = touchPan.current;
          tap.timer = setTimeout(() => {
            if (touchPan.current !== tap || tap.moved) return;
            const state = useEditorStore.getState();
            if (!state.frames.some((frame) => frame.id === frameId)) return;
            touchPan.current = null;
            const current = latestOptions.current;
            current.cancelWorldPan();
            const ids =
              state.selectionKind === "frame" && state.selectedFrameIds.includes(frameId)
                ? state.selectedFrameIds
                : [frameId];
            current.selectFrames(ids, frameId);
            current.startArtboardDrag(tap.x, tap.y, ids);
          }, 400);
        }
        return;
      }
      if (frameId) {
        if (additive && options.selectionKind === "frame") {
          if (options.worldSelectedIds.includes(frameId) && options.hasCanvasSelection) {
            const next = options.worldSelectedIds.filter((id) => id !== frameId);
            options.selectFrames(
              next,
              next.includes(options.selectedFrameId)
                ? options.selectedFrameId
                : next[next.length - 1],
            );
          } else {
            options.selectFrames([...new Set([...options.worldSelectedIds, frameId])], frameId);
          }
        } else {
          options.beginLayerMarquee(point, frameId, additive);
        }
      } else {
        options.beginFrameMarquee(point, additive);
      }
      capturePointer(options.svgRef.current, event.pointerId);
    },
    [options],
  );

  const handlePointerMove = React.useCallback(
    (event: React.PointerEvent) => {
      if (event.buttons === 0) {
        options.updateIdlePointerPreview(event.clientX, event.clientY, event);
        return;
      }
      if (options.penDragRef.current && options.editOrigin) {
        const point = options.worldPointFromEvent(event.clientX, event.clientY);
        if (point) {
          const ownerPoint = {
            x: point.x - options.editOrigin.x,
            y: point.y - options.editOrigin.y,
          };
          const inverse = options.editWorldMatrix ? inverseAffine(options.editWorldMatrix) : null;
          const local = options.editWorldMatrix
            ? inverse
              ? transformPointWithMatrix(ownerPoint, inverse)
              : null
            : ownerPoint;
          if (local) options.penPointerDrag(local);
        }
        return;
      }
      const tap = touchPan.current;
      if (tap && tap.id === event.pointerId) {
        if (Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 6) {
          tap.moved = true;
          clearTouchHold();
        } else if (!tap.moved) return;
      }
      if (options.updateWorldPan(event.clientX, event.clientY)) return;
      const point = options.worldPointFromEvent(event.clientX, event.clientY);
      if (!point) return;
      const bypassSnap = event.metaKey || event.ctrlKey;

      if (
        options.updateShapeDrawing?.(point, {
          shift: event.shiftKey,
          alt: event.altKey,
          bypassSnap,
        })
      )
        return;
      if (options.updateFrameResize(point, !options.snapToGrid || bypassSnap)) return;
      options.updatePaintPreview(point);
      if (options.updateWorldPointEditing(point, bypassSnap)) return;
      if (
        options.updateObjectDrag(point, {
          shift: event.shiftKey,
          alt: event.altKey,
          bypassSnap,
        })
      )
        return;
      if (
        options.updateLayerTransform(point, {
          preserveAspect: event.shiftKey,
          bypassSnap,
        })
      )
        return;
      if (
        options.updateArtboardDrag(event.clientX, event.clientY, {
          shift: event.shiftKey,
          alt: event.altKey,
          bypassSnap,
        })
      )
        return;
      if (options.updateMarquee(point)) return;
      if (options.toolMode === "pencil") options.updateWorldLasso(point);
    },
    [options, clearTouchHold],
  );

  const handlePointerUp = React.useCallback(
    (event: React.PointerEvent) => {
      const tap = touchPan.current;
      if (tap && tap.id === event.pointerId) {
        clearTouchHold();
        touchPan.current = null;
        options.finishWorldPan();
        releasePointer(options.svgRef.current, event.pointerId);
        if (!tap.moved) {
          if (tap.frameId) options.selectFrame(tap.frameId);
          else useEditorStore.getState().deselectAll();
        }
        return;
      }
      if (options.finishShapeDrawing?.()) {
        releasePointer(options.svgRef.current, event.pointerId);
        return;
      }
      const objectDrag = options.hasObjectDrag();
      const frameResize = options.hasFrameResize();
      const layerTransform = options.hasLayerTransform();
      options.clearObjectFeedback();

      const modifiers = {
        shift: event.shiftKey,
        alt: event.altKey,
        bypassSnap: event.metaKey || event.ctrlKey,
      };
      if (objectDrag) {
        options.finishObjectDrag(
          options.worldPointFromEvent(event.clientX, event.clientY),
          modifiers,
        );
      }
      if (options.isDraggingArtboards) {
        options.finishArtboardDrag(event.clientX, event.clientY, modifiers);
      }
      if (frameResize) options.finishFrameResize();
      if (layerTransform) options.finishLayerTransform();

      if (options.penDragRef.current) {
        options.penPointerUp();
        releasePointer(options.svgRef.current, event.pointerId);
        return;
      }
      if (options.finishWorldPointEditing()) {
        releasePointer(options.svgRef.current, event.pointerId);
        return;
      }

      options.finishWorldPan();
      releasePointer(options.svgRef.current, event.pointerId);
      options.finishMarquee();
      if (options.toolMode === "pencil") options.finishWorldLasso(event.shiftKey);
      if (options.toolMode === "paint") options.clearPaintPreview();
    },
    [options, clearTouchHold],
  );

  const handlePointerCancel = React.useCallback(
    (event: React.PointerEvent) => {
      clearTouchHold();
      touchPan.current = null;
      options.cancelObjectDrag();
      options.cancelShapeDrawing?.();
      options.penPointerCancel?.();
      options.cancelLayerTransform();
      options.cancelFrameResize();
      options.cancelWorldPointEditing();
      options.cancelArtboardDrag();
      options.cancelWorldPan();
      options.cancelMarquee();
      options.cancelWorldLasso();
      options.clearObjectFeedback();
      releasePointer(options.svgRef.current, event.pointerId);
    },
    [options, clearTouchHold],
  );

  return { handlePointerDown, handlePointerMove, handlePointerUp, handlePointerCancel };
}
