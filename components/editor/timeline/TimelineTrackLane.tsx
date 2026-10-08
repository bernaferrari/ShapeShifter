"use client";

import React from "react";
import { DiamondPlus } from "lucide-react";
import { ContextMenu, ContextMenuTrigger, ContextMenuContent } from "@/components/ui/context-menu";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useEditorStore } from "@/lib/store/editorStore";

/** Empty lane gestures share insertion with the inspector and toolbar. */
export function TimelineTrackLane({
  frameId,
  layerId,
  propertyName,
  gutter,
  width,
  children,
}: {
  frameId: string;
  layerId: string | number;
  propertyName: string;
  gutter: number;
  width: number;
  children: React.ReactNode;
}) {
  const [ghost, setGhost] = React.useState<number | null>(null);
  const menuTime = React.useRef(0);
  const timeAt = (event: React.MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const state = useEditorStore.getState();
    const duration =
      state.selectedFrameId === frameId
        ? state.animation.duration
        : (state.frames.find((frame) => frame.id === frameId)?.animation.duration ??
          state.animation.duration);
    return Math.max(
      0,
      Math.min(duration, ((event.clientX - rect.left) / Math.max(1, rect.width)) * duration),
    );
  };
  const seek = (time: number) => {
    const state = useEditorStore.getState();
    if (state.selectedFrameId !== frameId) state.selectFrame(frameId);
    const current = useEditorStore.getState();
    current.selectLayer(layerId);
    current.selectBlocks(
      current.animation.blocks
        .filter(
          (block) =>
            String(block.layerId) === String(layerId) && block.propertyName === propertyName,
        )
        .map((block) => block.id),
    );
    useEditorStore.setState({ isPlaying: false });
    current.setProgress(time / Math.max(1, current.animation.duration));
  };
  const add = (time: number) => {
    seek(time);
    useEditorStore.getState().addKeyframeAtPlayhead(layerId, propertyName);
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            data-timeline-lane
            className="absolute inset-y-0"
            style={{ left: gutter, width }}
            onClick={(event) => {
              event.stopPropagation();
              seek(timeAt(event));
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              add(timeAt(event));
            }}
            onContextMenu={(event) => {
              menuTime.current = timeAt(event);
            }}
            onPointerMove={(event) => {
              if (event.pointerType === "touch" || (event.target as Element).closest("button"))
                return setGhost(null);
              setGhost(event.clientX - event.currentTarget.getBoundingClientRect().left);
            }}
            onPointerLeave={() => setGhost(null)}
          />
        }
      >
        {ghost !== null && (
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 z-[1] size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-dashed border-primary/50"
            style={{ left: ghost }}
          />
        )}
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <DropdownMenuItem onClick={() => add(menuTime.current)}>
          <DiamondPlus className="size-4" />
          Add keyframe here
        </DropdownMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** The needle sits beneath opaque key faces, never across their center. */
export function TimelineContentPlayhead({ gutter, width }: { gutter: number; width: number }) {
  const progress = useEditorStore((state) => state.progress);
  return (
    <span
      aria-hidden
      data-timeline-lane-playhead
      className="pointer-events-none absolute inset-y-0 z-0 w-px bg-primary"
      style={{ left: gutter + progress * width }}
    />
  );
}
