"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { snapValueToStep } from "@/lib/shapeshifter/camera";
import { ObjectDragGesture } from "@/lib/shapeshifter/gestures/select/ObjectDragGesture";
import { useEditorStore, type EditorState } from "@/lib/store/editorStore";
import { beginLiveGesture, endLiveGesture, ownsLiveGesture } from "@/lib/store/liveGesture";

interface PointerModifiers {
  shift: boolean;
  bypassSnap: boolean;
}
interface DragBaseline {
  marker: ReturnType<typeof beginLiveGesture>;
  ownerId: string;
  historyEntry?: EditorState["history"][number];
}

export function useArtboardDrag({
  snapToGrid,
  worldPointFromClient,
}: {
  snapToGrid: boolean;
  worldPointFromClient: (clientX: number, clientY: number) => { x: number; y: number } | null;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [draggingIds, setDraggingIds] = useState<string[]>([]);
  const gestureRef = useRef<ObjectDragGesture | null>(null);
  const baselineRef = useRef<DragBaseline | null>(null);
  const clear = useCallback(() => {
    setIsDragging(false);
    setDraggingIds([]);
  }, []);
  const cancel = useCallback(() => {
    const gesture = gestureRef.current;
    const baseline = baselineRef.current;
    gestureRef.current = null;
    gesture?.cancel();
    baselineRef.current = null;
    endLiveGesture(baseline?.marker);
    clear();
  }, [clear]);
  useEffect(() => cancel, [cancel]);

  const start = useCallback(
    (clientX: number, clientY: number, ids: string[]) => {
      const state = useEditorStore.getState();
      const validIds = ids.filter((id) => state.frames.some((frame) => frame.id === id));
      if (!validIds.length) return;
      const startPoint = worldPointFromClient(clientX, clientY);
      if (!startPoint) return;
      cancel();
      const baseline: DragBaseline = {
        marker: beginLiveGesture("world-artboard", startPoint),
        ownerId: state.selectedFrameId,
      };
      baselineRef.current = baseline;
      useEditorStore.setState({ isPlaying: false });
      setIsDragging(true);
      setDraggingIds(validIds);
      const owns = () =>
        ownsLiveGesture(baseline.marker) &&
        useEditorStore.getState().selectedFrameId === baseline.ownerId &&
        (!baseline.historyEntry ||
          useEditorStore.getState().history.at(-1) === baseline.historyEntry);
      const rollback = () => {
        if (owns() && baseline.historyEntry)
          useEditorStore.getState().cancelLastHistoryTransaction();
      };
      gestureRef.current = new ObjectDragGesture(startPoint, {
        beginTransaction: () => {
          if (!owns()) return;
          useEditorStore.getState().pushHistory();
          baseline.historyEntry = useEditorStore.getState().history.at(-1);
        },
        cloneSelection: () => undefined,
        resolveTotalDelta: (total, modifiers) =>
          snapToGrid && !modifiers.bypassSnap
            ? { x: snapValueToStep(total.x, 1), y: snapValueToStep(total.y, 1) }
            : total,
        applyDelta: (delta) => {
          if (owns())
            useEditorStore
              .getState()
              .moveFrames(validIds, delta.x, delta.y, { recordHistory: false });
        },
        commit: (result) => {
          if (Math.hypot(result.applied.x, result.applied.y) <= 1e-6) rollback();
          clear();
        },
        rollback,
        cancelled: clear,
      });
    },
    [cancel, clear, snapToGrid, worldPointFromClient],
  );

  const update = useCallback(
    (clientX: number, clientY: number, modifiers: PointerModifiers) => {
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
        clear();
        return false;
      }
      const point = worldPointFromClient(clientX, clientY);
      if (!point) return true;
      gesture.update(point, {
        shift: modifiers.shift,
        alt: false,
        bypassSnap: modifiers.bypassSnap,
      });
      return true;
    },
    [clear, worldPointFromClient],
  );
  const finish = useCallback(
    (clientX: number, clientY: number, modifiers: PointerModifiers) => {
      const gesture = gestureRef.current;
      const baseline = baselineRef.current;
      if (!gesture) return false;
      const point = worldPointFromClient(clientX, clientY);
      if (point) {
        if (update(clientX, clientY, modifiers)) gesture.finish(point);
      } else gesture.cancel();
      gestureRef.current = null;
      baselineRef.current = null;
      endLiveGesture(baseline?.marker);
      clear();
      return true;
    },
    [clear, update, worldPointFromClient],
  );

  // Frame titles are HTML above the SVG, so relay their pointer stream to the
  // same gesture authority used by the canvas.
  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!event.isPrimary) return;
      update(event.clientX, event.clientY, {
        shift: event.shiftKey,
        bypassSnap: event.metaKey || event.ctrlKey,
      });
    };
    const up = (event: PointerEvent) => {
      if (!event.isPrimary) return;
      finish(event.clientX, event.clientY, {
        shift: event.shiftKey,
        bypassSnap: event.metaKey || event.ctrlKey,
      });
    };
    const cancelled = (event: PointerEvent) => {
      if (event.isPrimary) cancel();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancelled);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancelled);
    };
  }, [cancel, finish, update]);
  return { isDragging, draggingIds, start, update, finish, cancel };
}
