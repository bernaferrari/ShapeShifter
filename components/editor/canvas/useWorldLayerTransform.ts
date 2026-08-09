"use client";

import { useCallback, useRef, type RefObject } from "react";
import type { Point } from "@/lib/shapeshifter/types";
import { useEditorStore, type EditorState } from "@/lib/store/editorStore";
import type { LayerResizeSession, LayerRotateSession } from "./WorldSelectionOverlay";
import {
  applyLayerResize,
  applyLayerRotation,
  computeLayerResizeTarget,
  rotationDelta,
} from "./worldLayerTransforms";

interface WorldLayerTransformOptions {
  svgRef: RefObject<SVGSVGElement | null>;
  ownerOrigin: Point | null;
  snapToGrid: boolean;
  snapStep: number;
  syncActiveOwner: EditorState["syncActiveOwner"];
}

interface TransformModifiers {
  preserveAspect: boolean;
  bypassSnap: boolean;
}

export function useWorldLayerTransform({
  svgRef,
  ownerOrigin,
  snapToGrid,
  snapStep,
  syncActiveOwner,
}: WorldLayerTransformOptions) {
  const resizeRef = useRef<LayerResizeSession | null>(null);
  const rotateRef = useRef<LayerRotateSession | null>(null);

  const capture = useCallback(
    (pointerId: number) => {
      try {
        svgRef.current?.setPointerCapture(pointerId);
      } catch {
        // The SVG may have lost capture before React receives the handle event.
      }
    },
    [svgRef],
  );

  const startResize = useCallback(
    (session: LayerResizeSession, pointerId: number) => {
      resizeRef.current = session;
      capture(pointerId);
    },
    [capture],
  );

  const startRotate = useCallback(
    (session: LayerRotateSession, pointerId: number) => {
      rotateRef.current = session;
      capture(pointerId);
    },
    [capture],
  );

  const update = useCallback(
    (point: Point, modifiers: TransformModifiers) => {
      const rotation = rotateRef.current;
      if (rotation) {
        const delta = rotationDelta(rotation, point, modifiers.preserveAspect);
        if (!rotation.moved) {
          useEditorStore.getState().pushHistory();
          rotation.moved = true;
        }
        const store = useEditorStore.getState();
        useEditorStore.setState({ layers: applyLayerRotation(store.layers, rotation, delta) });
        syncActiveOwner();
        return true;
      }

      const resize = resizeRef.current;
      if (!resize || !ownerOrigin) return false;
      const target = computeLayerResizeTarget(resize, point, ownerOrigin, {
        preserveAspect: modifiers.preserveAspect,
        minSize: Math.max(snapStep, 0.5),
        snapStep: snapToGrid && !modifiers.bypassSnap ? snapStep : undefined,
      });
      if (!resize.moved) {
        useEditorStore.getState().pushHistory();
        resize.moved = true;
      }
      const store = useEditorStore.getState();
      useEditorStore.setState({ layers: applyLayerResize(store.layers, resize, target) });
      syncActiveOwner();
      return true;
    },
    [ownerOrigin, snapStep, snapToGrid, syncActiveOwner],
  );

  const finish = useCallback(() => {
    const session = resizeRef.current ?? rotateRef.current;
    resizeRef.current = null;
    rotateRef.current = null;
    if (!session) return false;
    if (session.moved) syncActiveOwner({ includeAnimation: true });
    return true;
  }, [syncActiveOwner]);

  const cancel = useCallback(() => {
    const session = resizeRef.current ?? rotateRef.current;
    resizeRef.current = null;
    rotateRef.current = null;
    if (session?.moved) useEditorStore.getState().cancelLastHistoryTransaction();
  }, []);

  const hasTransform = useCallback(() => Boolean(resizeRef.current || rotateRef.current), []);

  return { startResize, startRotate, update, finish, cancel, hasTransform };
}
