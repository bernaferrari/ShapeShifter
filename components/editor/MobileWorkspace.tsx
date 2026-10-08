"use client";

import React from "react";
import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useTransform,
  type MotionValue,
  type MotionStyle,
} from "framer-motion";
import { Clapperboard, Layers, SlidersHorizontal } from "lucide-react";
import { useEditorStore } from "@/lib/store/editorStore";
import { cn } from "@/lib/utils";
import { Inspector } from "./Inspector";
import { LayerTimeline } from "./LayerTimeline";
import { LayersPanel } from "./LayersPanel";
import { MobilePanelHeaderProvider } from "./PanelHeader";
import { useInspectorView } from "./inspector/inspectorView";

export type MobileSheet = "layers" | "design" | "motion";
const TABS: { id: MobileSheet; label: string; icon: React.ReactNode }[] = [
  { id: "layers", label: "Layers", icon: <Layers className="size-5" /> },
  { id: "design", label: "Design", icon: <SlidersHorizontal className="size-5" /> },
  { id: "motion", label: "Motion", icon: <Clapperboard className="size-5" /> },
];
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Shared by the first-paint responsive shell and the interactive mobile workspace. */
export function MobilePanelTabs({
  sheet,
  onSheetChange,
}: {
  sheet: MobileSheet | null;
  onSheetChange: (sheet: MobileSheet | null) => void;
}) {
  const hasSelection = useEditorStore((state) => state.selectionKind === "layer");
  return (
    <nav
      aria-label="Panels"
      // Same bar as Glyphrise: neutral tiles, accent kept for selection and playhead.
      className="grid shrink-0 grid-cols-3 gap-1 border-t border-border bg-background p-1 pb-[calc(0.25rem+env(safe-area-inset-bottom))] select-none"
    >
      {TABS.map((tab) => {
        const active = sheet === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            aria-pressed={active}
            onClick={() => onSheetChange(active ? null : tab.id)}
            className={cn(
              "relative flex h-14 touch-manipulation flex-col items-center justify-center gap-1 rounded-lg text-[11px] font-medium transition-[background-color,color,transform] duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring active:scale-[0.96]",
              active
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.id === "design" && hasSelection && !active && (
              <span
                aria-hidden
                className="absolute top-2.5 left-[calc(50%+9px)] size-1.5 rounded-full bg-primary"
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}

function SheetHandle({
  height,
  min,
  max,
  onResize,
  onCommit,
  onClose,
}: {
  height: MotionValue<number>;
  min: number;
  max: number;
  onResize: (height: number) => void;
  onCommit: (height: number) => void;
  onClose: () => void;
}) {
  const [value, setValue] = React.useState(Math.round(height.get()));
  useMotionValueEvent(height, "change", (next) => setValue(Math.round(next)));
  const drag = React.useRef<{ id: number; y: number; height: number } | null>(null);
  const finish = (event: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    drag.current = null;
    if (cancelled) onResize(start.height);
    onCommit(height.get());
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Panel height"
      aria-orientation="vertical"
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      aria-valuenow={value}
      aria-valuetext={`${value} pixels. Drag up or down to resize.`}
      className="flex size-11 shrink-0 touch-none cursor-ns-resize select-none items-center justify-center rounded focus-visible:outline-2 focus-visible:outline-primary"
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        drag.current = { id: event.pointerId, y: event.clientY, height: height.get() };
        event.currentTarget.setPointerCapture(event.pointerId);
        onResize(height.get());
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start || start.id !== event.pointerId) return;
        onResize(clamp(start.height + start.y - event.clientY, min, max));
      }}
      onPointerUp={(event) => finish(event)}
      onPointerCancel={(event) => finish(event, true)}
      onLostPointerCapture={(event) => finish(event, true)}
      onKeyDown={(event) => {
        const next =
          event.key === "ArrowUp"
            ? value + 32
            : event.key === "ArrowDown"
              ? value - 32
              : event.key === "Home"
                ? min
                : event.key === "End"
                  ? max
                  : null;
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
        if (next === null) return;
        event.preventDefault();
        const resolved = clamp(next, min, max);
        onResize(resolved);
        onCommit(resolved);
      }}
    >
      <span aria-hidden className="h-1 w-9 rounded-full bg-muted-foreground/40" />
    </div>
  );
}

/** The sheet overlays a stable canvas; its handle follows the finger without relayout. */
export function MobileWorkspace({
  canvas,
  sheet,
  onSheetChange,
  constrained = false,
}: {
  constrained?: boolean;
  canvas: React.ReactNode;
  sheet: MobileSheet | null;
  onSheetChange: (sheet: MobileSheet | null) => void;
}) {
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const [bodyHeight, setBodyHeight] = React.useState(0);
  const [fraction, setFraction] = React.useState(0.52);
  const [shortFraction, setShortFraction] = React.useState(1);
  const [visibleSheet, setVisibleSheet] = React.useState(sheet);
  const height = useMotionValue(0);
  const progress = useMotionValue(sheet ? 1 : 0);
  const animation = React.useRef<ReturnType<typeof animate> | null>(null);
  const shownHeight = useTransform(() => height.get() * progress.get());
  const sheetY = useTransform(() => height.get() - shownHeight.get());
  // Move the artwork into the remaining space without changing its zoom.
  const canvasY = useTransform(() => -shownHeight.get() / 2);
  const controlsOffset = useTransform(() => `${shownHeight.get() / 2}px`);
  const reducedMotion = useReducedMotion();
  const min = Math.min(160, bodyHeight);
  const max = Math.max(min, bodyHeight - (constrained ? 0 : 56));
  const keyframeEditorOpen = useEditorStore((state) => state.keyframeEditorOpen);
  const easingBlockId = useInspectorView((state) => state.easingBlockId);
  React.useEffect(() => {
    if (keyframeEditorOpen) onSheetChange("motion");
  }, [keyframeEditorOpen, onSheetChange]);
  React.useEffect(() => {
    if (easingBlockId) onSheetChange("design");
  }, [easingBlockId, onSheetChange]);
  React.useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const observer = new ResizeObserver(([entry]) => setBodyHeight(entry.contentRect.height));
    observer.observe(body);
    setBodyHeight(body.getBoundingClientRect().height);
    return () => observer.disconnect();
  }, []);
  React.useLayoutEffect(() => {
    height.set(clamp(bodyHeight * (constrained ? shortFraction : fraction), min, max));
  }, [bodyHeight, constrained, fraction, shortFraction, height, min, max]);
  React.useLayoutEffect(() => {
    animation.current?.stop();
    if (sheet) setVisibleSheet(sheet);
    animation.current = animate(progress, sheet ? 1 : 0, {
      duration: reducedMotion ? 0 : 0.22,
      ease: [0.22, 1, 0.36, 1],
      onComplete: () => {
        if (!sheet) setVisibleSheet(null);
      },
    });
    return () => animation.current?.stop();
  }, [sheet, progress, reducedMotion]);
  const close = () => {
    (document.activeElement as HTMLElement | null)?.blur();
    useEditorStore.getState().setKeyframeEditorOpen(false);
    onSheetChange(null);
    document.getElementById("editor-canvas")?.focus({ preventScroll: true });
  };
  const resize = (next: number) => {
    animation.current?.stop();
    progress.set(1);
    height.set(clamp(next, min, max));
  };

  return (
    <div className="mobile-workspace relative flex min-h-0 flex-1 flex-col overflow-hidden bg-muted">
      <div ref={bodyRef} className="relative min-h-0 flex-1 overflow-hidden">
        <motion.div
          style={{ y: canvasY, "--mobile-canvas-offset": controlsOffset } as MotionStyle}
          className="absolute inset-0 flex min-h-0"
        >
          {canvas}
        </motion.div>
        {visibleSheet && (
          <motion.section
            aria-label={TABS.find((tab) => tab.id === visibleSheet)?.label}
            inert={!sheet}
            style={{ height, y: sheetY }}
            className="absolute inset-x-0 bottom-0 flex flex-col overflow-hidden rounded-t-xl border-t border-border bg-sidebar shadow-[0_-4px_16px_rgb(0_0_0/0.08)]"
          >
            <MobilePanelHeaderProvider
              onClose={close}
              handle={
                <SheetHandle
                  height={height}
                  min={min}
                  max={max}
                  onResize={resize}
                  onCommit={(next) => {
                    const value = bodyHeight ? next / bodyHeight : 0.52;
                    if (constrained) setShortFraction(value);
                    else setFraction(value);
                  }}
                  onClose={close}
                />
              }
            >
              {visibleSheet === "layers" && (
                <LayersPanel className="min-h-0 flex-1 w-full border-r-0" />
              )}
              {visibleSheet === "design" && (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <Inspector />
                </div>
              )}
              {visibleSheet === "motion" && <LayerTimeline layersWidth={128} compact />}
            </MobilePanelHeaderProvider>
          </motion.section>
        )}
      </div>
      <MobilePanelTabs
        sheet={sheet}
        onSheetChange={(next) => {
          useEditorStore.getState().setKeyframeEditorOpen(false);
          onSheetChange(next);
        }}
      />
    </div>
  );
}
