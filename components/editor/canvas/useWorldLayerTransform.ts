"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { Point } from "@/lib/pathshift/types";
import { useEditorStore, type EditorState } from "@/lib/store/editorStore";
import { beginLiveGesture, endLiveGesture, ownsLiveGesture } from "@/lib/store/liveGesture";
import type { LayerResizeSession, LayerRotateSession } from "./WorldSelectionOverlay";
import {
  applyLayerResize,
  applyLayerRotation,
  computeLayerResizeTarget,
  recordWorldTransformChange,
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
interface GestureBaseline {
  marker: ReturnType<typeof beginLiveGesture>;
  layers: EditorState["layers"];
  animation: EditorState["animation"];
  ownerId: string;
  progress: number;
  idSeed: number;
  historyEntry?: EditorState["history"][number];
  changed: boolean;
  priorRotation: number;
  rotation: number;
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
  const baselineRef = useRef<GestureBaseline | null>(null);
  const cancel = useCallback(() => {
    const baseline = baselineRef.current;
    resizeRef.current = null;
    rotateRef.current = null;
    baselineRef.current = null;
    const state = useEditorStore.getState();
    if (
      baseline?.historyEntry &&
      ownsLiveGesture(baseline.marker) &&
      state.selectedFrameId === baseline.ownerId &&
      state.history.at(-1) === baseline.historyEntry
    ) {
      state.cancelLastHistoryTransaction();
    }
    endLiveGesture(baseline?.marker);
  }, []);
  useEffect(() => cancel, [cancel]);

  const start = useCallback(
    (pointerId: number) => {
      const state = useEditorStore.getState();
      baselineRef.current = {
        marker: beginLiveGesture(resizeRef.current ? "world-resize" : "world-rotate"),
        layers: state.layers,
        animation: state.animation,
        ownerId: state.selectedFrameId,
        progress: state.progress,
        idSeed: Date.now(),
        changed: false,
        priorRotation: 0,
        rotation: 0,
      };
      useEditorStore.setState({ isPlaying: false });
      try {
        svgRef.current?.setPointerCapture(pointerId);
      } catch {
        /* Native capture may already be released. */
      }
    },
    [svgRef],
  );
  const startResize = useCallback(
    (session: LayerResizeSession, pointerId: number) => {
      cancel();
      resizeRef.current = session;
      start(pointerId);
    },
    [cancel, start],
  );
  const startRotate = useCallback(
    (session: LayerRotateSession, pointerId: number) => {
      cancel();
      rotateRef.current = session;
      start(pointerId);
    },
    [cancel, start],
  );

  const update = useCallback(
    (point: Point, modifiers: TransformModifiers) => {
      const baseline = baselineRef.current;
      const session = resizeRef.current ?? rotateRef.current;
      if (!baseline || !session) return false;
      const state = useEditorStore.getState();
      // Navigation or Undo can invalidate an active gesture. Never apply frozen
      // artwork to a newly selected owner or consume someone else's history entry.
      if (
        !ownsLiveGesture(baseline.marker) ||
        state.selectedFrameId !== baseline.ownerId ||
        (baseline.historyEntry && state.history.at(-1) !== baseline.historyEntry)
      ) {
        resizeRef.current = null;
        rotateRef.current = null;
        baselineRef.current = null;
        endLiveGesture(baseline.marker);
        return false;
      }
      let nextLayers = baseline.layers;
      let ids: Array<string | number>;
      if (rotateRef.current) {
        const rotation = rotateRef.current;
        const raw = rotationDelta(rotation, point, false);
        const step = ((((raw - baseline.priorRotation + 180) % 360) + 360) % 360) - 180;
        baseline.rotation += step;
        baseline.priorRotation = raw;
        const delta = modifiers.preserveAspect
          ? Math.round(baseline.rotation / 15) * 15
          : baseline.rotation;
        nextLayers = applyLayerRotation(baseline.layers, rotation, delta);
        ids = rotation.baseTransforms.map((item) => item.id);
      } else {
        const resize = resizeRef.current!;
        const origin = resize.ownerOrigin ?? ownerOrigin;
        if (!origin) return false;
        const target = computeLayerResizeTarget(resize, point, origin, {
          preserveAspect: modifiers.preserveAspect,
          minSize: Math.max(snapStep, 0.5),
          snapStep: snapToGrid && !modifiers.bypassSnap ? snapStep : undefined,
        });
        nextLayers = applyLayerResize(baseline.layers, resize, target);
        ids = resize.items.map((item) => item.id);
      }
      const next = recordWorldTransformChange(
        baseline.layers,
        nextLayers,
        baseline.animation,
        baseline.progress,
        ids,
        ["translateX", "translateY", "rotation", "scaleX", "scaleY"],
        baseline.idSeed,
      );
      baseline.changed = next.layers !== baseline.layers || next.animation !== baseline.animation;
      if (baseline.changed && !session.moved) {
        state.pushHistory();
        baseline.historyEntry = useEditorStore.getState().history.at(-1);
        session.moved = true;
      }
      if (session.moved) {
        useEditorStore.setState(next);
        syncActiveOwner({ includeAnimation: true });
      }
      return true;
    },
    [ownerOrigin, snapStep, snapToGrid, syncActiveOwner],
  );

  const finish = useCallback(() => {
    const session = resizeRef.current ?? rotateRef.current;
    const baseline = baselineRef.current;
    if (!session) return false;
    if (
      !baseline ||
      !ownsLiveGesture(baseline.marker) ||
      useEditorStore.getState().selectedFrameId !== baseline.ownerId
    ) {
      resizeRef.current = null;
      rotateRef.current = null;
      baselineRef.current = null;
      endLiveGesture(baseline?.marker);
      return false;
    }
    if (session.moved && !baseline?.changed) {
      cancel();
      return true;
    }
    resizeRef.current = null;
    rotateRef.current = null;
    baselineRef.current = null;
    if (session.moved) syncActiveOwner({ includeAnimation: true });
    endLiveGesture(baseline.marker);
    return true;
  }, [cancel, syncActiveOwner]);
  const hasTransform = useCallback(() => Boolean(resizeRef.current || rotateRef.current), []);
  return { startResize, startRotate, update, finish, cancel, hasTransform };
}
