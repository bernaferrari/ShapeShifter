"use client";

import React from "react";
import { useEditorStore } from "@/lib/store/editorStore";
import { resolveNextPose } from "@/lib/pathshift/motion/nextPose";
import type { SceneOwner, OwnedLayerRef } from "@/lib/pathshift/scene/selection";
import { useTimelineViewSettings } from "../timeline/timelineViewSettings";
import { formatTimelineTime } from "../timeline/timelineScale";
import { ClipDefinitions, LayerDraw } from "./WorldArtboards";

export function WorldNextPose({
  owners,
  selection,
  worldPerPx,
}: {
  owners: SceneOwner[];
  selection: OwnedLayerRef[];
  worldPerPx: number;
}) {
  const enabled = useTimelineViewSettings((state) => state.showNextPose);
  const unit = useTimelineViewSettings((state) => state.unit);
  const fps = useTimelineViewSettings((state) => state.fps);
  const playing = useEditorStore((state) => state.isPlaying);
  const selected = useEditorStore(
    (state) => state.hasCanvasSelection && state.selectionKind === "layer",
  );
  const poses = React.useMemo(() => {
    if (!enabled || playing || !selected) return [];
    return owners.flatMap((owner) => {
      if (!owner.animation) return [];
      const ids = selection
        .filter((ref) => ref.ownerId === owner.ownerId)
        .map((ref) => ref.layerId);
      const pose = resolveNextPose(
        owner.layers,
        owner.animation,
        ids,
        (owner.progress ?? 0) * owner.animation.duration,
      );
      return pose ? [{ owner, pose }] : [];
    });
  }, [enabled, playing, selected, owners, selection]);
  return poses.map(({ owner, pose }) => {
    const id = `next-pose-${owner.ownerId}`;
    const caption = `Next · ${formatTimelineTime(pose.time, unit, fps)}`;
    return (
      <g
        key={id}
        transform={`translate(${owner.origin.x} ${owner.origin.y})`}
        pointerEvents="none"
        aria-hidden="true"
        data-next-pose-owner={owner.ownerId}
        data-next-pose-time={pose.time}
      >
        <ClipDefinitions ownerId={id} draws={pose.draws} />
        {pose.draws
          .filter((draw) => !draw.isClipPath)
          .map((draw) => (
            <LayerDraw key={String(draw.id)} ownerId={id} draw={draw} ghost />
          ))}
        {pose.bounds && (
          <g
            transform={`translate(${pose.bounds.x} ${pose.bounds.y + pose.bounds.h + 6 * worldPerPx})`}
          >
            <rect
              x={-4 * worldPerPx}
              width={(caption.length * 6 + 8) * worldPerPx}
              height={18 * worldPerPx}
              rx={4 * worldPerPx}
              fill="var(--background)"
              fillOpacity={0.9}
            />
            <text
              y={12 * worldPerPx}
              fontSize={10 * worldPerPx}
              className="font-mono"
              fill="var(--primary)"
            >
              {caption}
            </text>
          </g>
        )}
      </g>
    );
  });
}
