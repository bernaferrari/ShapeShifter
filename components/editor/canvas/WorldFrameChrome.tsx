"use client";

import { useRef, useState } from "react";
import type { Viewport } from "@/lib/shapeshifter/camera";
import type { CanvasFrame } from "@/lib/store/editorStore";
import { useEditorStore } from "@/lib/store/editorStore";
import { vectorCoordinateRect } from "@/lib/shapeshifter/vectorSpace";
import { cn } from "@/lib/utils";
import { TextSizedInput } from "../TextSizedInput";

interface Size {
  w: number;
  h: number;
}

const frameBounds = (frame: CanvasFrame) => ({
  x: frame.x || 0,
  y: frame.y || 0,
  ...vectorCoordinateRect(frame.vector, 48),
});

function FrameTitleInput({
  name,
  emphasized,
  onCommit,
  onCancel,
}: {
  name: string;
  emphasized: boolean;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(name);
  // Enter commits and unmounts, which also blurs; settle only once.
  const settled = useRef(false);
  const settle = (commit: boolean) => {
    if (settled.current) return;
    settled.current = true;
    if (commit) onCommit(draft);
    else onCancel();
  };
  return (
    // Same box as the title button: 20px tall, text on the bottom 16px.
    <div className="flex h-5 items-end">
      <TextSizedInput
        autoFocus
        fontSize={11}
        lineHeight={16}
        value={draft}
        className={cn("-mx-0.5", emphasized && "font-medium")}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => settle(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter") settle(true);
          else if (event.key === "Escape") settle(false);
        }}
        onPointerDown={(event) => event.stopPropagation()}
        aria-label={`Rename ${name}`}
      />
    </div>
  );
}

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
  interactive = true,
}: {
  frames: CanvasFrame[];
  viewport: Viewport;
  viewportSize: Size;
  hoveredFrameId: string | null;
  draggingFrameIds: string[];
  isDragging: boolean;
  interactive?: boolean;
  onStartDrag: (clientX: number, clientY: number, frameIds: string[]) => void;
}) {
  const selectedFrameId = useEditorStore((state) => state.selectedFrameId);
  const selectedFrameIds = useEditorStore((state) => state.selectedFrameIds);
  const selectionKind = useEditorStore((state) => state.selectionKind);
  const hasCanvasSelection = useEditorStore((state) => state.hasCanvasSelection);
  const selectFrame = useEditorStore((state) => state.selectFrame);
  const renameFrame = useEditorStore((state) => state.renameFrame);
  const [renamingFrameId, setRenamingFrameId] = useState<string | null>(null);

  const selectTitle = (frameId: string, additive: boolean) => {
    const state = useEditorStore.getState();
    const next = additive
      ? state.selectedFrameIds.includes(frameId)
        ? state.selectedFrameIds.filter((id) => id !== frameId)
        : [...state.selectedFrameIds, frameId]
      : state.selectedFrameIds.length > 1 && state.selectedFrameIds.includes(frameId)
        ? state.selectedFrameIds
        : [frameId];
    if (next.length) state.selectFrames(next, frameId);
    else state.deselectAll();
    return next;
  };

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
          if (
            screen.y < -40 ||
            screen.y > viewportSize.h + 40 ||
            screen.x + screen.width < -40 ||
            screen.x > viewportSize.w + 40
          )
            return null;
          const selected =
            hasCanvasSelection &&
            selectionKind === "frame" &&
            (selectedFrameIds.includes(frame.id) ||
              (selectedFrameIds.length === 0 && frame.id === selectedFrameId));
          const containsSelection =
            hasCanvasSelection && selectionKind === "layer" && frame.id === selectedFrameId;
          const hovered = frame.id === hoveredFrameId;

          return (
            <div
              key={frame.id}
              className={cn(
                "absolute",
                interactive ? "pointer-events-auto" : "pointer-events-none",
              )}
              style={{
                left: Math.round(screen.x),
                top: Math.round(screen.y) - 3,
                transform: "translateY(-100%)",
                // While renaming the field may outgrow the frame, as in Figma.
                maxWidth:
                  renamingFrameId === frame.id ? undefined : Math.max(48, Math.round(screen.width)),
              }}
            >
              {renamingFrameId === frame.id ? (
                <FrameTitleInput
                  name={frame.name}
                  emphasized={selected}
                  onCommit={(name) => {
                    if (name.trim() && name !== frame.name) renameFrame(frame.id, name);
                    setRenamingFrameId(null);
                  }}
                  onCancel={() => setRenamingFrameId(null)}
                />
              ) : (
                <div
                  className={cn(
                    "flex min-w-0 items-center",
                    isDragging && draggingFrameIds.includes(frame.id)
                      ? "cursor-grabbing"
                      : "cursor-default",
                  )}
                >
                  <button
                    type="button"
                    className={cn(
                      "flex h-5 max-w-full touch-none items-end text-[11px] transition-colors",
                      selected
                        ? "font-medium text-primary"
                        : hovered || containsSelection
                          ? "text-foreground"
                          : "text-muted-foreground hover:text-foreground",
                    )}
                    title="Click to select frame · double-click to rename frame"
                    aria-label={`Select frame ${frame.name}`}
                    aria-pressed={selected}
                    disabled={!interactive}
                    onPointerDown={(event) => {
                      if (!event.isPrimary || event.button !== 0) return;
                      event.stopPropagation();
                      const additive = event.shiftKey;
                      const next = selectTitle(frame.id, additive);
                      if (!next.length) return;
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
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      event.stopPropagation();
                      if (!event.repeat) selectTitle(frame.id, event.shiftKey);
                    }}
                    onClick={(event) => {
                      if (event.detail === 0) selectTitle(frame.id, event.shiftKey);
                    }}
                    onDoubleClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      selectFrame(frame.id);
                      setRenamingFrameId(frame.id);
                    }}
                  >
                    <span data-frame-title-text className="min-w-0 truncate leading-4">
                      {frame.name}
                    </span>
                  </button>
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
              className="absolute -translate-x-1/2 rounded-[4px] bg-primary px-1.5 py-px text-[10px] font-medium tabular-nums text-primary-foreground"
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
