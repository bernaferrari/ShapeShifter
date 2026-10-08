import { useEditorStore, type DragState } from "./editorStore";
import type { Point } from "../pathshift/types";

/** Volatile session ownership is separate from lazy undo transactions. */
export function beginLiveGesture(type: string, point: Point = { x: 0, y: 0 }): DragState {
  const marker: DragState = {
    type,
    startX: point.x,
    startY: point.y,
    currentX: point.x,
    currentY: point.y,
  };
  useEditorStore.setState({ dragState: marker });
  return marker;
}

export function ownsLiveGesture(marker: DragState | null | undefined): boolean {
  return Boolean(marker && useEditorStore.getState().dragState === marker);
}

export function endLiveGesture(marker: DragState | null | undefined): void {
  if (ownsLiveGesture(marker)) useEditorStore.setState({ dragState: null });
}
