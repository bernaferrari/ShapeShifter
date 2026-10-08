"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/lib/store/editorStore";
import type { Layer } from "@/lib/pathshift/types";
import { getPathDataBounds, pathToString } from "@/lib/pathshift/path/pathDataIO";
import { Check, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  appliedMotionPresets,
  motionPresetsForLayer,
  type MotionPreset,
  type MotionPresetId,
} from "@/lib/pathshift/motion/motionPresets";
import { Section } from "./InspectorControls";

// Previews rest on the finished pose and play while their row or menu item is pointed at.
const PREVIEW_ANIMATION: Record<MotionPresetId, string> = {
  spin: "group-hover:animate-motion-spin group-data-highlighted:animate-motion-spin",
  tilt: "group-hover:animate-motion-tilt group-data-highlighted:animate-motion-tilt",
  pulse: "group-hover:animate-motion-pulse group-data-highlighted:animate-motion-pulse",
  pop: "group-hover:animate-motion-pop group-data-highlighted:animate-motion-pop",
  fade: "group-hover:animate-motion-fade group-data-highlighted:animate-motion-fade",
  draw: "",
};
const DRAW_ANIMATION =
  "[stroke-dasharray:1] group-hover:animate-motion-draw group-data-highlighted:animate-motion-draw";

/** The layer's own artwork, played with the preset while its tile is hovered. */
function MotionPreview({ layer, preset }: { layer: Layer; preset: MotionPresetId }) {
  const art = React.useMemo(() => {
    if (layer.type !== "path") return null;
    const box = getPathDataBounds(layer.from);
    if (!box || box.w <= 0 || box.h <= 0) return null;
    const size = Math.max(box.w, box.h);
    const pad = size * 0.12;
    return {
      d: pathToString(layer.from),
      viewBox: `${box.x + box.w / 2 - size / 2 - pad} ${box.y + box.h / 2 - size / 2 - pad} ${size + pad * 2} ${size + pad * 2}`,
      stroke: size / 8,
    };
  }, [layer.from, layer.type]);

  if (!art)
    return (
      <span
        aria-hidden="true"
        className={cn(
          "size-3 rounded-[4px] bg-foreground/80",
          preset === "draw"
            ? "bg-transparent ring-2 ring-foreground/80"
            : PREVIEW_ANIMATION[preset],
        )}
      />
    );
  return (
    <svg
      aria-hidden="true"
      viewBox={art.viewBox}
      className={cn("size-3.5 overflow-visible", PREVIEW_ANIMATION[preset])}
    >
      {preset === "draw" ? (
        <path
          d={art.d}
          pathLength={1}
          fill="none"
          stroke="currentColor"
          strokeWidth={art.stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={DRAW_ANIMATION}
        />
      ) : (
        <path
          d={art.d}
          fill="currentColor"
          fillRule={layer.fillType === "evenOdd" ? "evenodd" : "nonzero"}
        />
      )}
    </svg>
  );
}

/**
 * Figma-style list: + adds a motion, each applied one is a row with −. The
 * keyframes stay ordinary timeline segments; editing them by hand drops the row.
 */
export function MotionPresetsSection({
  layer,
  center,
}: {
  layer: Layer;
  center: { x: number; y: number } | null;
}) {
  const blocks = useEditorStore((state) => state.animation.blocks);
  const duration = useEditorStore((state) => state.animation.duration);
  const presets = motionPresetsForLayer(layer);
  if (!presets.length) return null;

  const applied = appliedMotionPresets(layer, blocks, duration);
  const ownBlocks = blocks.filter((block) => String(block.layerId) === String(layer.id));
  const replaces = (preset: MotionPreset) =>
    ownBlocks.some((block) => preset.properties.includes(block.propertyName));
  const remove = (preset: MotionPreset) =>
    useEditorStore
      .getState()
      .removeTimelineBlocks(
        ownBlocks
          .filter((block) => preset.properties.includes(block.propertyName))
          .map((block) => block.id),
      );

  return (
    <Section
      title="Motion"
      action={
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                className="size-7 text-muted-foreground hover:text-foreground"
                disabled={layer.locked}
                aria-label="Add motion"
                title="Add motion"
              />
            }
          >
            <Plus className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            {presets.map((preset) => {
              const isApplied = applied.includes(preset);
              return (
                <DropdownMenuItem
                  key={preset.id}
                  disabled={isApplied}
                  className="group items-start gap-2 py-1.5"
                  onClick={() =>
                    useEditorStore.getState().applyMotionPreset(layer.id, preset.id, center)
                  }
                >
                  <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded bg-secondary text-foreground">
                    <MotionPreview layer={layer} preset={preset.id} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2 text-[12px]">
                      {preset.name}
                      {isApplied && <Check className="size-3.5 text-muted-foreground" />}
                    </span>
                    <span className="block text-[11px] leading-4 text-muted-foreground">
                      {preset.description}
                      {!isApplied && replaces(preset) && " Replaces current keyframes."}
                    </span>
                  </span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      {applied.length ? (
        <div className="-mx-1 space-y-0.5">
          {applied.map((preset) => (
            <div
              key={preset.id}
              className="group flex h-7 items-center gap-2 rounded-md pl-1 pr-0 hover:bg-muted/60"
            >
              <span className="grid size-5 shrink-0 place-items-center rounded bg-secondary text-foreground">
                <MotionPreview layer={layer} preset={preset.id} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px]">{preset.name}</span>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                0–{Math.round(duration)} ms
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                className="size-7 text-muted-foreground hover:text-foreground"
                disabled={layer.locked}
                onClick={() => remove(preset)}
                aria-label={`Remove ${preset.name} motion`}
                title={`Remove ${preset.name}`}
              >
                <Minus className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </Section>
  );
}
