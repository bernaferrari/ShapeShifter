"use client";

import { useState } from "react";
import { Copy, Trash2 } from "lucide-react";
import type { Viewport } from "@/lib/shapeshifter/camera";
import type { CanvasFrame } from "@/lib/store/editorStore";
import { useEditorStore } from "@/lib/store/editorStore";
import { cn } from "@/lib/utils";

interface Size {
  w: number;
  h: number;
}

const frameBounds = (frame: CanvasFrame) => ({
  x: frame.x || 0,
  y: frame.y || 0,
  w: frame.vector?.width || 48,
  h: frame.vector?.height || 48,
});

const formatDimension = (value: number) =>
  Number.isInteger(value) ? String(value) : Number(value.toFixed(2)).toString();

export function WorldFrameChrome({
  frames,
  viewport,
  viewportSize,
  hoveredFrameId,
  draggingFrameIds,
  isDragging,
  onStartDrag,
}: {
  frames: CanvasFrame[];
  viewport: Viewport;
  viewportSize: Size;
  hoveredFrameId: string | null;
  draggingFrameIds: string[];
  isDragging: boolean;
  onStartDrag: (clientX: number, clientY: number, frameIds: string[]) => void;
}) {
  const selectedFrameId = useEditorStore((state) => state.selectedFrameId);
  const selectedFrameIds = useEditorStore((state) => state.selectedFrameIds);
  const frameCount = useEditorStore((state) => state.frames.length);
  const selectionKind = useEditorStore((state) => state.selectionKind);
  const hasCanvasSelection = useEditorStore((state) => state.hasCanvasSelection);
  const selectFrame = useEditorStore((state) => state.selectFrame);
  const selectFrames = useEditorStore((state) => state.selectFrames);
  const deselectAll = useEditorStore((state) => state.deselectAll);
  const renameFrame = useEditorStore((state) => state.renameFrame);
  const deleteFrame = useEditorStore((state) => state.deleteFrame);
  const [renamingFrameId, setRenamingFrameId] = useState<string | null>(null);

  const screenRect = (frame: CanvasFrame) => {
    const bounds = frameBounds(frame);
    const x = ((bounds.x - viewport.x) / viewport.w) * viewportSize.w;
    const y = ((bounds.y - viewport.y) / viewport.h) * viewportSize.h;
    return {
      bounds,
      x,
      y,
      width: (bounds.w / viewport.w) * viewportSize.w,
      height: (bounds.h / viewport.h) * viewportSize.h,
    };
  };

  return (
    <>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {frames.map((frame) => {
          const screen = screenRect(frame);
          const centerX = screen.x + screen.width / 2;
          if (
            screen.y < -40 ||
            screen.y > viewportSize.h + 40 ||
            centerX < -120 ||
            centerX > viewportSize.w + 120
          )
            return null;
          const selected =
            hasCanvasSelection &&
            selectionKind === "frame" &&
            (selectedFrameIds.includes(frame.id) ||
              (selectedFrameIds.length === 0 && frame.id === selectedFrameId));
          const containsSelection =
            hasCanvasSelection && selectionKind === "layer" && frame.id === selectedFrameId;
          const showTitle = selected || containsSelection || frame.id === hoveredFrameId;

          return (
            <div
              key={frame.id}
              className="pointer-events-auto absolute -translate-x-1/2"
              style={{ left: Math.round(centerX), top: Math.round(screen.y) - 28 }}
            >
              {renamingFrameId === frame.id ? (
                <input
                  autoFocus
                  defaultValue={frame.name}
                  onBlur={(event) => {
                    renameFrame(frame.id, event.target.value);
                    setRenamingFrameId(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      renameFrame(frame.id, event.currentTarget.value);
                      setRenamingFrameId(null);
                    } else if (event.key === "Escape") {
                      setRenamingFrameId(null);
                    }
                  }}
                  className="h-6 w-36 rounded-md border border-primary bg-card px-2 text-center text-[11px] text-foreground shadow-sm outline-none"
                  onPointerDown={(event) => event.stopPropagation()}
                  aria-label={`Rename ${frame.name}`}
                />
              ) : (
                <div
                  className={cn(
                    "flex items-center gap-0.5 rounded-md border border-transparent py-0.5 pl-1 pr-1 transition-colors",
                    selected
                      ? "border-primary/35 bg-card/95 shadow-sm ring-1 ring-primary/15 backdrop-blur-sm"
                      : containsSelection
                        ? "bg-transparent"
                        : showTitle
                          ? "bg-card/80 backdrop-blur-sm"
                          : "bg-transparent",
                    isDragging && draggingFrameIds.includes(frame.id)
                      ? "cursor-grabbing"
                      : "cursor-default",
                  )}
                >
                  <button
                    type="button"
                    className={cn(
                      "max-w-[160px] truncate rounded px-1.5 text-[11px] leading-5",
                      selected
                        ? "font-medium text-primary"
                        : containsSelection
                          ? "text-muted-foreground/70"
                          : "text-muted-foreground hover:text-foreground",
                    )}
                    title="Click to select frame · double-click to rename frame"
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      event.stopPropagation();
                      const additive = event.shiftKey;
                      const next = additive
                        ? selectedFrameIds.includes(frame.id)
                          ? selectedFrameIds.filter((id) => id !== frame.id)
                          : [...selectedFrameIds, frame.id]
                        : selectedFrameIds.length > 1 && selectedFrameIds.includes(frame.id)
                          ? selectedFrameIds
                          : [frame.id];
                      if (next.length === 0) {
                        deselectAll();
                        return;
                      }
                      selectFrames(next, frame.id);
                      if (!additive) {
                        event.preventDefault();
                        onStartDrag(event.clientX, event.clientY, next);
                        try {
                          event.currentTarget.setPointerCapture(event.pointerId);
                        } catch {
                          // Native capture may already have been released.
                        }
                      }
                    }}
                    onDoubleClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      selectFrame(frame.id);
                      setRenamingFrameId(frame.id);
                    }}
                  >
                    {frame.name}
                  </button>
                  <span
                    aria-hidden={!selected}
                    className={cn(
                      "flex items-center gap-0.5 transition-opacity",
                      selected ? "opacity-100" : "pointer-events-none opacity-0",
                    )}
                  >
                    <button
                      type="button"
                      title="Duplicate frame"
                      aria-label={`Duplicate ${frame.name}`}
                      tabIndex={selected ? 0 : -1}
                      disabled={!selected}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => {
                        const store = useEditorStore.getState();
                        store.selectFrame(frame.id);
                        store.duplicateFrame();
                      }}
                      className="grid size-5 cursor-pointer place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Copy className="size-3" />
                    </button>
                    <button
                      type="button"
                      title="Delete frame"
                      aria-label={`Delete ${frame.name}`}
                      tabIndex={selected ? 0 : -1}
                      disabled={!selected || frameCount <= 1}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => deleteFrame(frame.id)}
                      className="grid size-5 cursor-pointer place-items-center rounded text-muted-foreground hover:bg-muted hover:text-destructive disabled:pointer-events-none disabled:opacity-40"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {frames.map((frame) => {
          if (frame.id !== selectedFrameId && frame.id !== hoveredFrameId) return null;
          const screen = screenRect(frame);
          const centerX = screen.x + screen.width / 2;
          const bottom = screen.y + screen.height;
          if (
            bottom < -20 ||
            bottom > viewportSize.h + 30 ||
            centerX < -120 ||
            centerX > viewportSize.w + 120
          )
            return null;
          return (
            <div
              key={frame.id}
              className="absolute -translate-x-1/2 rounded-full bg-primary px-2 py-0.5 font-mono text-[10px] font-medium text-primary-foreground shadow-sm"
              style={{ left: Math.round(centerX), top: Math.round(bottom) + 8 }}
            >
              {formatDimension(screen.bounds.w)} × {formatDimension(screen.bounds.h)}
            </div>
          );
        })}
      </div>
    </>
  );
}
