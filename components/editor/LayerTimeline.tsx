"use client";

import React from "react";
import {
  LocateFixed,
  Magnet,
  Pause,
  PanelBottomClose,
  Play,
  Plus,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useEditorStore } from "@/lib/store/editorStore";
import { CAPABILITY_MATRIX, type ExportFormatId } from "@/lib/shapeshifter/formatCapabilities";
import { cn } from "@/lib/utils";
import {
  TimelineCurrentTimeInput,
  TimelineDurationInput,
  TimelinePlayhead,
} from "./timeline/TimelineLiveState";
import { TimelineLayersPane } from "./timeline/TimelineLayersPane";
import { TimelineTracksPane } from "./timeline/TimelineTracksPane";
import { buildTimelineProjection } from "./timeline/timelineProjection";
import { useTimelineNavigation } from "./timeline/useTimelineNavigation";
import {
  formatTimelineMark,
  timelineMajorStep,
  type TimelineTimeUnit,
} from "./timeline/timelineScale";
import { TimelineTransportButtons } from "./timeline/TimelineTransportButtons";
import { TimelineInsertKeyframeButton } from "./timeline/TimelineInsertKeyframeButton";
import {
  TimelineClipboardControls,
  handleTimelineClipboardShortcut,
} from "./timeline/TimelineClipboardControls";
import { TimelinePreviewRangeControls } from "./timeline/TimelinePreviewRangeControls";
import { resolveTimelinePreviewRange } from "@/lib/shapeshifter/motion/previewRange";
import {
  snapTimelineOffset,
  timelineSnapTargets,
  type TimelineSnapTarget,
} from "./timeline/timelineTiming";

const PLAYHEAD = "var(--primary)";
const SURFACE = "bg-card";

const HEADER_H = 40;
const LAYERS_W = 240;

export function LayerTimeline({ onCollapse }: { onCollapse?: () => void }) {
  const frames = useEditorStore((state) => state.frames);
  const selectedFrameId = useEditorStore((state) => state.selectedFrameId);
  const layers = useEditorStore((state) => state.layers);
  const addLayer = useEditorStore((state) => state.addLayer);
  const animation = useEditorStore((state) => state.animation);
  const setAnimationDuration = useEditorStore((state) => state.setAnimationDuration);
  const togglePlayback = useEditorStore((state) => state.togglePlayback);
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const storedPreviewRange = useEditorStore((state) => state.timelinePreviewRange);
  const preferredExportFormat = useEditorStore((state) => state.preferredExportFormat);
  const formatProfile = CAPABILITY_MATRIX[preferredExportFormat as ExportFormatId] ?? null;

  const [timeUnit, setTimeUnit] = React.useState<TimelineTimeUnit>("milliseconds");
  const [fps, setFps] = React.useState(30);
  const [snapping, setSnapping] = React.useState(true);
  const [snapGuide, setSnapGuide] = React.useState<TimelineSnapTarget | null>(null);
  const reportSnap = React.useCallback((target: TimelineSnapTarget | null) => {
    setSnapGuide((previous) =>
      previous?.time === target?.time && previous?.kind === target?.kind ? previous : target,
    );
  }, []);
  const isTimelineEmpty =
    frames.every((f) => (f.animation?.blocks?.length ?? 0) === 0) && animation.blocks.length === 0;
  const [emptyHintDismissed, setEmptyHintDismissed] = React.useState(false);
  React.useEffect(() => {
    // Re-show the empty card when the timeline becomes empty again
    if (isTimelineEmpty) setEmptyHintDismissed(false);
  }, [isTimelineEmpty]);

  const leftScrollRef = React.useRef<HTMLDivElement>(null);
  const rightScrollRef = React.useRef<HTMLDivElement>(null);
  const rulerRef = React.useRef<HTMLDivElement>(null);
  const sectionRef = React.useRef<HTMLElement>(null);
  const scrubCleanupRef = React.useRef<(() => void) | null>(null);
  React.useEffect(() => () => scrubCleanupRef.current?.(), [selectedFrameId]);
  const navigation = useTimelineNavigation(sectionRef, rightScrollRef, LAYERS_W);
  const syncingScroll = React.useRef(false);

  React.useEffect(() => {
    // Keep the accessible slider value current without rerendering the ruler's
    // complete tick/track tree on every playback frame.
    const updateValue = () => {
      const state = useEditorStore.getState();
      rulerRef.current?.setAttribute(
        "aria-valuenow",
        String(Math.round(state.progress * state.animation.duration)),
      );
      rulerRef.current?.setAttribute(
        "aria-valuetext",
        timeUnit === "frames"
          ? `Frame ${Math.round((state.progress * state.animation.duration * fps) / 1000)}`
          : `${Math.round(state.progress * state.animation.duration)} milliseconds`,
      );
    };
    updateValue();
    return useEditorStore.subscribe((state, previous) => {
      if (
        state.progress !== previous.progress ||
        state.animation.duration !== previous.animation.duration
      )
        updateValue();
    });
  }, [timeUnit, fps]);

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

  const [collapsedFrameIds, setCollapsedFrameIds] = React.useState<Set<string>>(() => new Set());
  const [collapsedGroupKeys, setCollapsedGroupKeys] = React.useState<Set<string>>(() => new Set());
  const toggleFrameExpanded = (frameId: string) => {
    setCollapsedFrameIds((previous) => {
      const next = new Set(previous);
      if (next.has(frameId)) next.delete(frameId);
      else next.add(frameId);
      return next;
    });
  };
  const toggleGroupExpanded = (key: string) => {
    setCollapsedGroupKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const timelineProjection = React.useMemo(
    () =>
      buildTimelineProjection({
        frames,
        selectedFrameId,
        activeLayers: layers,
        activeAnimation: animation,
        collapsedFrameIds,
        collapsedGroupKeys,
        formatProfile,
      }),
    [
      animation,
      collapsedFrameIds,
      collapsedGroupKeys,
      formatProfile,
      frames,
      layers,
      selectedFrameId,
    ],
  );
  const timelineRows = timelineProjection.rows;
  const blocksForLayerInFrame = timelineProjection.blocksForLayer;
  const blocksForPropertyInFrame = timelineProjection.blocksForProperty;
  const setProgressFromClientX = (clientX: number, el: HTMLElement, bypass = false) => {
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const state = useEditorStore.getState();
    const result = snapTimelineOffset({
      offset: (x / Math.max(1, rect.width)) * state.animation.duration,
      anchors: [0],
      targets: timelineSnapTargets(state.animation.blocks, state.animation.duration),
      range: [0, state.animation.duration],
      duration: state.animation.duration,
      contentWidth: rect.width,
      gridStep: timeUnit === "frames" ? 1000 / fps : 1,
      enabled: snapping,
      bypass,
    });
    state.setProgress(result.offset / Math.max(1, state.animation.duration));
    reportSnap(result.target);
  };

  const beginScrub = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    scrubCleanupRef.current?.();
    // Figma pauses playback while you scrub the ruler, so the playhead RAF
    // loop can't fight the drag. Just pause — don't auto-resume on release.
    if (useEditorStore.getState().isPlaying) {
      useEditorStore.getState().togglePlayback();
    }
    const element = e.currentTarget;
    setProgressFromClientX(e.clientX, element, e.altKey);
    try {
      element.setPointerCapture(e.pointerId);
    } catch {
      /* ignore — scrubbing still works via the window listeners below */
    }
    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId === e.pointerId)
        setProgressFromClientX(moveEvent.clientX, element, moveEvent.altKey);
    };
    const finish = () => {
      scrubCleanupRef.current = null;
      reportSnap(null);
      try {
        element.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId === e.pointerId) finish();
    };
    scrubCleanupRef.current = finish;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const rulerMajorStepMs = timelineMajorStep(
    animation.duration,
    navigation.contentWidth,
    timeUnit,
    fps,
  );
  const rulerMajorCount = Math.max(1, Math.ceil(animation.duration / rulerMajorStepMs));
  const rulerMinorPerMajor =
    timeUnit === "frames"
      ? Math.max(1, Math.min(5, Math.round((rulerMajorStepMs * fps) / 1000)))
      : 5;
  const rulerMinorStepMs = rulerMajorStepMs / rulerMinorPerMajor;
  const previewRange = resolveTimelinePreviewRange(
    storedPreviewRange,
    selectedFrameId,
    animation.duration,
  );
  const previewLeft = previewRange
    ? Math.max(
        0,
        (previewRange.start / animation.duration) * navigation.contentWidth - navigation.scrollLeft,
      )
    : 0;
  const previewRight = previewRange
    ? Math.min(
        navigation.width,
        (previewRange.end / animation.duration) * navigation.contentWidth - navigation.scrollLeft,
      )
    : 0;

  return (
    <section
      ref={sectionRef}
      onKeyDown={handleTimelineClipboardShortcut}
      className={cn(
        "relative z-20 flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-t border-border",
        SURFACE,
      )}
    >
      {/* ── Unified playhead (head in ruler, needle through tracks) ── */}
      <TimelinePlayhead
        visible={!isTimelineEmpty}
        layersWidth={LAYERS_W}
        color={PLAYHEAD}
        contentWidth={navigation.contentWidth}
        viewportWidth={navigation.width}
        scrollLeft={navigation.scrollLeft}
      />
      {snapGuide &&
        (() => {
          const x =
            (snapGuide.time / Math.max(1, animation.duration)) * navigation.contentWidth -
            navigation.scrollLeft;
          if (x < 0 || x > navigation.width) return null;
          return (
            <div
              data-timeline-snap-guide
              className="pointer-events-none absolute top-0 bottom-8 z-[15] border-l border-dashed border-primary/65"
              style={{ left: LAYERS_W + x }}
            >
              <span
                role="status"
                style={{
                  left: x > navigation.width - 160 ? undefined : 4,
                  right: x > navigation.width - 160 ? 4 : undefined,
                }}
                className="absolute top-1 whitespace-nowrap rounded bg-primary px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-primary-foreground shadow-sm"
              >
                {snapGuide.kind === "playhead"
                  ? "Playhead"
                  : snapGuide.kind === "keyframe"
                    ? "Keyframe"
                    : "Boundary"}{" "}
                ·{" "}
                {timeUnit === "frames"
                  ? `${Number(((snapGuide.time * fps) / 1000).toFixed(2))} f`
                  : `${Number(snapGuide.time.toFixed(3))} ms`}
              </span>
            </div>
          );
        })()}
      {previewRange && previewRight > previewLeft && (
        <div
          data-timeline-preview-range
          aria-hidden
          className="pointer-events-none absolute top-0 bottom-8 z-[2] border-x border-primary/35 bg-primary/5"
          style={{ left: LAYERS_W + previewLeft, width: previewRight - previewLeft }}
        >
          <div className="absolute inset-x-0 top-0 h-0.5 bg-primary/50" />
        </div>
      )}

      {/* ══ Top bar: transport | ruler (one continuous Figma row) ══ */}
      <div
        className="relative z-10 flex shrink-0 border-b border-border"
        style={{ height: HEADER_H }}
      >
        <div
          className="flex shrink-0 items-center gap-0.5 border-r border-border px-1.5"
          style={{ width: LAYERS_W }}
        >
          <button
            type="button"
            className="grid size-7 place-items-center rounded text-foreground transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            aria-label={isPlaying ? "Pause" : "Play"}
            onClick={() => togglePlayback()}
          >
            {isPlaying ? (
              <Pause className="size-3 fill-current" strokeWidth={0} />
            ) : (
              <Play className="size-3 fill-current" strokeWidth={0} />
            )}
          </button>
          <div className="flex h-7 min-w-0 items-center gap-[3px] rounded-md border border-border bg-muted/50 px-1.5 font-mono text-[11px] tabular-nums leading-none tracking-tight">
            <TimelineCurrentTimeInput color={PLAYHEAD} unit={timeUnit} fps={fps} />
            <span className="text-muted-foreground">/</span>
            <TimelineDurationInput unit={timeUnit} fps={fps} />
            <span className="text-muted-foreground">{timeUnit === "frames" ? "f" : "ms"}</span>
          </div>
          <div className="flex-1" />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="size-7 rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Add layer"
                />
              }
            >
              <Plus className="h-3 w-3" strokeWidth={1.75} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => addLayer("path")}>New path</DropdownMenuItem>
              <DropdownMenuItem onClick={() => addLayer("clipPath")}>
                New clip path
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => addLayer("group")}>New group layer</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              className="grid size-7 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              aria-label="Hide timeline"
              title="Hide timeline"
            >
              <PanelBottomClose className="size-3.5" />
            </button>
          )}
        </div>

        {/* Ruler — Figma motion: continuous baseline, major labels, minor ticks */}
        <div className="relative min-w-0 flex-1 overflow-hidden">
          <div
            ref={rulerRef}
            style={{
              width: navigation.contentWidth,
              left: -navigation.scrollLeft,
              height: HEADER_H,
            }}
            className={cn(
              "absolute top-0 select-none touch-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2",
              isTimelineEmpty ? "cursor-default" : "cursor-ew-resize",
            )}
            onPointerDown={isTimelineEmpty ? undefined : beginScrub}
            onLostPointerCapture={(event) => {
              if (event.target === event.currentTarget) scrubCleanupRef.current?.();
            }}
            role="slider"
            aria-label="Timeline playhead"
            aria-valuemin={0}
            aria-valuemax={animation.duration}
            aria-valuenow={Math.round(useEditorStore.getState().progress * animation.duration)}
            tabIndex={isTimelineEmpty ? -1 : 0}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(
                  event.key,
                )
              )
                return;
              event.preventDefault();
              const store = useEditorStore.getState();
              if (store.isPlaying) store.togglePlayback();
              const currentTime = store.progress * store.animation.duration;
              const nextTime =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? store.animation.duration
                    : currentTime +
                      (["ArrowLeft", "ArrowDown"].includes(event.key) ? -1 : 1) *
                        (timeUnit === "frames" ? 1000 / fps : 1) *
                        (event.shiftKey ? 10 : 1);
              store.setProgress(nextTime / Math.max(1, store.animation.duration));
            }}
          >
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              {/* Continuous top baseline (the “ruler edge”) */}
              <div className="absolute inset-x-0 top-0 h-px bg-border/50" />
              {/* Continuous bottom rail where ticks rest */}
              <div className="absolute inset-x-0 bottom-0 h-px bg-border" />

              {/* Minor ticks (skip majors) */}
              {Array.from(
                {
                  length: Math.floor(animation.duration / rulerMinorStepMs) + 1,
                },
                (_, index) => {
                  const ms = index * rulerMinorStepMs;
                  if (ms <= 0 || ms >= animation.duration) return null;
                  // Skip major positions (integer-safe via nearest major)
                  const nearMajor = Math.round(ms / rulerMajorStepMs) * rulerMajorStepMs;
                  if (Math.abs(ms - nearMajor) < 0.01) return null;
                  const t = ms / animation.duration;
                  return (
                    <span
                      key={`min-${index}`}
                      className="absolute bottom-0 w-px bg-muted-foreground/30"
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
                    <span className="absolute bottom-0 left-0 h-[7px] w-px bg-muted-foreground/50" />
                    {showLabel && (
                      <span
                        className={cn(
                          "absolute bottom-[10px] whitespace-nowrap font-mono text-[10px] tabular-nums leading-none text-muted-foreground",
                          atEnd ? "-translate-x-full pr-0.5" : "left-0 pl-[3px]",
                        )}
                      >
                        {formatTimelineMark(ms, timeUnit, fps, rulerMajorStepMs)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            {/* Draggable duration grip (Figma): drag the ruler's right edge to change duration.
              Left = shorter, right = longer, scaled to the drag distance. */}
            {!isTimelineEmpty &&
              navigation.contentWidth - navigation.scrollLeft <= navigation.width + 1 && (
                <div
                  role="slider"
                  aria-label="Animation duration"
                  aria-valuemin={100}
                  aria-valuenow={animation.duration}
                  tabIndex={0}
                  title="Drag to change duration"
                  className="absolute right-0 top-0 bottom-0 z-10 w-2 cursor-ew-resize bg-transparent hover:bg-primary/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                  onKeyDown={(event) => {
                    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key))
                      return;
                    event.preventDefault();
                    event.stopPropagation();
                    setAnimationDuration(
                      Math.max(
                        100,
                        animation.duration +
                          (["ArrowLeft", "ArrowDown"].includes(event.key) ? -1 : 1) *
                            (timeUnit === "frames" ? 1000 / fps : 1) *
                            (event.shiftKey ? 10 : 1),
                      ),
                    );
                  }}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation(); // don't start a scrub
                    const ruler = e.currentTarget.parentElement;
                    if (!ruler) return;
                    const startWidth = Math.max(1, ruler.getBoundingClientRect().width);
                    const startDur = animation.duration;
                    const startX = e.clientX;
                    const grip = e.currentTarget;
                    let historyRecorded = false;
                    try {
                      e.currentTarget.setPointerCapture(e.pointerId);
                    } catch {
                      /* ignore — the window listeners below still drive the resize */
                    }
                    const move = (ev: PointerEvent) => {
                      const dx = ev.clientX - startX;
                      const factor = Math.max(0.1, (startWidth + dx) / startWidth);
                      const nextDuration = Math.max(100, Math.round(startDur * factor));
                      if (nextDuration === startDur) return;
                      if (!historyRecorded) {
                        useEditorStore.getState().pushHistory();
                        historyRecorded = true;
                      }
                      setAnimationDuration(nextDuration, { recordHistory: false });
                    };
                    const finish = (cancelled: boolean) => {
                      if (cancelled && historyRecorded) {
                        useEditorStore.getState().cancelLastHistoryTransaction();
                      }
                      try {
                        grip.releasePointerCapture(e.pointerId);
                      } catch {
                        // Capture may already be released by the browser.
                      }
                      window.removeEventListener("pointermove", move);
                      window.removeEventListener("pointerup", up);
                      window.removeEventListener("pointercancel", cancel);
                    };
                    const up = () => finish(false);
                    const cancel = () => finish(true);
                    window.addEventListener("pointermove", move);
                    window.addEventListener("pointerup", up);
                    window.addEventListener("pointercancel", cancel);
                  }}
                />
              )}
          </div>
        </div>
      </div>

      {/* ══ Body: names | tracks ══ */}
      <div className="relative flex min-h-0 flex-1">
        <TimelineLayersPane
          rows={timelineRows}
          width={LAYERS_W}
          scrollRef={leftScrollRef}
          onScroll={() => syncScroll("left")}
          onToggleFrame={toggleFrameExpanded}
          onToggleGroup={toggleGroupExpanded}
          blocksForLayer={blocksForLayerInFrame}
          blocksForProperty={blocksForPropertyInFrame}
        />

        <TimelineTracksPane
          rows={timelineRows}
          blocksForLayer={blocksForLayerInFrame}
          blocksForProperty={blocksForPropertyInFrame}
          contentWidth={navigation.contentWidth}
          majorStep={rulerMajorStepMs}
          gridStep={snapping ? (timeUnit === "frames" ? 1000 / fps : rulerMinorStepMs) : 1}
          snapping={snapping}
          onSnapChange={reportSnap}
          keyboardStep={timeUnit === "frames" ? 1000 / fps : 1}
          empty={isTimelineEmpty}
          emptyHintDismissed={emptyHintDismissed}
          onDismissEmptyHint={() => setEmptyHintDismissed(true)}
          scrollRef={rightScrollRef}
          onScroll={() => {
            syncScroll("right");
            const element = rightScrollRef.current;
            if (element)
              useEditorStore.getState().setTimelineScroll(element.scrollLeft, element.scrollTop);
          }}
          formatProfile={formatProfile}
        />
      </div>
      <div className="flex h-8 shrink-0 items-center border-t border-border bg-card">
        <div
          className="flex shrink-0 items-center gap-2 border-r border-border px-2"
          style={{ width: LAYERS_W }}
        >
          <select
            aria-label="Timeline time display"
            value={timeUnit}
            onChange={(event) => setTimeUnit(event.target.value as TimelineTimeUnit)}
            className="h-6 min-w-0 rounded bg-transparent px-1 text-[10px] text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="milliseconds">Time</option>
            <option value="frames">Frames</option>
          </select>
          <select
            aria-label="Timeline frame rate"
            title="Frame grid and stepping"
            value={fps}
            onChange={(event) => setFps(Number(event.target.value))}
            className="h-6 rounded bg-transparent px-1 font-mono text-[10px] text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {[24, 30, 60].map((rate) => (
              <option key={rate} value={rate}>
                {rate} fps
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2 [&>button]:shrink-0">
          <TimelineTransportButtons fps={fps} />
          <TimelineInsertKeyframeButton />
          <TimelineClipboardControls compact />
          <button
            type="button"
            aria-label="Snap timeline edits to grid"
            aria-pressed={snapping}
            title="Snap to keyframes, playhead, and grid · Alt-drag for 1 ms precision"
            onClick={() => setSnapping((value) => !value)}
            className={cn(
              "grid size-6 place-items-center rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
              snapping
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Magnet className="size-3.5" />
          </button>
          <TimelinePreviewRangeControls unit={timeUnit} fps={fps} />
          <span className="mx-1 h-4 w-px bg-border" />
          <button
            type="button"
            aria-label="Focus timeline playhead"
            title="Focus playhead"
            onClick={navigation.focusPlayhead}
            className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <LocateFixed className="size-3.5" />
          </button>
          <div className="flex-1" />
          <button
            type="button"
            aria-label="Zoom timeline out"
            title="Zoom out · Ctrl/⌘ scroll"
            disabled={navigation.zoom <= 1}
            onClick={() => navigation.zoomBy(1 / Math.sqrt(2))}
            className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-35"
          >
            <ZoomOut className="size-3.5" />
          </button>
          <span
            aria-label="Timeline zoom"
            className="w-10 text-center font-mono text-[10px] tabular-nums text-muted-foreground"
          >
            {Math.round(navigation.zoom * 100)}%
          </span>
          <button
            type="button"
            aria-label="Zoom timeline in"
            title="Zoom in · Ctrl/⌘ scroll"
            disabled={navigation.zoom >= 10}
            onClick={() => navigation.zoomBy(Math.sqrt(2))}
            className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-35"
          >
            <ZoomIn className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Fit timeline to view"
            onClick={navigation.fit}
            className="h-6 rounded px-2 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            Fit
          </button>
        </div>
      </div>
    </section>
  );
}
