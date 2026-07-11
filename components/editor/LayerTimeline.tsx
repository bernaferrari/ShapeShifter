"use client";

import React from "react";
import {
  ChevronRight,
  Eye,
  EyeOff,
  ArrowDown,
  ArrowUp,
  Lock,
  Pause,
  Play,
  Plus,
  Square,
  Unlock,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useEditorStore } from "@/lib/store/editorStore";
import type { Layer, TimelineBlock, InterpolatorName } from "@/lib/shapeshifter/types";
import { propertyLabel } from "@/lib/shapeshifter/propertyLabels";
import { cn } from "@/lib/utils";
import { EasingCurve } from "./EasingCurve";
import { INTERPOLATOR_CURVES } from "@/lib/shapeshifter/interpolators";

/**
 * Android AVD-supported named interpolators (ObjectAnimator / PathInterpolator presets).
 * Kept as a compact menu on the track — not a big curve editor (Android has no freehand ease UI).
 */
const INTERPOLATOR_OPTIONS: { value: InterpolatorName | string; label: string; hint: string }[] = [
  { value: "FAST_OUT_SLOW_IN", label: "Standard", hint: "fast_out_slow_in" },
  { value: "LINEAR_OUT_SLOW_IN", label: "Decelerate", hint: "linear_out_slow_in" },
  { value: "FAST_OUT_LINEAR_IN", label: "Accelerate", hint: "fast_out_linear_in" },
  { value: "ACCELERATE_DECELERATE", label: "Accelerate–decelerate", hint: "accelerate_decelerate" },
  { value: "LINEAR", label: "Linear", hint: "linear" },
];

function curvePointsFor(interp: string | undefined): [number, number, number, number] {
  if (interp && interp in INTERPOLATOR_CURVES) {
    return INTERPOLATOR_CURVES[interp as InterpolatorName];
  }
  const m = interp?.match(
    /cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/i,
  );
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  return INTERPOLATOR_CURVES.FAST_OUT_SLOW_IN;
}

/** Figma playhead */
const PLAYHEAD = "#F24822";
/** Selected / active clip accent */
const FIGMA_BLUE = "#0C8CE9";
/** Selected property row band */
const ROW_SEL = "bg-[#2A3544]";
const SURFACE = "bg-[#2C2C2C]";
const SURFACE_TRACK = "bg-[#1E1E1E]";

const ROW_LAYER = 30;
const ROW_PROP = 28;
const HEADER_H = 36;
const LAYERS_W = 200;
/** Figma clip heights — object slightly thicker than property */
const CLIP_H_OBJ = 10;
const CLIP_H_PROP = 18;

interface LayerTimelineProps {
  onOpenSVGImport: () => void;
  onExport: (type: string) => void;
  onLoadSample: (index: number) => void;
}

function formatCompactValue(
  value: string | number | undefined,
  propertyName?: string,
): string {
  if (value == null || value === "") return "—";
  // Never dump raw path data into the timeline (Figma shows tidy property values)
  if (propertyName === "pathData" || (typeof value === "string" && /^[MmLlHhVvCcSsQqTtAaZz]/.test(value.trim()))) {
    return "Path";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    const abs = Math.abs(value);
    if (propertyName === "rotation") return `${Number(value.toFixed(1))}°`;
    if (propertyName === "scaleX" || propertyName === "scaleY")
      return `${Math.round(value * 100)}%`;
    if (abs >= 100) return String(Math.round(value));
    if (abs >= 10) return value.toFixed(1).replace(/\.0$/, "");
    return value.toFixed(2).replace(/\.?0+$/, "");
  }
  const s = String(value);
  if (s.startsWith("#") && (s.length === 7 || s.length === 9)) return s.toUpperCase();
  if (s.length > 10) return `${s.slice(0, 8)}…`;
  return s;
}

/** Hollow diamond keyframes — Figma motion timeline (losange). */
function KeyframeDiamond({
  active,
  size = 7,
  className,
}: {
  active?: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        // block + fixed box so rotate-45 pivots on true geometric center
        // (inline-block + line-height was offsetting the diamond vs the rail).
        "block shrink-0 rotate-45 rounded-[0.5px] border border-solid transition-colors",
        active ? "bg-[#0C8CE9]" : "bg-[#2C2C2C] hover:bg-[#0C8CE9]/20",
        className,
      )}
      style={{
        width: size,
        height: size,
        boxSizing: "border-box",
        borderColor: FIGMA_BLUE,
        borderWidth: 1.25,
        backgroundColor: active ? FIGMA_BLUE : undefined,
        transformOrigin: "center center",
      }}
      aria-hidden
    />
  );
}

export function LayerTimeline(_props: LayerTimelineProps) {
  const {
    frames,
    selectedFrameId,
    selectFrame,
    layers,
    selectedLayerId,
    selectLayer,
    selectedLayerIds,
    selectionKind,
    hasCanvasSelection,
    toggleLayerVisibility,
    toggleLayerLock,
    nudgeLayerZOrder,
    addLayer,
    selectedBlockIds,
    updateTimelineBlock,
    progress,
    animation,
    selectBlocks,
    timelineCollapsed,
    setAnimationDuration,
    isPlaying,
    togglePlayback,
  } = useEditorStore();

  const currentTimeMs = Math.round(progress * animation.duration);
  const currentTimeSec = currentTimeMs / 1000;
  const durationSec = animation.duration / 1000;
  /**
   * Figma motion ruler labels: short clips in whole ms (0 · 200 · 400),
   * longer clips in seconds with one decimal (0.0 · 0.5 · 1.0).
   */
  const formatTimeMark = (timeMs: number) => {
    if (animation.duration <= 2000) return String(Math.round(timeMs));
    return (timeMs / 1000).toFixed(1);
  };
  /** Position (translate) uses Figma keyframe diamonds, not a filled clip bar. */
  const isPositionProperty = (name: string) =>
    name === "translateX" || name === "translateY";
  const isTimelineEmpty = frames.every((f) => (f.animation?.blocks?.length ?? 0) === 0) &&
    animation.blocks.length === 0;
  const [emptyHintDismissed, setEmptyHintDismissed] = React.useState(false);
  React.useEffect(() => {
    // Re-show the empty card when the timeline becomes empty again
    if (isTimelineEmpty) setEmptyHintDismissed(false);
  }, [isTimelineEmpty]);

  /** Drag one or many blocks (layer summary bar moves all layer blocks together). */
  type DragSession = {
    startX: number;
    items: { id: string; originalStart: number; originalEnd: number }[];
  };
  type ResizeSession = {
    id: string;
    edge: "start" | "end";
    startX: number;
    originalStart: number;
    originalEnd: number;
  };
  const draggingRef = React.useRef<DragSession | null>(null);
  const resizingRef = React.useRef<ResizeSession | null>(null);
  const [, bumpDrag] = React.useState(0);
  const setDraggingBlocks = (session: DragSession | null) => {
    draggingRef.current = session;
    bumpDrag((n) => n + 1);
  };
  const setResizingBlock = (session: ResizeSession | null) => {
    resizingRef.current = session;
    bumpDrag((n) => n + 1);
  };
  const [hoveredRowKey, setHoveredRowKey] = React.useState<string | null>(null);
  /** Draft text while the current-time readout is being typed into (click-to-edit, like the duration field). */
  const [timeDraft, setTimeDraft] = React.useState<string | null>(null);
  /** Row key of the layer currently being renamed inline (double-click on its name, like Figma). */
  const [renamingLayerKey, setRenamingLayerKey] = React.useState<string | null>(null);

  const leftScrollRef = React.useRef<HTMLDivElement>(null);
  const rightScrollRef = React.useRef<HTMLDivElement>(null);
  const syncingScroll = React.useRef(false);

  const syncScroll = (source: "left" | "right") => {
    if (syncingScroll.current) return;
    syncingScroll.current = true;
    const from = source === "left" ? leftScrollRef.current : rightScrollRef.current;
    const to = source === "left" ? rightScrollRef.current : leftScrollRef.current;
    if (from && to) to.scrollTop = from.scrollTop;
    requestAnimationFrame(() => {
      syncingScroll.current = false;
    });
  };

  type TimelineRow =
    | {
        kind: "frame";
        frameId: string;
        name: string;
        depth: number;
        key: string;
        expanded: boolean;
      }
    | {
        kind: "object";
        /** Figma object row: one layer = one blue clip bar */
        frameId: string;
        layer: Layer;
        name: string;
        depth: number;
        key: string;
        /** Group rows can expand/collapse nested children */
        expandable?: boolean;
        expanded?: boolean;
      }
    | {
        kind: "property";
        frameId: string;
        layer: Layer;
        propertyName: string;
        depth: number;
        key: string;
      };

  // Document-wide tree (Figma): every frame, then its layers, then animated properties.
  // Active frame uses live `layers`/`animation`; others use the snapshot on `frames[]`.
  const [collapsedFrameIds, setCollapsedFrameIds] = React.useState<Set<string>>(() => new Set());
  const toggleFrameExpanded = (frameId: string) => {
    setCollapsedFrameIds((prev) => {
      const next = new Set(prev);
      if (next.has(frameId)) next.delete(frameId);
      else next.add(frameId);
      return next;
    });
  };

  const contentForFrame = (frameId: string) => {
    if (frameId === selectedFrameId) {
      return { layers, animation };
    }
    const fr = frames.find((f) => f.id === frameId);
    return {
      layers: fr?.layers ?? [],
      animation: fr?.animation ?? { id: "", name: "", duration: 1000, blocks: [] as typeof animation.blocks },
    };
  };

  /**
   * Timeline property tracks under a layer — excludes `pathData`.
   * Path morph *is* the shape (the layer/object clip bar), not a nested "Path" row.
   * Only secondary attrs (fill, stroke, trim, transforms…) get property tracks.
   */
  const propertiesFor = (frameId: string, layerId: string | number) => {
    const { animation: anim } = contentForFrame(frameId);
    const names = Array.from(
      new Set(
        anim.blocks
          .filter((block) => String(block.layerId) === String(layerId))
          .map((block) => block.propertyName)
          .filter((name) => name !== "pathData"),
      ),
    );
    // Prefer a single Position track (X) when both axes exist — Figma shows one "Position" row.
    // Y still animates via its block; we only de-clutter the tree. Full dual-axis editor later.
    const hasX = names.includes("translateX");
    const ordered = names.filter((n) => !(n === "translateY" && hasX));
    const rank = (n: string) =>
      n === "translateX" || n === "translateY"
        ? 0
        : n === "rotation"
          ? 1
          : n.startsWith("scale")
            ? 2
            : 3;
    return ordered.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  };
  const blocksForLayerInFrame = (frameId: string, layerId: string | number) => {
    const { animation: anim } = contentForFrame(frameId);
    return anim.blocks.filter((block) => String(block.layerId) === String(layerId));
  };
  const blocksForPropertyInFrame = (
    frameId: string,
    layerId: string | number,
    propertyName: string,
  ) => {
    const { animation: anim } = contentForFrame(frameId);
    return anim.blocks.filter(
      (block) =>
        String(block.layerId) === String(layerId) && block.propertyName === propertyName,
    );
  };

  /**
   * Figma motion timeline model:
   *   Frame (container, collapsible)
   *     └─ Layer (object row + blue clip bar)  ← every layer, never flattened
   *          └─ Property tracks (fill, stroke, … — not pathData)
   * Nested group children are listed under their group when expanded.
   */
  const [collapsedGroupKeys, setCollapsedGroupKeys] = React.useState<Set<string>>(
    () => new Set(),
  );
  const toggleGroupExpanded = (key: string) => {
    setCollapsedGroupKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const pushLayerTree = (
    rows: TimelineRow[],
    frameId: string,
    layerList: Layer[],
    depth: number,
  ) => {
    for (const layer of layerList) {
      // Skip pure vector metadata nodes; path / clip / group are timeline objects
      if (layer.type === "vector") continue;

      const objectKey = `object-${frameId}-${layer.id}`;
      const childLayers = layer.children?.filter(Boolean) ?? [];
      const hasChildren = childLayers.length > 0;
      const groupExpanded = !collapsedGroupKeys.has(objectKey);

      rows.push({
        kind: "object",
        frameId,
        layer,
        name: layer.name || "Layer",
        depth,
        key: objectKey,
        expandable: hasChildren || layer.type === "group",
        expanded: hasChildren ? groupExpanded : undefined,
      });

      // Non-path property tracks sit under this object (Figma: Position, Rotation, …)
      for (const propertyName of propertiesFor(frameId, layer.id)) {
        rows.push({
          kind: "property",
          frameId,
          layer,
          propertyName,
          depth: depth + 1,
          key: `prop-${frameId}-${layer.id}-${propertyName}`,
        });
      }

      if (hasChildren && groupExpanded) {
        pushLayerTree(rows, frameId, childLayers, depth + 1);
      }
    }
  };

  // Figma-like: show ONLY the selected frame's tracks (the frame itself, or the frame that
  // contains the selected layer). Listing every frame at once is the clutter the user wants gone.
  const timelineRows: TimelineRow[] = [];
  const framesToShow =
    frames.some((f) => f.id === selectedFrameId)
      ? frames.filter((f) => f.id === selectedFrameId)
      : frames;
  for (const frame of framesToShow) {
    const { layers: frameLayers } = contentForFrame(frame.id);
    // Top-level layers only (children nest under groups). Also surface root layers
    // that use parentId so flat lists still work.
    const roots = frameLayers.filter((l) => {
      if (l.parentId != null && l.parentId !== "") {
        // Has a parent — only show at root if parent isn't in this list (orphan safety)
        return !frameLayers.some((p) => String(p.id) === String(l.parentId));
      }
      return true;
    });

    const frameExpanded = !collapsedFrameIds.has(frame.id);
    timelineRows.push({
      kind: "frame",
      frameId: frame.id,
      name: frame.name,
      depth: 0,
      key: `frame-${frame.id}`,
      expanded: frameExpanded,
    });

    if (!frameExpanded) continue;

    // Every layer gets its own row under the frame — Figma never flattens this away
    pushLayerTree(timelineRows, frame.id, roots.length ? roots : frameLayers, 1);
  }

  const setProgressFromClientX = (clientX: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    useEditorStore.getState().setProgress(x / Math.max(1, rect.width));
  };

  const beginScrub = (e: React.PointerEvent<HTMLElement>) => {
    // Figma pauses playback while you scrub the ruler, so the playhead RAF
    // loop can't fight the drag. Just pause — don't auto-resume on release.
    if (useEditorStore.getState().isPlaying) {
      useEditorStore.getState().togglePlayback();
    }
    const element = e.currentTarget;
    setProgressFromClientX(e.clientX, element);
    try {
      element.setPointerCapture(e.pointerId);
    } catch {
      /* ignore — scrubbing still works via the window listeners below */
    }
    const onMove = (moveEvent: PointerEvent) => setProgressFromClientX(moveEvent.clientX, element);
    const onUp = (upEvent: PointerEvent) => {
      try {
        element.releasePointerCapture(upEvent.pointerId);
      } catch {
        /* ignore */
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const jumpToMs = (ms: number) => {
    useEditorStore
      .getState()
      .setProgress(Math.max(0, Math.min(1, ms / Math.max(1, animation.duration))));
  };

  const renderPropertyBlock = (block: TimelineBlock) => {
    const isSelected = selectedBlockIds.includes(block.id);
    const leftPct = (block.startTime / animation.duration) * 100;
    const widthPct = Math.max(
      0.8,
      ((block.endTime - block.startTime) / animation.duration) * 100,
    );
    const interp = block.interpolator || "FAST_OUT_SLOW_IN";
    const isLinear = interp === "LINEAR";
    const asKeyframes = isPositionProperty(block.propertyName);

    const handleDragStart = (e: React.PointerEvent) => {
      e.stopPropagation();
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* ignore — the drag session below still drives the move via this element's own listeners */
      }
      setDraggingBlocks({
        startX: e.clientX,
        items: [{ id: block.id, originalStart: block.startTime, originalEnd: block.endTime }],
      });
      useEditorStore.getState().selectBlocks([block.id]);
    };

    const trackWidth = (el: HTMLElement) => {
      const track = el.closest("[data-timeline-row]") as HTMLElement | null;
      return Math.max(1, track?.getBoundingClientRect().width ?? 300);
    };

    const handleDragMove = (e: React.PointerEvent) => {
      const session = draggingRef.current;
      if (!session || !session.items.some((i) => i.id === block.id)) return;
      const width = trackWidth(e.currentTarget as HTMLElement);
      const deltaTime = ((e.clientX - session.startX) / width) * animation.duration;
      const store = useEditorStore.getState();
      let shift = deltaTime;
      for (const item of session.items) {
        const dur = item.originalEnd - item.originalStart;
        const maxStart = animation.duration - dur;
        const proposed = item.originalStart + shift;
        if (proposed < 0) shift = -item.originalStart;
        if (proposed > maxStart) shift = maxStart - item.originalStart;
      }
      for (const item of session.items) {
        const itemDur = item.originalEnd - item.originalStart;
        // ROUND first, then RE-CLAMP so the 50ms snap can never shrink a
        // block below its own duration or push it outside the timeline.
        let newStart = Math.round((item.originalStart + shift) / 50) * 50;
        newStart = Math.max(0, Math.min(animation.duration - itemDur, newStart));
        const newEnd = newStart + itemDur;
        store.updateTimelineBlock(item.id, { startTime: newStart, endTime: newEnd });
      }
    };

    const handleDragEnd = (e: React.PointerEvent) => {
      setDraggingBlocks(null);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };

    const handleResizeStart = (edge: "start" | "end") => (e: React.PointerEvent) => {
      e.stopPropagation();
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* ignore — the resize session below still drives the move via this element's own listeners */
      }
      setResizingBlock({
        id: block.id,
        edge,
        startX: e.clientX,
        originalStart: block.startTime,
        originalEnd: block.endTime,
      });
      useEditorStore.getState().selectBlocks([block.id]);
    };

    const handleResizeMove = (e: React.PointerEvent) => {
      const resizingBlock = resizingRef.current;
      if (!resizingBlock || resizingBlock.id !== block.id) return;
      const width = trackWidth(e.currentTarget as HTMLElement);
      const deltaTime = ((e.clientX - resizingBlock.startX) / width) * animation.duration;
      const minDur = 50;
      let newStart = resizingBlock.originalStart;
      let newEnd = resizingBlock.originalEnd;
      if (resizingBlock.edge === "start") {
        // ROUND first, then RE-CLAMP so the 50ms snap can't push the edge
        // past the minimum-size boundary (originalEnd - minDur).
        newStart = Math.round((resizingBlock.originalStart + deltaTime) / 50) * 50;
        newStart = Math.max(0, Math.min(resizingBlock.originalEnd - minDur, newStart));
      } else {
        newEnd = Math.round((resizingBlock.originalEnd + deltaTime) / 50) * 50;
        newEnd = Math.max(
          resizingBlock.originalStart + minDur,
          Math.min(animation.duration, newEnd),
        );
      }
      useEditorStore.getState().updateTimelineBlock(block.id, {
        startTime: newStart,
        endTime: newEnd,
      });
    };

    const handleResizeEnd = (e: React.PointerEvent) => {
      setResizingBlock(null);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };

    const label = propertyLabel(block.propertyName);

    // ── Figma Position: thin rail + diamond keyframe breakpoints (not a clip bar) ──
    if (asKeyframes) {
      const startPct = (block.startTime / animation.duration) * 100;
      const endPct = (block.endTime / animation.duration) * 100;
      const diamondSize = 7;
      // Shared mid-line for rail + diamonds so the line threads the lozenge centers.
      const midY = "top-1/2 -translate-y-1/2";
      return (
        <div key={block.id} className="pointer-events-none absolute inset-0 z-[1]">
          {/* Segment rail — same vertical mid as the diamonds */}
          <div
            className={cn(
              "pointer-events-auto absolute h-px cursor-grab active:cursor-grabbing",
              midY,
              isSelected ? "bg-[#0C8CE9]/55" : "bg-[#0C8CE9]/35 hover:bg-[#0C8CE9]/50",
            )}
            style={{
              left: `${startPct}%`,
              width: `${Math.max(0, endPct - startPct)}%`,
            }}
            title={`${label}: ${block.startTime}–${block.endTime}ms`}
            onPointerDown={handleDragStart}
            onPointerMove={handleDragMove}
            onPointerUp={handleDragEnd}
            onPointerCancel={handleDragEnd}
            onClick={(e) => {
              e.stopPropagation();
              useEditorStore.getState().toggleBlockSelection(block.id);
            }}
          />
          {/* Start keyframe — flex box so the rotated diamond sits on the rail mid-line */}
          <button
            type="button"
            className={cn(
              "pointer-events-auto absolute z-10 flex size-5 -translate-x-1/2 cursor-ew-resize items-center justify-center p-0",
              midY,
            )}
            style={{ left: `${startPct}%` }}
            title={`Keyframe @ ${block.startTime}ms`}
            onPointerDown={handleResizeStart("start")}
            onPointerMove={handleResizeMove}
            onPointerUp={handleResizeEnd}
            onPointerCancel={handleResizeEnd}
            onClick={(e) => {
              e.stopPropagation();
              useEditorStore.getState().selectBlocks([block.id]);
              jumpToMs(block.startTime);
            }}
          >
            <KeyframeDiamond active={isSelected} size={diamondSize} />
          </button>
          {/* End keyframe */}
          <button
            type="button"
            className={cn(
              "pointer-events-auto absolute z-10 flex size-5 -translate-x-1/2 cursor-ew-resize items-center justify-center p-0",
              midY,
            )}
            style={{ left: `${endPct}%` }}
            title={`Keyframe @ ${block.endTime}ms`}
            onPointerDown={handleResizeStart("end")}
            onPointerMove={handleResizeMove}
            onPointerUp={handleResizeEnd}
            onPointerCancel={handleResizeEnd}
            onClick={(e) => {
              e.stopPropagation();
              useEditorStore.getState().selectBlocks([block.id]);
              jumpToMs(block.endTime);
            }}
          >
            <KeyframeDiamond active={isSelected} size={diamondSize} />
          </button>
          {/* Interpolator control when selected — floats just above the rail
              instead of sitting on the mid-point, which used to intercept the
              exact spot users grab to drag the rail (BUG-timeline-drag-1). */}
          {isSelected && (
            <div
              className="pointer-events-auto absolute -top-4 z-[3] -translate-x-1/2"
              style={{ left: `${(startPct + endPct) / 2}%` }}
            >
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      className="flex size-4 items-center justify-center rounded-[3px] border border-white/12 bg-[#2C2C2C] text-[#0C8CE9] shadow-sm outline-none hover:border-[#0C8CE9]/45 hover:bg-[#333] active:scale-[0.96]"
                      title={`Interpolator: ${INTERPOLATOR_OPTIONS.find((o) => o.value === interp)?.label ?? interp}`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    />
                  }
                >
                  {isLinear ? (
                    <svg width="11" height="9" viewBox="0 0 12 10" fill="none" aria-hidden>
                      <path
                        d="M1.5 8.5 L10.5 1.5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  ) : (
                    <svg width="11" height="9" viewBox="0 0 12 10" fill="none" aria-hidden>
                      <path
                        d="M1 8.5C3.5 8.5 4 1.5 11 1.5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  )}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center" className="w-56 text-xs" side="top">
                  <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Easing
                  </div>
                  <div
                    className="flex justify-center border-b border-border/60 px-2 py-2"
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <EasingCurve
                      size={88}
                      points={curvePointsFor(interp)}
                      progress={progress}
                      onChange={([x1, y1, x2, y2]) => {
                        updateTimelineBlock(block.id, {
                          interpolator: `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`,
                        });
                      }}
                    />
                  </div>
                  {INTERPOLATOR_OPTIONS.map((opt) => (
                    <DropdownMenuItem
                      key={opt.value}
                      className={cn(interp === opt.value && "bg-primary/10 text-primary")}
                      onClick={(e) => {
                        e.stopPropagation();
                        updateTimelineBlock(block.id, { interpolator: opt.value });
                      }}
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span>{opt.label}</span>
                        <span className="font-mono text-[10px] text-muted-foreground/80">
                          {opt.hint}
                        </span>
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      );
    }

    // Figma-style: labeled graphite clip with end grips (Rotation, fill, trim, …)
    return (
      <div
        key={block.id}
        className="absolute inset-y-0 z-[1] flex items-center"
        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
      >
        <div
          className={cn(
            "relative flex h-full max-h-[18px] w-full min-w-[28px] cursor-grab items-center justify-center overflow-hidden rounded-sm border active:cursor-grabbing",
            isSelected
              ? "border-[#0C8CE9]/50 bg-[#3D4F63] ring-1 ring-[#0C8CE9]/25"
              : "border-white/[0.08] bg-[#444444] hover:bg-[#4C4C4C]",
          )}
          style={{ height: CLIP_H_PROP }}
          title={`${label}: ${block.startTime}–${block.endTime}ms`}
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
          onClick={(e) => {
            e.stopPropagation();
            useEditorStore.getState().toggleBlockSelection(block.id);
          }}
        >
          <span className="pointer-events-none absolute inset-y-[3px] left-[3px] w-[2px] rounded-full bg-white/25" />
          <span className="pointer-events-none absolute inset-y-[3px] right-[3px] w-[2px] rounded-full bg-white/25" />
          <span
            className={cn(
              "pointer-events-none truncate px-3 text-center text-[10px] font-medium tracking-tight",
              isSelected ? "text-white/90" : "text-white/55",
            )}
          >
            {label}
          </span>
          {isSelected && (
            // Floats just above the clip instead of dead-center, which used to sit
            // exactly where users grab to drag the block (BUG-timeline-drag-1).
            <div className="absolute left-1/2 -top-4 z-[3] -translate-x-1/2">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      className="flex size-4 items-center justify-center rounded-[3px] border border-white/12 bg-[#2C2C2C] text-[#0C8CE9] shadow-sm outline-none hover:border-[#0C8CE9]/45 hover:bg-[#333] active:scale-[0.96]"
                      title={`Interpolator: ${INTERPOLATOR_OPTIONS.find((o) => o.value === interp)?.label ?? interp}`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    />
                  }
                >
                {isLinear ? (
                  <svg width="11" height="9" viewBox="0 0 12 10" fill="none" aria-hidden>
                    <path
                      d="M1.5 8.5 L10.5 1.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                ) : (
                  <svg width="11" height="9" viewBox="0 0 12 10" fill="none" aria-hidden>
                    <path
                      d="M1 8.5C3.5 8.5 4 1.5 11 1.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                )}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="w-52 text-xs" side="top">
                <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Android interpolator
                </div>
                {INTERPOLATOR_OPTIONS.map((opt) => (
                  <DropdownMenuItem
                    key={opt.value}
                    className={cn(interp === opt.value && "bg-primary/10 text-primary")}
                    onClick={(e) => {
                      e.stopPropagation();
                      updateTimelineBlock(block.id, { interpolator: opt.value });
                    }}
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span>{opt.label}</span>
                      <span className="font-mono text-[10px] text-muted-foreground/80">
                        {opt.hint}
                      </span>
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          )}
          {/* Edge resize hit targets */}
          <button
            type="button"
            className="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize"
            aria-label="Trim start"
            onPointerDown={handleResizeStart("start")}
            onPointerMove={handleResizeMove}
            onPointerUp={handleResizeEnd}
            onPointerCancel={handleResizeEnd}
          />
          <button
            type="button"
            className="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize"
            aria-label="Trim end"
            onPointerDown={handleResizeStart("end")}
            onPointerMove={handleResizeMove}
            onPointerUp={handleResizeEnd}
            onPointerCancel={handleResizeEnd}
          />
        </div>
      </div>
    );
  };

  /**
   * Figma-style time ruler: pick a “nice” major step in ms, subdivide with minor ticks.
   * Short clips → 100/200ms majors (labels 0 · 200 · 400); longer → 0.5s / 1s majors.
   */
  const rulerMajorStepMs = (() => {
    const d = Math.max(100, animation.duration);
    const candidates = [50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];
    // Aim for ~5–8 labeled majors across the visible width
    const target = d / 6;
    let best = candidates[0];
    for (const c of candidates) {
      if (c <= target * 1.35) best = c;
      else break;
    }
    // Prefer at least 4 majors when possible
    while (best > 50 && d / best < 3.5) {
      const idx = candidates.indexOf(best);
      best = candidates[Math.max(0, idx - 1)] ?? best;
      if (idx <= 0) break;
    }
    return best;
  })();
  const rulerMajorCount = Math.max(1, Math.round(animation.duration / rulerMajorStepMs));
  const rulerMinorPerMajor = rulerMajorStepMs >= 500 ? 5 : rulerMajorStepMs >= 200 ? 4 : 2;
  const rulerMinorStepMs = rulerMajorStepMs / rulerMinorPerMajor;

  return (
    <section
      className={cn(
        "relative z-20 flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-t border-black/40",
        SURFACE,
      )}
    >
      {/* ── Unified playhead (head in ruler, needle through tracks) ── */}
      {!isTimelineEmpty && (
        <div
          className="pointer-events-none absolute bottom-0 top-0 z-[60] w-0"
          style={{
            left: `calc(${LAYERS_W}px + (100% - ${LAYERS_W}px) * ${progress})`,
          }}
          aria-hidden
        >
          {/* Head sits at the very top of the ruler, like Figma's playhead flag */}
          <div className="absolute left-1/2 top-0 -translate-x-1/2">
            <svg width="10" height="9" viewBox="0 0 10 9" fill="none">
              <path d="M0 0H10V5.5L5 9L0 5.5V0Z" fill={PLAYHEAD} />
            </svg>
          </div>
          {/* Hairline needle — full track height under the head */}
          <div
            className="absolute bottom-0 left-1/2 w-px -translate-x-1/2"
            style={{ top: 9, backgroundColor: PLAYHEAD }}
          />
        </div>
      )}

      {/* ══ Top bar: transport | ruler (one continuous Figma row) ══ */}
      <div
        className="relative z-10 flex shrink-0 border-b border-white/[0.06]"
        style={{ height: HEADER_H }}
      >
        <div
          className="flex shrink-0 items-center gap-0.5 border-r border-white/[0.06] px-1.5"
          style={{ width: LAYERS_W }}
        >
          <button
            type="button"
            className="grid size-6 place-items-center rounded text-white/70 transition-colors hover:bg-white/[0.07] hover:text-white active:scale-[0.96]"
            aria-label={isPlaying ? "Pause" : "Play"}
            onClick={() => togglePlayback()}
          >
            {isPlaying ? (
              <Pause className="size-3 fill-current" strokeWidth={0} />
            ) : (
              <Play className="size-3 fill-current" strokeWidth={0} />
            )}
          </button>
          <div className="flex min-w-0 items-baseline gap-[3px] font-mono text-[11px] tabular-nums leading-none tracking-tight">
            <input
              type="number"
              min={0}
              step={0.05}
              value={timeDraft ?? currentTimeSec.toFixed(2)}
              onFocus={() => setTimeDraft(currentTimeSec.toFixed(2))}
              onChange={(e) => setTimeDraft(e.target.value)}
              onBlur={() => {
                const n = Number(timeDraft);
                if (Number.isFinite(n)) jumpToMs(Math.round(n * 1000));
                setTimeDraft(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape") {
                  (e.target as HTMLInputElement).blur();
                }
              }}
              aria-label="Current time in seconds"
              className="w-[34px] border-0 bg-transparent p-0 font-medium tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
              style={{ color: PLAYHEAD }}
            />
            <span className="text-white/20">/</span>
            <input
              type="number"
              min={0.1}
              step={0.05}
              value={Number(durationSec.toFixed(2))}
              onChange={(e) => {
                const n = Number(e.target.value);
                // Match the store's >=100ms clamp so the input round-trips:
                // e.g. typing 0.05 lands on 0.10 instead of being silently clamped.
                if (Number.isFinite(n) && n > 0) {
                  setAnimationDuration(Math.max(100, Math.round(n * 1000)));
                }
              }}
              aria-label="Animation duration in seconds"
              className="h-4 w-[34px] border-0 bg-transparent p-0 text-[11px] tabular-nums text-white/50 outline-none [appearance:textfield] hover:text-white/80 focus:text-white [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-white/25">s</span>
          </div>
          <div className="flex-1" />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="size-6 rounded text-white/30 hover:bg-white/[0.06] hover:text-white/80"
                  aria-label="Add layer"
                />
              }
            >
              <Plus className="h-3 w-3" strokeWidth={1.75} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => addLayer("path")}>New path</DropdownMenuItem>
              <DropdownMenuItem onClick={() => addLayer("clipPath")}>New clip path</DropdownMenuItem>
              <DropdownMenuItem onClick={() => addLayer("group")}>New group layer</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Ruler — Figma motion: continuous baseline, major labels, minor ticks */}
        <div
          className={cn(
            "relative min-w-0 flex-1 select-none",
            isTimelineEmpty ? "cursor-default" : "cursor-ew-resize",
          )}
          onPointerDown={isTimelineEmpty ? undefined : beginScrub}
        >
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {/* Continuous top baseline (the “ruler edge”) */}
            <div className="absolute inset-x-0 top-0 h-px bg-white/[0.08]" />
            {/* Continuous bottom rail where ticks rest */}
            <div className="absolute inset-x-0 bottom-0 h-px bg-white/[0.1]" />

            {/* Minor ticks (skip majors) */}
            {Array.from(
              {
                length: Math.floor(animation.duration / rulerMinorStepMs) + 1,
              },
              (_, index) => {
                const ms = index * rulerMinorStepMs;
                if (ms <= 0 || ms >= animation.duration) return null;
                // Skip major positions (integer-safe via nearest major)
                const nearMajor =
                  Math.round(ms / rulerMajorStepMs) * rulerMajorStepMs;
                if (Math.abs(ms - nearMajor) < 0.01) return null;
                const t = ms / animation.duration;
                return (
                  <span
                    key={`min-${index}`}
                    className="absolute bottom-0 w-px bg-white/[0.14]"
                    style={{ left: `${t * 100}%`, height: 4 }}
                  />
                );
              },
            )}

            {/* Major ticks + labels */}
            {Array.from({ length: rulerMajorCount + 1 }, (_, index) => {
              const atEnd = index === rulerMajorCount;
              const ms = atEnd
                ? animation.duration
                : Math.min(animation.duration, index * rulerMajorStepMs);
              const t = ms / Math.max(1, animation.duration);
              // Drop end label when the last major already sits on duration (duplicate)
              // or when the partial tail is too short to read.
              const prevMs = atEnd ? (index - 1) * rulerMajorStepMs : -1;
              const showLabel =
                !atEnd ||
                (animation.duration - prevMs > rulerMajorStepMs * 0.4 &&
                  Math.abs(animation.duration - prevMs - rulerMajorStepMs) > 1);
              return (
                <div
                  key={`maj-${index}`}
                  className="absolute bottom-0"
                  style={{
                    left: `${t * 100}%`,
                    transform: atEnd ? "translateX(-1px)" : undefined,
                  }}
                >
                  <span className="absolute bottom-0 left-0 h-[7px] w-px bg-white/30" />
                  {showLabel && (
                    <span
                      className={cn(
                        "absolute bottom-[10px] whitespace-nowrap font-mono text-[10px] tabular-nums leading-none text-white/42",
                        atEnd ? "-translate-x-full pr-0.5" : "left-0 pl-[3px]",
                      )}
                    >
                      {formatTimeMark(ms)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {/* Draggable duration grip (Figma): drag the ruler's right edge to change duration.
              Left = shorter, right = longer, scaled to the drag distance. */}
          {!isTimelineEmpty && (
            <div
              role="slider"
              aria-label="Animation duration"
              title="Drag to change duration"
              className="absolute right-0 top-0 bottom-0 z-10 w-2 cursor-ew-resize bg-white/0 hover:bg-white/[0.12]"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation(); // don't start a scrub
                const ruler = e.currentTarget.parentElement;
                if (!ruler) return;
                const startWidth = Math.max(1, ruler.getBoundingClientRect().width);
                const startDur = animation.duration;
                const startX = e.clientX;
                try {
                  e.currentTarget.setPointerCapture(e.pointerId);
                } catch {
                  /* ignore — the window listeners below still drive the resize */
                }
                const move = (ev: PointerEvent) => {
                  const dx = ev.clientX - startX;
                  const factor = Math.max(0.1, (startWidth + dx) / startWidth);
                  setAnimationDuration(Math.max(100, Math.round(startDur * factor)));
                };
                const up = () => {
                  window.removeEventListener("pointermove", move);
                  window.removeEventListener("pointerup", up);
                };
                window.addEventListener("pointermove", move);
                window.addEventListener("pointerup", up);
              }}
            />
          )}
        </div>
      </div>

      {/* ══ Body: names | tracks ══ */}
      <div className="relative flex min-h-0 flex-1">
        {/* Names */}
        <div
          ref={leftScrollRef}
          className="min-h-0 shrink-0 overflow-y-auto overflow-x-hidden border-r border-white/[0.06]"
          style={{ width: LAYERS_W }}
          onScroll={() => syncScroll("left")}
        >
          {timelineRows.map((row) => {
            if (row.kind === "frame") {
              // Figma: frame row is selected only when selectionKind is the frame (not a child).
              const isActive =
                hasCanvasSelection &&
                selectionKind === "frame" &&
                row.frameId === selectedFrameId;
              return (
                <div
                  key={row.key}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    "group flex w-full items-center gap-1 pr-2 text-left",
                    isActive ? "bg-white/[0.05] text-white/90" : "text-white/55 hover:bg-white/[0.03]",
                  )}
                  style={{ height: ROW_LAYER, paddingLeft: 8 }}
                  onClick={() => selectFrame(row.frameId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      selectFrame(row.frameId);
                    }
                  }}
                >
                  <button
                    type="button"
                    className="grid size-4 shrink-0 place-items-center rounded-sm hover:bg-white/[0.08]"
                    aria-label={row.expanded ? `Collapse ${row.name}` : `Expand ${row.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFrameExpanded(row.frameId);
                    }}
                  >
                    <ChevronRight
                      className={cn(
                        "h-2.5 w-2.5 text-white/30 transition-transform duration-100",
                        row.expanded ? "rotate-90" : "",
                      )}
                    />
                  </button>
                  <span className="min-w-0 flex-1 select-none truncate text-[11px] font-normal tracking-[-0.01em]">
                    {row.name}
                  </span>
                </div>
              );
            }

            if (row.kind === "object") {
              const isSelected =
                hasCanvasSelection &&
                selectionKind === "layer" &&
                row.frameId === selectedFrameId &&
                selectedLayerIds.some((id) => String(id) === String(row.layer.id));
              const showChrome = hoveredRowKey === row.key || isSelected;
              return (
                <div
                  key={row.key}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    "group flex w-full items-center gap-1 pr-1.5 text-left",
                    isSelected
                      ? "bg-white/[0.055] text-white"
                      : "text-white/80 hover:bg-white/[0.03]",
                  )}
                  style={{ height: ROW_LAYER, paddingLeft: 6 + row.depth * 12 }}
                  onMouseEnter={() => setHoveredRowKey(row.key)}
                  onMouseLeave={() => setHoveredRowKey(null)}
                  onClick={(e) => {
                    if (row.frameId !== selectedFrameId) selectFrame(row.frameId);
                    // Shift multi-select on timeline rows (Figma layers list)
                    if (e.shiftKey) {
                      const cur = selectedLayerIds.map(String);
                      const id = String(row.layer.id);
                      const next = cur.includes(id)
                        ? selectedLayerIds.filter((x) => String(x) !== id)
                        : [...selectedLayerIds, row.layer.id];
                      if (next.length === 0) selectLayer(row.layer.id);
                      else useEditorStore.getState().selectLayers(next);
                      return;
                    }
                    selectLayer(row.layer.id);
                    const morphBlocks = blocksForLayerInFrame(row.frameId, row.layer.id).filter(
                      (b) => b.propertyName === "pathData",
                    );
                    if (morphBlocks.length) selectBlocks(morphBlocks.map((b) => b.id));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      if (row.frameId !== selectedFrameId) selectFrame(row.frameId);
                      selectLayer(row.layer.id);
                    }
                  }}
                >
                  {/* Group expand — reserves space so leaf layers stay aligned (Figma) */}
                  <span className="grid size-4 shrink-0 place-items-center">
                    {row.expandable ? (
                      <button
                        type="button"
                        className="grid size-4 place-items-center rounded-sm hover:bg-white/[0.08]"
                        aria-label={row.expanded ? `Collapse ${row.name}` : `Expand ${row.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleGroupExpanded(row.key);
                        }}
                      >
                        <ChevronRight
                          className={cn(
                            "h-2.5 w-2.5 text-white/30 transition-transform duration-100",
                            row.expanded ? "rotate-90" : "",
                          )}
                        />
                      </button>
                    ) : null}
                  </span>
                  {/* Figma layer glyph — empty rounded square */}
                  <span
                    className="flex size-[12px] shrink-0 items-center justify-center rounded-[2px] border"
                    style={{
                      borderColor: isSelected ? FIGMA_BLUE : "rgba(255,255,255,0.28)",
                      background: "transparent",
                    }}
                    aria-hidden
                  >
                    <Square
                      className="size-[7px]"
                      style={{ color: isSelected ? FIGMA_BLUE : "rgba(255,255,255,0.35)" }}
                      strokeWidth={1.75}
                    />
                  </span>
                  {renamingLayerKey === row.key ? (
                    <input
                      autoFocus
                      defaultValue={row.name}
                      onFocus={(e) => e.currentTarget.select()}
                      onBlur={(e) => {
                        useEditorStore.getState().updateSelectedLayer({ name: e.target.value });
                        setRenamingLayerKey(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          useEditorStore
                            .getState()
                            .updateSelectedLayer({ name: (e.target as HTMLInputElement).value });
                          setRenamingLayerKey(null);
                        } else if (e.key === "Escape") {
                          setRenamingLayerKey(null);
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                      className="h-4 min-w-0 flex-1 rounded-sm border border-primary bg-black/40 px-1 text-[11px] text-white outline-none"
                    />
                  ) : (
                    <span
                      className="min-w-0 flex-1 select-none truncate text-[11px] font-normal tracking-[-0.01em]"
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (row.frameId !== selectedFrameId) selectFrame(row.frameId);
                        selectLayer(row.layer.id);
                        setRenamingLayerKey(row.key);
                      }}
                    >
                      {row.name}
                    </span>
                  )}
                  <div
                    className={cn(
                      "flex shrink-0 items-center transition-opacity duration-100",
                      showChrome ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                    )}
                  >
                    {row.frameId === selectedFrameId && (
                      <>
                        <span
                          role="button"
                          tabIndex={0}
                          className="grid size-5 place-items-center rounded-sm text-white/30 hover:bg-white/[0.07] hover:text-white/75"
                          title="Bring forward (])"
                          onClick={(event) => {
                            event.stopPropagation();
                            nudgeLayerZOrder(row.layer.id, 1);
                          }}
                          aria-label={`Bring ${row.name} forward`}
                        >
                          <ArrowUp className="h-3 w-3" strokeWidth={1.75} />
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          className="grid size-5 place-items-center rounded-sm text-white/30 hover:bg-white/[0.07] hover:text-white/75"
                          title="Send backward ([)"
                          onClick={(event) => {
                            event.stopPropagation();
                            nudgeLayerZOrder(row.layer.id, -1);
                          }}
                          aria-label={`Send ${row.name} backward`}
                        >
                          <ArrowDown className="h-3 w-3" strokeWidth={1.75} />
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          className="grid size-5 place-items-center rounded-sm text-white/30 hover:bg-white/[0.07] hover:text-white/75"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleLayerLock(row.layer.id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              event.stopPropagation();
                              toggleLayerLock(row.layer.id);
                            }
                          }}
                          aria-label={row.layer.locked ? `Unlock ${row.name}` : `Lock ${row.name}`}
                        >
                          {row.layer.locked ? (
                            <Lock className="h-3 w-3" strokeWidth={1.75} />
                          ) : (
                            <Unlock className="h-3 w-3 opacity-40" strokeWidth={1.75} />
                          )}
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          className="grid size-5 place-items-center rounded-sm text-white/30 hover:bg-white/[0.07] hover:text-white/75"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleLayerVisibility(row.layer.id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              event.stopPropagation();
                              toggleLayerVisibility(row.layer.id);
                            }
                          }}
                          aria-label={row.layer.visible ? `Hide ${row.name}` : `Show ${row.name}`}
                        >
                          {row.layer.visible ? (
                            <Eye className="h-3 w-3" strokeWidth={1.75} />
                          ) : (
                            <EyeOff className="h-3 w-3" strokeWidth={1.75} />
                          )}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              );
            }

            if (row.kind === "property") {
              const blocks = blocksForPropertyInFrame(
                row.frameId,
                row.layer.id,
                row.propertyName,
              );
              const blockIds = blocks.map((b) => b.id);
              const isSelected =
                row.frameId === selectedFrameId &&
                blockIds.length > 0 &&
                blockIds.every((id) => selectedBlockIds.includes(id));
              const first = blocks[0];
              const displayValue = first
                ? formatCompactValue(
                    currentTimeMs < (first.startTime + first.endTime) / 2
                      ? first.fromValue
                      : first.toValue,
                    row.propertyName,
                  )
                : "";
              const valueTitle = first
                ? `${formatCompactValue(first.fromValue, row.propertyName)} → ${formatCompactValue(first.toValue, row.propertyName)}`
                : "";
              const earliest = blocks.reduce(
                (min, b) => Math.min(min, b.startTime),
                Number.POSITIVE_INFINITY,
              );
              const latest = blocks.reduce((max, b) => Math.max(max, b.endTime), 0);

              return (
                <div
                  key={row.key}
                  className={cn(
                    "group flex w-full items-center gap-0.5 pr-1.5 text-left",
                    isSelected ? ROW_SEL : "hover:bg-white/[0.025]",
                  )}
                  style={{ height: ROW_PROP, paddingLeft: 24 + row.depth * 6 }}
                  onMouseEnter={() => setHoveredRowKey(row.key)}
                  onMouseLeave={() => setHoveredRowKey(null)}
                  onClick={() => {
                    if (row.frameId !== selectedFrameId) selectFrame(row.frameId);
                    // Property belongs to a layer — select the layer, then the block.
                    selectLayer(row.layer.id);
                    selectBlocks(blockIds);
                  }}
                >
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-[11px]",
                      isSelected ? "text-white/90" : "text-white/45",
                    )}
                  >
                    {propertyLabel(row.propertyName)}
                  </span>
                  <div
                    className={cn(
                      "flex shrink-0 items-center",
                      isSelected ? "opacity-100" : "opacity-50 group-hover:opacity-100",
                    )}
                  >
                    <button
                      type="button"
                      className="grid size-4 place-items-center rounded text-white/35 hover:bg-white/[0.08] disabled:opacity-20"
                      disabled={!Number.isFinite(earliest)}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (Number.isFinite(earliest)) jumpToMs(earliest);
                      }}
                    >
                      <ChevronRight className="h-2.5 w-2.5 rotate-180" strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      className="grid size-4 place-items-center rounded hover:bg-white/[0.08]"
                      onClick={(e) => {
                        e.stopPropagation();
                        selectBlocks(blockIds);
                      }}
                    >
                      <KeyframeDiamond active={isSelected} size={6} />
                    </button>
                    <button
                      type="button"
                      className="grid size-4 place-items-center rounded text-white/35 hover:bg-white/[0.08] disabled:opacity-20"
                      disabled={!latest}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (latest) jumpToMs(latest);
                      }}
                    >
                      <ChevronRight className="h-2.5 w-2.5" strokeWidth={2} />
                    </button>
                  </div>
                  <span
                    className={cn(
                      "w-[48px] shrink-0 truncate text-right font-mono text-[10px] tabular-nums",
                      isSelected ? "text-white/70" : "text-white/35",
                    )}
                    title={valueTitle}
                  >
                    {displayValue}
                  </span>
                </div>
              );
            }

            return null;
          })}
        </div>

        {/* Tracks */}
        <div
          ref={rightScrollRef}
          className={cn(
            "relative min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden",
            SURFACE_TRACK,
          )}
          onScroll={() => syncScroll("right")}
        >
          <div
            className="relative min-h-full"
            style={
              isTimelineEmpty
                ? undefined
                : {
                    // Subtle major grid only — Figma avoids a busy cage
                    backgroundImage: `repeating-linear-gradient(
                      90deg,
                      transparent 0,
                      transparent calc(${100 / rulerMajorCount}% - 1px),
                      rgba(255,255,255,0.035) calc(${100 / rulerMajorCount}% - 1px),
                      rgba(255,255,255,0.035) calc(${100 / rulerMajorCount}%)
                    )`,
                  }
            }
          >
            {!timelineCollapsed && isTimelineEmpty && !emptyHintDismissed && (
              <div className="absolute inset-0 z-[5] flex items-center justify-center p-6">
                <div className="relative w-full max-w-[300px] rounded-xl border border-white/10 bg-[#2C2C2C]/95 px-5 py-4 text-center shadow-lg">
                  <button
                    type="button"
                    className="absolute right-2 top-2 grid size-7 place-items-center rounded-md text-white/40 hover:bg-white/10 hover:text-white/80"
                    aria-label="Dismiss"
                    onClick={() => setEmptyHintDismissed(true)}
                  >
                    <X className="size-3.5" />
                  </button>
                  <div className="text-[13px] font-medium text-white/90">No animations yet</div>
                  <div className="mt-1.5 text-[12px] leading-relaxed text-white/45">
                    Select a layer and animate a property, or use a layer menu.
                  </div>
                </div>
              </div>
            )}

            {!timelineCollapsed &&
              timelineRows.map((row) => {
                if (row.kind === "frame") {
                  const isActive = row.frameId === selectedFrameId;
                  return (
                    <div
                      key={row.key}
                      data-timeline-row
                      className={cn(
                        "relative border-b border-white/[0.03]",
                        isActive ? "bg-white/[0.025]" : "",
                      )}
                      style={{ height: ROW_LAYER }}
                      onClick={() => selectFrame(row.frameId)}
                    />
                  );
                }

                const isObject = row.kind === "object";
                const frameAnim =
                  row.frameId === selectedFrameId
                    ? animation
                    : frames.find((f) => f.id === row.frameId)?.animation ?? animation;
                const dur = Math.max(1, frameAnim.duration || 1000);
                const propBlocks =
                  row.kind === "property"
                    ? blocksForPropertyInFrame(row.frameId, row.layer.id, row.propertyName)
                    : [];
                // Object bar = morph (pathData) only — other props get their own labeled rows
                const morphBlocks = isObject
                  ? blocksForLayerInFrame(row.frameId, row.layer.id).filter(
                      (b) => b.propertyName === "pathData",
                    )
                  : [];
                const propSelected =
                  row.kind === "property" &&
                  hasCanvasSelection &&
                  selectionKind === "layer" &&
                  row.frameId === selectedFrameId &&
                  propBlocks.length > 0 &&
                  propBlocks.every((b) => selectedBlockIds.includes(b.id));
                const objectSelected =
                  isObject &&
                  hasCanvasSelection &&
                  selectionKind === "layer" &&
                  row.frameId === selectedFrameId &&
                  String(selectedLayerId) === String(row.layer.id);

                const hasImplicitMorph =
                  isObject &&
                  morphBlocks.length === 0 &&
                  row.layer.type !== "group" &&
                  row.layer.from &&
                  row.layer.to &&
                  JSON.stringify(row.layer.from) !== JSON.stringify(row.layer.to);

                const objectSpan = isObject
                  ? morphBlocks.length > 0
                    ? {
                        start: Math.min(...morphBlocks.map((b) => b.startTime)),
                        end: Math.max(...morphBlocks.map((b) => b.endTime)),
                        blocks: morphBlocks,
                      }
                    : hasImplicitMorph
                      ? { start: 0, end: dur, blocks: [] as TimelineBlock[] }
                      : null
                  : null;

                return (
                  <div
                    key={row.key}
                    data-timeline-row
                    className={cn(
                      "relative border-b border-white/[0.03]",
                      propSelected
                        ? ROW_SEL
                        : objectSelected
                          ? "bg-white/[0.035]"
                          : "bg-transparent",
                      row.kind === "property" && !propSelected && "hover:bg-white/[0.02]",
                      isObject && !objectSelected && "hover:bg-white/[0.02]",
                    )}
                    style={{ height: isObject ? ROW_LAYER : ROW_PROP }}
                    onClick={() => {
                      if (row.frameId !== selectedFrameId) selectFrame(row.frameId);
                      if (row.kind === "property") {
                        selectBlocks(propBlocks.map((b) => b.id));
                      } else if (row.kind === "object") {
                        selectLayer(row.layer.id);
                        if (objectSpan?.blocks.length) {
                          selectBlocks(objectSpan.blocks.map((b) => b.id));
                        }
                      }
                    }}
                  >
                    {row.kind === "property" &&
                      row.frameId === selectedFrameId &&
                      propBlocks.map((block) => renderPropertyBlock(block))}

                    {row.kind === "property" &&
                      row.frameId !== selectedFrameId &&
                      propBlocks.map((block) => {
                        const startPct = (block.startTime / dur) * 100;
                        const endPct = (block.endTime / dur) * 100;
                        const widthPct = Math.max(1.2, endPct - startPct);
                        // Position = Figma keyframe rail (diamonds), not a clip bar
                        if (isPositionProperty(block.propertyName)) {
                          return (
                            <div
                              key={block.id}
                              className="pointer-events-none absolute inset-0"
                            >
                              <div
                                className="absolute top-1/2 h-px -translate-y-1/2 bg-white/12"
                                style={{ left: `${startPct}%`, width: `${widthPct}%` }}
                              />
                              <span
                                className="absolute top-1/2 flex size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                                style={{ left: `${startPct}%` }}
                              >
                                <KeyframeDiamond size={6} />
                              </span>
                              <span
                                className="absolute top-1/2 flex size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                                style={{ left: `${endPct}%` }}
                              >
                                <KeyframeDiamond size={6} />
                              </span>
                            </div>
                          );
                        }
                        return (
                          <div
                            key={block.id}
                            className="pointer-events-none absolute top-1/2 flex h-[18px] -translate-y-1/2 items-center justify-center overflow-hidden rounded-sm border border-white/[0.06] bg-[#3A3A3A]"
                            style={{ left: `${startPct}%`, width: `${widthPct}%` }}
                          >
                            <span className="truncate px-2 text-[9px] text-white/35">
                              {propertyLabel(block.propertyName)}
                            </span>
                          </div>
                        );
                      })}

                    {isObject && objectSpan && (() => {
                      const span = objectSpan;
                      const leftPct = (span.start / dur) * 100;
                      const widthPct = Math.max(
                        1.2,
                        ((span.end - span.start) / dur) * 100,
                      );
                      const anySelected =
                        objectSelected ||
                        (row.frameId === selectedFrameId &&
                          span.blocks.some((b) => selectedBlockIds.includes(b.id)));
                      const primaryId = span.blocks[0]?.id;
                      const interactive =
                        row.frameId === selectedFrameId && span.blocks.length > 0;
                      return (
                        <div
                          className={cn(
                            // Figma object clip: muted graphite bar, blue only when selected
                            "absolute top-1/2 z-[1] flex -translate-y-1/2 items-center justify-center overflow-hidden rounded-sm border",
                            interactive
                              ? "cursor-grab active:cursor-grabbing"
                              : "pointer-events-none",
                            anySelected
                              ? "border-[#0C8CE9]/45 bg-[#0C8CE9] shadow-[0_0_0_1px_rgba(12,140,233,0.2)]"
                              : "border-white/[0.08] bg-[#555555] hover:bg-[#5C5C5C]",
                          )}
                          style={{
                            left: `${leftPct}%`,
                            width: `${widthPct}%`,
                            height: CLIP_H_OBJ,
                          }}
                          title={`Path · ${span.start}–${span.end}ms`}
                          onPointerDown={
                            interactive
                              ? (e) => {
                                  e.stopPropagation();
                                  try {
                                    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                                  } catch {
                                    /* ignore — the drag session below still drives the move via this element's own listeners */
                                  }
                                  setDraggingBlocks({
                                    startX: e.clientX,
                                    items: span.blocks.map((b) => ({
                                      id: b.id,
                                      originalStart: b.startTime,
                                      originalEnd: b.endTime,
                                    })),
                                  });
                                  useEditorStore
                                    .getState()
                                    .selectBlocks(span.blocks.map((b) => b.id));
                                }
                              : undefined
                          }
                          onPointerMove={(e) => {
                            const session = draggingRef.current;
                            if (
                              !session ||
                              !primaryId ||
                              !session.items.some((i) => i.id === primaryId)
                            )
                              return;
                            const track = (e.currentTarget as HTMLElement).closest(
                              "[data-timeline-row]",
                            ) as HTMLElement | null;
                            const width = Math.max(
                              1,
                              track?.getBoundingClientRect().width ?? 300,
                            );
                            const deltaTime = ((e.clientX - session.startX) / width) * dur;
                            let shift = deltaTime;
                            for (const item of session.items) {
                              const itemDur = item.originalEnd - item.originalStart;
                              const maxStart = dur - itemDur;
                              const proposed = item.originalStart + shift;
                              if (proposed < 0) shift = -item.originalStart;
                              if (proposed > maxStart) shift = maxStart - item.originalStart;
                            }
                            const store = useEditorStore.getState();
                            for (const item of session.items) {
                              const itemDur = item.originalEnd - item.originalStart;
                              let newStart = Math.round((item.originalStart + shift) / 50) * 50;
                              newStart = Math.max(0, Math.min(dur - itemDur, newStart));
                              const newEnd = newStart + itemDur;
                              store.updateTimelineBlock(item.id, {
                                startTime: newStart,
                                endTime: newEnd,
                              });
                            }
                          }}
                          onPointerUp={(e) => {
                            setDraggingBlocks(null);
                            try {
                              (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
                            } catch {
                              /* ignore */
                            }
                          }}
                          onPointerCancel={() => setDraggingBlocks(null)}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (span.blocks.length) {
                              useEditorStore
                                .getState()
                                .selectBlocks(span.blocks.map((b) => b.id));
                            }
                          }}
                        >
                          <span className="pointer-events-none absolute inset-y-[2px] left-[2.5px] w-[1.5px] rounded-full bg-white/35" />
                          <span className="pointer-events-none absolute inset-y-[2px] right-[2.5px] w-[1.5px] rounded-full bg-white/35" />
                          {widthPct > 12 && (
                            <span
                              className={cn(
                                "pointer-events-none truncate px-2 text-[9px] font-medium",
                                anySelected ? "text-white/95" : "text-white/50",
                              )}
                            >
                              Path
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
          </div>
        </div>
      </div>
    </section>
  );
}

