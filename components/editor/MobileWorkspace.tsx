"use client";

import React from "react";
import { Clapperboard, Layers, SlidersHorizontal } from "lucide-react";
import { useEditorStore } from "@/lib/store/editorStore";
import { cn } from "@/lib/utils";
import { Inspector } from "./Inspector";
import { LayerTimeline } from "./LayerTimeline";
import { LayersPanel } from "./LayersPanel";
import { useInspectorView } from "./inspector/inspectorView";

export type MobileSheet = "layers" | "design" | "motion";

const TABS: { id: MobileSheet; label: string; icon: React.ReactNode }[] = [
  { id: "layers", label: "Layers", icon: <Layers className="size-5" /> },
  { id: "design", label: "Design", icon: <SlidersHorizontal className="size-5" /> },
  { id: "motion", label: "Motion", icon: <Clapperboard className="size-5" /> },
];

/**
 * The phone editor: the canvas owns the screen and the panels open one at a
 * time as a sheet above a tab bar, so the artwork always stays visible.
 */
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
  const [sheetPercent, setSheetPercent] = React.useState(52);
  const hasSelection = useEditorStore((state) => state.selectionKind === "layer");
  const easingBlockId = useInspectorView((state) => state.easingBlockId);
  // Tapping a segment's easing in the timeline opens it where it can be seen.
  React.useEffect(() => {
    if (easingBlockId) onSheetChange("design");
  }, [easingBlockId, onSheetChange]);

  return (
    <div className="mobile-workspace relative flex min-h-0 flex-1 flex-col overflow-hidden bg-muted">
      <div className="relative flex min-h-0 flex-1">{canvas}</div>
      {sheet && (
        <section
          aria-label={TABS.find((tab) => tab.id === sheet)?.label}
          style={{
            flexBasis: constrained ? "calc(100% - 56px)" : `${sheetPercent}%`,
            maxHeight: constrained ? "calc(100% - 56px)" : "calc(100% - 112px)",
            minHeight: "96px",
          }}
          className={cn(
            "flex shrink-0 flex-col overflow-hidden border-t border-border bg-sidebar",
            "motion-safe:animate-in motion-safe:slide-in-from-bottom-4 motion-safe:duration-200",
          )}
        >
          <div className="flex min-h-10 shrink-0 items-center gap-3 border-b border-border px-3">
            {!constrained && (
              <label className="flex min-w-0 flex-1 items-center gap-2 text-[12px] text-muted-foreground">
                Panel height
                <input
                  type="range"
                  aria-label="Panel height"
                  min={30}
                  max={75}
                  value={sheetPercent}
                  onChange={(event) => setSheetPercent(Number(event.target.value))}
                  className="min-w-0 flex-1 accent-primary"
                />
              </label>
            )}
            {constrained && (
              <span className="flex-1 text-[12px] font-medium">
                {TABS.find((tab) => tab.id === sheet)?.label}
              </span>
            )}
            <button
              type="button"
              aria-label="Return to canvas"
              onClick={() => {
                (document.activeElement as HTMLElement | null)?.blur();
                onSheetChange(null);
              }}
              className="min-h-10 px-2 text-[12px]"
            >
              Canvas
            </button>
          </div>
          {sheet === "layers" && <LayersPanel className="min-h-0 flex-1 w-full border-r-0" />}
          {sheet === "design" && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <Inspector />
            </div>
          )}
          {sheet === "motion" && <LayerTimeline layersWidth={112} />}
        </section>
      )}
      <nav
        aria-label="Panels"
        className="flex shrink-0 items-stretch border-t border-border bg-background pb-[env(safe-area-inset-bottom)]"
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
                "relative flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors",
                active ? "text-primary" : "text-muted-foreground active:text-foreground",
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
    </div>
  );
}
