"use client";

import React from "react";
import { DiamondPlus } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { timelinePropertiesForLayer } from "@/lib/pathshift/motion/timelineProperties";
import { createLayerTreeModel } from "@/lib/pathshift/scene/layerHierarchy";
import { sameKeyframeTime } from "@/lib/pathshift/motion/timelineKeyframes";
import { useEditorStore } from "@/lib/store/editorStore";
import { useTimelineViewSettings } from "./timelineViewSettings";
import { formatTimelineTime } from "./timelineScale";

export function TimelineInsertKeyframeButton({
  blockId,
  label = "Insert keyframe at playhead",
  presentation = "button",
}: {
  blockId?: string;
  label?: string;
  presentation?: "button" | "icon" | "menu";
}) {
  const progress = useEditorStore((state) => state.progress);
  const unit = useTimelineViewSettings((state) => state.unit);
  const fps = useTimelineViewSettings((state) => state.fps);
  const animation = useEditorStore((state) => state.animation);
  const selectedIds = useEditorStore((state) => state.selectedBlockIds);
  const selectedLayerId = useEditorStore((state) => state.selectedLayerId);
  const hasSelection = useEditorStore(
    (state) => state.hasCanvasSelection && state.selectionKind === "layer",
  );
  const layers = useEditorStore((state) => state.layers);
  const tree = React.useMemo(() => createLayerTreeModel(layers), [layers]);
  const selectedLayer = tree.allLayers.find(
    (layer) => String(layer.id) === String(selectedLayerId),
  );
  const defaultProperty = selectedLayer?.type === "group" ? "rotation" : "pathData";
  const time = progress * animation.duration;
  const trackKey = (block: (typeof animation.blocks)[number]) =>
    `${block.layerId}\0${block.propertyName}`;
  const tracks = new Set(
    animation.blocks.filter((block) => selectedIds.includes(block.id)).map(trackKey),
  );
  const candidates = animation.blocks
    .filter((block) => (blockId ? block.id === blockId : tracks.has(trackKey(block))))
    .filter(
      (block, index, all) => all.findIndex((item) => trackKey(item) === trackKey(block)) === index,
    );
  const targets = candidates.length
    ? candidates
    : hasSelection && !blockId
      ? [{ layerId: selectedLayerId, propertyName: defaultProperty }]
      : [];
  const canInsert = targets.some((target) => {
    const layer = tree.allLayers.find((item) => String(item.id) === String(target.layerId));
    return (
      layer &&
      !layer.locked &&
      !tree.ancestorsOf(layer.id).some((item) => item.locked) &&
      timelinePropertiesForLayer(layer.type).includes(target.propertyName as never) &&
      !animation.blocks.some(
        (block) =>
          String(block.layerId) === String(target.layerId) &&
          block.propertyName === target.propertyName &&
          (sameKeyframeTime(block.startTime, time) || sameKeyframeTime(block.endTime, time)),
      )
    );
  });
  const insert = () => {
    const store = useEditorStore.getState();
    store.beginHistoryGesture();
    try {
      const ids: string[] = [];
      for (const target of targets) {
        store.addKeyframeAtPlayhead(target.layerId, target.propertyName);
        ids.push(...useEditorStore.getState().selectedBlockIds);
      }
      const key = useEditorStore.getState().selectedKeyframe;
      store.selectBlocks([...new Set(ids)]);
      useEditorStore.setState({ selectedKeyframe: key, keyframeEditorOpen: Boolean(key) });
    } finally {
      store.endHistoryGesture();
    }
  };
  if (presentation === "menu")
    return (
      <DropdownMenuItem aria-label={label} disabled={!canInsert} onClick={insert}>
        <DiamondPlus className="size-4" />
        Add keyframe
      </DropdownMenuItem>
    );
  return (
    <button
      type="button"
      aria-label={label}
      title={
        canInsert
          ? `${label} · ${formatTimelineTime(time, unit, fps)}`
          : "Select a layer or track and move the playhead to a new time"
      }
      disabled={!canInsert}
      onClick={insert}
      className={
        presentation === "icon"
          ? "grid size-6 pointer-coarse:size-11 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-35"
          : "flex h-6 pointer-coarse:h-11 touch-manipulation shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-35"
      }
    >
      <DiamondPlus className="size-3.5" />
      {presentation !== "icon" && <span>Add keyframe</span>}
    </button>
  );
}
