"use client";

import React from "react";
import { useEditorStore } from "@/lib/store/editorStore";
import { createLayerTreeModel } from "@/lib/pathshift/scene/layerHierarchy";
import { numberAtTime } from "@/lib/pathshift/playheadResolve";
import { propertyLabel } from "@/lib/pathshift/propertyLabels";
import { HOLD_INTERPOLATOR } from "@/lib/pathshift/interpolators";
import { interpolatorControlPoints } from "@/lib/pathshift/motion/timelineKeyframes";
import type { Layer, TimelineBlock } from "@/lib/pathshift/types";

/** After Effects colors X red and Y green; the rest follow a fixed, distinct order. */
const PROPERTY_COLORS: Record<string, string> = {
  translateX: "#ef4444",
  translateY: "#22c55e",
  scaleX: "#f97316",
  scaleY: "#14b8a6",
  rotation: "#3b82f6",
  alpha: "#eab308",
  fillAlpha: "#a855f7",
  strokeAlpha: "#ec4899",
  strokeWidth: "#06b6d4",
  trimPathStart: "#84cc16",
  trimPathEnd: "#f43f5e",
  trimPathOffset: "#8b5cf6",
};
const FALLBACK_COLORS = ["#0ea5e9", "#d946ef", "#10b981", "#f59e0b"];
const PADDING_TOP = 44; // room for the legend
const PADDING_BOTTOM = 20;

interface Track {
  property: string;
  color: string;
  blocks: TimelineBlock[];
  min: number;
  max: number;
}

const isNumeric = (block: TimelineBlock) =>
  typeof block.fromValue === "number" && typeof block.toValue === "number";

/**
 * After Effects' value graph for the selected layer: every numeric track as a
 * curve, each fit to its own height. Drag a keyframe to change its value, drag a
 * handle to reshape that segment's easing. Holds draw as steps.
 */
export function TimelineGraphEditor({
  contentWidth,
  gutter,
  stickyLeft,
}: {
  contentWidth: number;
  gutter: number;
  /** Width of the sticky names column, so the legend stays visible while scrolling. */
  stickyLeft: number;
}) {
  const blocks = useEditorStore((state) => state.animation.blocks);
  const duration = useEditorStore((state) => state.animation.duration);
  const layers = useEditorStore((state) => state.layers);
  const selectedLayerId = useEditorStore((state) => state.selectedLayerId);
  const selectedBlockIds = useEditorStore((state) => state.selectedBlockIds);
  const selectionKind = useEditorStore((state) => state.selectionKind);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [height, setHeight] = React.useState(240);
  // Ranges freeze while dragging so the curve does not rescale under the pointer.
  const [frozenRanges, setFrozenRanges] = React.useState<Map<
    string,
    { min: number; max: number }
  > | null>(null);

  React.useEffect(() => {
    const viewport = rootRef.current?.closest<HTMLElement>('[aria-label="Animation tracks"]');
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setHeight(Math.max(160, viewport.clientHeight)));
    observer.observe(viewport);
    setHeight(Math.max(160, viewport.clientHeight));
    return () => observer.disconnect();
  }, []);

  const layer: Layer | undefined =
    selectionKind === "layer"
      ? createLayerTreeModel(layers).allLayers.find(
          (item) => String(item.id) === String(selectedLayerId),
        )
      : undefined;

  const tracks = React.useMemo<Track[]>(() => {
    if (!layer) return [];
    const own = blocks.filter(
      (block) => String(block.layerId) === String(layer.id) && isNumeric(block),
    );
    // Like After Effects, selected properties narrow the graph; otherwise show them all.
    const selected = new Set(
      own.filter((block) => selectedBlockIds.includes(block.id)).map((b) => b.propertyName),
    );
    const names = [...new Set(own.map((block) => block.propertyName))].filter(
      (name) => !selected.size || selected.has(name),
    );
    return names.map((property, index) => {
      const propertyBlocks = own
        .filter((block) => block.propertyName === property)
        .sort((a, b) => a.startTime - b.startTime);
      const values = propertyBlocks.flatMap((block) => [
        Number(block.fromValue),
        Number(block.toValue),
      ]);
      const frozen = frozenRanges?.get(property);
      return {
        property,
        color: PROPERTY_COLORS[property] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length]!,
        blocks: propertyBlocks,
        min: frozen?.min ?? Math.min(...values),
        max: frozen?.max ?? Math.max(...values),
      };
    });
  }, [blocks, frozenRanges, layer, selectedBlockIds]);

  const width = contentWidth + gutter * 2;
  const innerHeight = Math.max(40, height - PADDING_TOP - PADDING_BOTTOM);
  const xAt = (time: number) => gutter + (time / Math.max(1, duration)) * contentWidth;
  const yAt = (track: Track, value: number) => {
    const span = track.max - track.min;
    const normalized = span < 1e-9 ? 0.5 : (value - track.min) / span;
    return PADDING_TOP + (1 - normalized) * innerHeight;
  };
  const valuePerPixel = (track: Track) => Math.max(1e-9, track.max - track.min || 1) / innerHeight;

  const beginDrag = (
    event: React.PointerEvent<SVGElement>,
    onMove: (dx: number, dy: number) => void,
  ) => {
    if (event.button !== 0 || !layer) return;
    event.stopPropagation();
    event.preventDefault();
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    setFrozenRanges(new Map(tracks.map((track) => [track.property, track])));
    useEditorStore.getState().beginHistoryGesture();
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return;
      onMove(moveEvent.clientX - startX, moveEvent.clientY - startY);
    };
    const end = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== event.pointerId) return;
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", end);
      element.removeEventListener("pointercancel", end);
      setFrozenRanges(null);
      useEditorStore.getState().endHistoryGesture();
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", end);
    element.addEventListener("pointercancel", end);
  };

  if (!layer || !tracks.length) {
    return (
      <div
        ref={rootRef}
        className="sticky top-0 flex min-w-0 flex-1 items-center justify-center bg-background p-6 text-center text-[12px] text-muted-foreground"
        style={{ height }}
      >
        {layer
          ? "This layer has no animated numbers yet. Animate position, scale, rotation, opacity or trim to see its graph."
          : "Select an animated layer to see its value graph."}
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      data-timeline-graph
      className="sticky top-0 min-w-0 flex-1 bg-background"
      style={{ height, width, position: "sticky" }}
    >
      <svg width={width} height={height} className="block" aria-label="Value graph">
        <line
          x1={xAt(0)}
          x2={xAt(duration)}
          y1={PADDING_TOP + innerHeight / 2}
          y2={PADDING_TOP + innerHeight / 2}
          stroke="var(--border)"
          strokeDasharray="2 4"
        />
        {tracks.map((track) => {
          const samples = Math.max(2, Math.round(contentWidth / 2));
          const d = Array.from({ length: samples + 1 }, (_, index) => {
            const time = (index / samples) * duration;
            const value = numberAtTime(layer, blocks, track.property, time, duration);
            return `${index ? "L" : "M"}${xAt(time).toFixed(1)} ${yAt(track, value).toFixed(1)}`;
          }).join(" ");
          const keyTimes = [
            ...new Set(track.blocks.flatMap((block) => [block.startTime, block.endTime])),
          ];
          return (
            <g key={track.property}>
              <path d={d} fill="none" stroke={track.color} strokeWidth={1.75} />
              {track.blocks.map((block) => {
                const from = Number(block.fromValue);
                const to = Number(block.toValue);
                if (block.interpolator === HOLD_INTERPOLATOR || Math.abs(to - from) < 1e-9)
                  return null;
                const [x1, y1, x2, y2] = interpolatorControlPoints(block.interpolator);
                const span = block.endTime - block.startTime;
                const handles = [
                  { index: 0, time: block.startTime + x1 * span, value: from + y1 * (to - from) },
                  { index: 1, time: block.startTime + x2 * span, value: from + y2 * (to - from) },
                ];
                const anchors = [
                  { x: xAt(block.startTime), y: yAt(track, from) },
                  { x: xAt(block.endTime), y: yAt(track, to) },
                ];
                return (
                  <g key={block.id} opacity={0.9}>
                    {handles.map((handle) => (
                      <React.Fragment key={handle.index}>
                        <line
                          x1={anchors[handle.index]!.x}
                          y1={anchors[handle.index]!.y}
                          x2={xAt(handle.time)}
                          y2={yAt(track, handle.value)}
                          stroke={track.color}
                          strokeOpacity={0.5}
                        />
                        <circle
                          data-graph-handle={`${block.id}:${handle.index}`}
                          cx={xAt(handle.time)}
                          cy={yAt(track, handle.value)}
                          r={4}
                          fill="var(--background)"
                          stroke={track.color}
                          strokeWidth={1.5}
                          style={{ cursor: "grab", touchAction: "none" }}
                          onPointerDown={(event) => {
                            const start = { x: handle.index ? x2 : x1, y: handle.index ? y2 : y1 };
                            const perPixelY = valuePerPixel(track) / (to - from);
                            beginDrag(event, (dx, dy) => {
                              const nx = Math.min(
                                1,
                                Math.max(
                                  0,
                                  start.x + dx / Math.max(1, (span / duration) * contentWidth),
                                ),
                              );
                              const ny = Math.min(3, Math.max(-2, start.y - dy * perPixelY));
                              const next: [number, number, number, number] = handle.index
                                ? [x1, y1, nx, ny]
                                : [nx, ny, x2, y2];
                              useEditorStore.getState().updateTimelineBlock(block.id, {
                                interpolator: `cubic-bezier(${next.map((n) => Number(n.toFixed(4))).join(", ")})`,
                              });
                            });
                          }}
                        >
                          <title>{`${propertyLabel(track.property)} easing handle · drag to reshape`}</title>
                        </circle>
                      </React.Fragment>
                    ))}
                  </g>
                );
              })}
              {keyTimes.map((time) => {
                const value = numberAtTime(layer, blocks, track.property, time, duration);
                return (
                  <rect
                    key={time}
                    data-graph-keyframe={`${track.property}:${time}`}
                    x={xAt(time) - 4.5}
                    y={yAt(track, value) - 4.5}
                    width={9}
                    height={9}
                    transform={`rotate(45 ${xAt(time)} ${yAt(track, value)})`}
                    fill={track.color}
                    stroke="var(--background)"
                    strokeWidth={1.5}
                    style={{ cursor: "ns-resize", touchAction: "none" }}
                    onPointerDown={(event) => {
                      const perPixel = valuePerPixel(track);
                      useEditorStore.getState().setProgress(time / Math.max(1, duration));
                      beginDrag(event, (_dx, dy) => {
                        const next = Math.round((value - dy * perPixel) * 1000) / 1000;
                        useEditorStore
                          .getState()
                          .setPropertiesAtPlayhead(layer.id, { [track.property]: next }, { time });
                      });
                    }}
                  >
                    <title>{`${propertyLabel(track.property)} · ${Math.round(value * 1000) / 1000} at ${Math.round(time)} ms · drag to change`}</title>
                  </rect>
                );
              })}
            </g>
          );
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0">
        <div
          className="sticky flex w-fit max-w-[60vw] flex-wrap gap-x-3 gap-y-1 p-2 text-[11px]"
          style={{ left: stickyLeft }}
        >
          {tracks.map((track) => (
            <span
              key={track.property}
              className="flex items-center gap-1.5 rounded bg-background/85 px-1.5 py-0.5 tabular-nums"
            >
              <span className="size-2 rounded-full" style={{ background: track.color }} />
              <span className="text-foreground">{propertyLabel(track.property)}</span>
              <span className="text-muted-foreground">
                {formatValue(track.min)} → {formatValue(track.max)}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

const formatValue = (value: number) => String(Math.round(value * 100) / 100);
