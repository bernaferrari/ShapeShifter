"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { snapValueToStep } from "@/lib/shapeshifter/camera";
import { ObjectDragGesture } from "@/lib/shapeshifter/gestures/select/ObjectDragGesture";
import { useEditorStore } from "@/lib/store/editorStore";

interface PointerModifiers {
  shift: boolean;
  bypassSnap: boolean;
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

  const clear = useCallback(() => {
    setIsDragging(false);
    setDraggingIds([]);
  }, []);

  const cancel = useCallback(() => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    gesture?.cancel();
    clear();
  }, [clear]);

  const start = useCallback(
    (clientX: number, clientY: number, ids: string[]) => {
      if (!ids.length) return;
      const startPoint = worldPointFromClient(clientX, clientY);
      if (!startPoint) return;
      setIsDragging(true);
      setDraggingIds(ids);
      gestureRef.current = new ObjectDragGesture(startPoint, {
        beginTransaction: () => useEditorStore.getState().pushHistory(),
        cloneSelection: () => undefined,
        resolveTotalDelta: (total, modifiers) =>
          snapToGrid && !modifiers.bypassSnap
            ? {
                x: snapValueToStep(total.x, 1),
                y: snapValueToStep(total.y, 1),
              }
            : total,
        applyDelta: (delta) => useEditorStore.getState().moveFrames(ids, delta.x, delta.y),
        commit: clear,
        rollback: () => useEditorStore.getState().cancelLastHistoryTransaction(),
        cancelled: clear,
      });
    },
    [clear, snapToGrid, worldPointFromClient],
  );

  const update = useCallback(
    (clientX: number, clientY: number, modifiers: PointerModifiers) => {
      const gesture = gestureRef.current;
      if (!gesture) return false;
      const point = worldPointFromClient(clientX, clientY);
      if (!point) return true;
      gesture.update(point, {
        shift: modifiers.shift,
        alt: false,
        bypassSnap: modifiers.bypassSnap,
      });
      return true;
    },
    [worldPointFromClient],
  );

  const finish = useCallback(
    (clientX: number, clientY: number, modifiers: PointerModifiers) => {
      const gesture = gestureRef.current;
      if (!gesture) return false;
      const point = worldPointFromClient(clientX, clientY);
      gestureRef.current = null;
      if (point) {
        gesture.update(point, {
          shift: modifiers.shift,
          alt: false,
          bypassSnap: modifiers.bypassSnap,
        });
        gesture.finish(point);
      } else {
        gesture.cancel();
      }
      clear();
      return true;
    },
    [clear, worldPointFromClient],
  );

  // Frame titles are HTML above the SVG, so their pointer stream is relayed to
  // the same gesture authority instead of creating a second drag implementation.
  useEffect(() => {
    const move = (event: PointerEvent) =>
      update(event.clientX, event.clientY, {
        shift: event.shiftKey,
        bypassSnap: event.metaKey || event.ctrlKey,
      });
    const up = (event: PointerEvent) =>
      finish(event.clientX, event.clientY, {
        shift: event.shiftKey,
        bypassSnap: event.metaKey || event.ctrlKey,
      });
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [cancel, finish, update]);

  return { isDragging, draggingIds, start, update, finish, cancel };
}
