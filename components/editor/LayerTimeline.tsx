"use client";

import React from "react";
import { Pause, PanelBottomClose, Play, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useEditorStore } from "@/lib/store/editorStore";
import { cn } from "@/lib/utils";
import {
  TimelineCurrentTimeInput,
  TimelineDurationInput,
  TimelinePlayhead,
} from "./timeline/TimelineLiveState";
import { TimelineLayersPane } from "./timeline/TimelineLayersPane";
import { TimelineTracksPane } from "./timeline/TimelineTracksPane";
import { buildTimelineProjection } from "./timeline/timelineProjection";

/** Selected / active clip accent */
const FIGMA_BLUE = "#0C8CE9";
/** Figma Motion uses the same blue selection language for the playhead. */
const PLAYHEAD = FIGMA_BLUE;
const SURFACE = "bg-[#2C2C2C]";

const HEADER_H = 36;
const LAYERS_W = 240;

export function LayerTimeline({ onCollapse }: { onCollapse?: () => void }) {
  const frames = useEditorStore((state) => state.frames);
  const selectedFrameId = useEditorStore((state) => state.selectedFrameId);
  const layers = useEditorStore((state) => state.layers);
  const addLayer = useEditorStore((state) => state.addLayer);
  const animation = useEditorStore((state) => state.animation);
  const setAnimationDuration = useEditorStore((state) => state.setAnimationDuration);
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const togglePlayback = useEditorStore((state) => state.togglePlayback);

  /**
   * Figma motion ruler labels: short clips in whole ms (0 · 200 · 400),
   * longer clips in seconds with one decimal (0.0 · 0.5 · 1.0).
   */
  const formatTimeMark = (timeMs: number) => {
    if (animation.duration <= 2000) return String(Math.round(timeMs));
    return (timeMs / 1000).toFixed(1);
  };
  const isTimelineEmpty =
    frames.every((f) => (f.animation?.blocks?.length ?? 0) === 0) && animation.blocks.length === 0;
  const [emptyHintDismissed, setEmptyHintDismissed] = React.useState(false);
  React.useEffect(() => {
    // Re-show the empty card when the timeline becomes empty again
    if (isTimelineEmpty) setEmptyHintDismissed(false);
  }, [isTimelineEmpty]);

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
      }),
    [animation, collapsedFrameIds, collapsedGroupKeys, frames, layers, selectedFrameId],
  );
  const timelineRows = timelineProjection.rows;
  const blocksForLayerInFrame = timelineProjection.blocksForLayer;
  const blocksForPropertyInFrame = timelineProjection.blocksForProperty;
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
      <TimelinePlayhead visible={!isTimelineEmpty} layersWidth={LAYERS_W} color={PLAYHEAD} />

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
          <div className="flex h-6 min-w-0 items-center gap-[3px] rounded-md border border-white/[0.06] bg-black/20 px-1.5 font-mono text-[11px] tabular-nums leading-none tracking-tight">
            <TimelineCurrentTimeInput color={PLAYHEAD} />
            <span className="text-white/20">/</span>
            <TimelineDurationInput />
            <span className="text-white/25">ms</span>
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
              className="grid size-6 place-items-center rounded text-white/35 transition-colors hover:bg-white/[0.07] hover:text-white/80"
              aria-label="Hide timeline"
              title="Hide timeline"
            >
              <PanelBottomClose className="size-3.5" />
            </button>
          )}
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
                const nearMajor = Math.round(ms / rulerMajorStepMs) * rulerMajorStepMs;
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
          rulerMajorCount={rulerMajorCount}
          empty={isTimelineEmpty}
          emptyHintDismissed={emptyHintDismissed}
          onDismissEmptyHint={() => setEmptyHintDismissed(true)}
          scrollRef={rightScrollRef}
          onScroll={() => syncScroll("right")}
        />
      </div>
    </section>
  );
}
