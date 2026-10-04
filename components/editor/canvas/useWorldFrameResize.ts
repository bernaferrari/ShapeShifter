"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import type { Point } from "@/lib/shapeshifter/types";
import { useEditorStore, type CanvasFrame, type EditorState } from "@/lib/store/editorStore";
import { beginLiveGesture, endLiveGesture, ownsLiveGesture } from "@/lib/store/liveGesture";
import {
  FrameResizeGesture,
  type FrameResizeHandle,
} from "@/lib/shapeshifter/gestures/select/FrameResizeGesture";
import {
  vectorCoordinateResizePatch,
  vectorCoordinateResizePolicy,
} from "@/lib/shapeshifter/vectorSpace";
import { getCanvasFrameBounds } from "./useWorldCamera";

interface WorldFrameResizeOptions {
  svgRef: RefObject<SVGSVGElement | null>;
  frame: CanvasFrame | undefined;
}
interface ResizeBaseline {
  marker: ReturnType<typeof beginLiveGesture>;
  ownerId: string;
  historyEntry?: EditorState["history"][number];
  changed: boolean;
}

export function useWorldFrameResize({ svgRef, frame }: WorldFrameResizeOptions) {
  const gestureRef = useRef<FrameResizeGesture | null>(null);
  const baselineRef = useRef<ResizeBaseline | null>(null);
  const cancel = useCallback(() => {
    const gesture = gestureRef.current;
    const baseline = baselineRef.current;
    gestureRef.current = null;
    gesture?.cancel();
    baselineRef.current = null;
    endLiveGesture(baseline?.marker);
  }, []);
  useEffect(() => cancel, [cancel]);

  const start = useCallback(
    (event: ReactPointerEvent, handle: FrameResizeHandle) => {
      if (
        !frame ||
        frame.id !== useEditorStore.getState().selectedFrameId ||
        !event.isPrimary ||
        event.button !== 0
      )
        return;
      event.stopPropagation();
      event.preventDefault();
      cancel();
      const state = useEditorStore.getState();
      const restoredFrame = state.frames.find((candidate) => candidate.id === frame.id);
      if (!restoredFrame) return;
      const bounds = getCanvasFrameBounds({ ...restoredFrame, vector: state.vector });
      const resizePolicy = vectorCoordinateResizePolicy(state.vector);
      const baseline: ResizeBaseline = {
        marker: beginLiveGesture("world-frame-resize", { x: event.clientX, y: event.clientY }),
        ownerId: frame.id,
        changed: false,
      };
      baselineRef.current = baseline;
      useEditorStore.setState({ isPlaying: false });
      const owns = () =>
        ownsLiveGesture(baseline.marker) &&
        useEditorStore.getState().selectedFrameId === baseline.ownerId &&
        (!baseline.historyEntry ||
          useEditorStore.getState().history.at(-1) === baseline.historyEntry);
      const rollback = () => {
        if (owns() && baseline.historyEntry)
          useEditorStore.getState().cancelLastHistoryTransaction();
      };
      gestureRef.current = new FrameResizeGesture(bounds, handle, {
        beginTransaction: () => {
          if (!owns()) return;
          useEditorStore.getState().pushHistory();
          baseline.historyEntry = useEditorStore.getState().history.at(-1);
        },
        applySize: ({ width, height }) => {
          if (!owns()) return;
          baseline.changed =
            Math.abs(width - bounds.w) > 1e-6 || Math.abs(height - bounds.h) > 1e-6;
          useEditorStore
            .getState()
            .updateVector(vectorCoordinateResizePatch(width, height, resizePolicy), {
              recordHistory: false,
            });
        },
        commit: () => {
          if (!baseline.changed) rollback();
        },
        rollback,
      });
      try {
        svgRef.current?.setPointerCapture(event.pointerId);
      } catch {
        /* Native capture can already be released. */
      }
    },
    [cancel, frame, svgRef],
  );

  const update = useCallback((point: Point, bypassSnap: boolean) => {
    const gesture = gestureRef.current;
    const baseline = baselineRef.current;
    if (!gesture || !baseline) return false;
    const state = useEditorStore.getState();
    if (
      !ownsLiveGesture(baseline.marker) ||
      state.selectedFrameId !== baseline.ownerId ||
      (baseline.historyEntry && state.history.at(-1) !== baseline.historyEntry)
    ) {
      gestureRef.current = null;
      baselineRef.current = null;
      endLiveGesture(baseline.marker);
      return false;
    }
    gesture.update(point, { bypassSnap });
    return true;
  }, []);
  const finish = useCallback(() => {
    const gesture = gestureRef.current;
    const baseline = baselineRef.current;
    gestureRef.current = null;
    if (!gesture) return false;
    gesture.finish();
    baselineRef.current = null;
    endLiveGesture(baseline?.marker);
    return true;
  }, []);
  const hasGesture = useCallback(() => Boolean(gestureRef.current), []);
  return { start, update, finish, cancel, hasGesture };
}
