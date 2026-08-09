"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { Point } from "@/lib/shapeshifter/types";
import { useEditorStore, type CanvasFrame } from "@/lib/store/editorStore";
import {
  FrameResizeGesture,
  type FrameResizeHandle,
} from "@/lib/shapeshifter/gestures/select/FrameResizeGesture";
import { getCanvasFrameBounds } from "./useWorldCamera";

interface WorldFrameResizeOptions {
  svgRef: RefObject<SVGSVGElement | null>;
  frame: CanvasFrame | undefined;
}

export function useWorldFrameResize({ svgRef, frame }: WorldFrameResizeOptions) {
  const gestureRef = useRef<FrameResizeGesture | null>(null);

  const start = useCallback(
    (event: ReactPointerEvent, handle: FrameResizeHandle) => {
      if (!frame) return;
      event.stopPropagation();
      event.preventDefault();
      gestureRef.current = new FrameResizeGesture(getCanvasFrameBounds(frame), handle, {
        beginTransaction: () => useEditorStore.getState().pushHistory(),
        applySize: ({ width, height }) => useEditorStore.getState().updateVector({ width, height }),
        rollback: () => useEditorStore.getState().cancelLastHistoryTransaction(),
      });
      try {
        svgRef.current?.setPointerCapture(event.pointerId);
      } catch {
        // The SVG may already have lost native capture.
      }
    },
    [frame, svgRef],
  );

  const update = useCallback((point: Point, bypassSnap: boolean) => {
    const gesture = gestureRef.current;
    if (!gesture) return false;
    gesture.update(point, { bypassSnap });
    return true;
  }, []);

  const finish = useCallback(() => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture) return false;
    gesture.finish();
    return true;
  }, []);

  const cancel = useCallback(() => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    gesture?.cancel();
  }, []);

  const hasGesture = useCallback(() => Boolean(gestureRef.current), []);

  return { start, update, finish, cancel, hasGesture };
}
