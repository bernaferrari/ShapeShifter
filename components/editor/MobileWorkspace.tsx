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
}: {
  canvas: React.ReactNode;
  sheet: MobileSheet | null;
  onSheetChange: (sheet: MobileSheet | null) => void;
}) {
  const hasSelection = useEditorStore((state) => state.selectionKind === "layer");
  const easingBlockId = useInspectorView((state) => state.easingBlockId);
  // Tapping a segment's easing in the timeline opens it where it can be seen.
  React.useEffect(() => {
    if (easingBlockId) onSheetChange("design");
  }, [easingBlockId, onSheetChange]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-muted">
      <div className="relative flex min-h-0 flex-1">{canvas}</div>
      {sheet && (
        <section
          aria-label={TABS.find((tab) => tab.id === sheet)?.label}
          className={cn(
            "flex shrink-0 flex-col overflow-hidden border-t border-border bg-sidebar",
            "motion-safe:animate-in motion-safe:slide-in-from-bottom-4 motion-safe:duration-200",
            sheet === "motion" ? "h-[38dvh]" : "h-[46dvh]",
          )}
        >
          {sheet === "layers" && <LayersPanel className="h-full w-full border-r-0" />}
          {sheet === "design" && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <Inspector />
            </div>
          )}
          {sheet === "motion" && <LayerTimeline layersWidth={164} />}
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
