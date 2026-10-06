"use client";

import React from "react";
import { useEditorStore, type EditorState } from "@/lib/store/editorStore";
import { beginLiveGesture, endLiveGesture, ownsLiveGesture } from "@/lib/store/liveGesture";
import { planTimelineMove } from "@/lib/shapeshifter/motion/timelineRetiming";
import { createLayerTreeModel } from "@/lib/shapeshifter/scene/layerHierarchy";
import {
  linkedTimelineKeyframe,
  timelineKeyframeRange,
} from "@/lib/shapeshifter/motion/timelineKeyframes";
import { snapTimelineOffset, timelineSnapTargets, type TimelineSnapTarget } from "./timelineTiming";
import { useTimelineNavigationCancellation } from "./timelineNavigationCancellation";

type Gesture = {
  marker: ReturnType<typeof beginLiveGesture>;
  ownerId: string;
  pointerId: number;
  element: HTMLElement;
  startX: number;
  duration: number;
  width: number;
  ids: string[];
  edge?: "start" | "end";
  originalTime: number;
  anchors: number[];
  targets: TimelineSnapTarget[];
  range: [number, number];
  blocks: EditorState["animation"]["blocks"];
  historyEntry?: EditorState["history"][number];
  offset: number;
};

/** Pointer retiming is one owned transaction, shared by rails and path clips. */
export function useTimelineGesture({
  gridStep,
  snapping = true,
  onSnapChange,
}: {
  gridStep: number;
  snapping?: boolean;
  onSnapChange?: (target: TimelineSnapTarget | null) => void;
}) {
  const ref = React.useRef<Gesture | null>(null);
  const moved = React.useRef(false);
  const reportSnap = React.useRef(onSnapChange);
  reportSnap.current = onSnapChange;
  const finish = React.useCallback((cancelled = false) => {
    const session = ref.current;
    ref.current = null;
    if (!session) return;
    const state = useEditorStore.getState();
    if (
      cancelled &&
      session.historyEntry &&
      ownsLiveGesture(session.marker) &&
      state.selectedFrameId === session.ownerId &&
      state.history.at(-1) === session.historyEntry
    )
      state.cancelLastHistoryTransaction();
    endLiveGesture(session.marker);
    reportSnap.current?.(null);
    try {
      session.element.releasePointerCapture(session.pointerId);
    } catch {
      /* Capture may already be lost. */
    }
  }, []);
  const cancelForNavigation = React.useCallback(() => finish(true), [finish]);
  useTimelineNavigationCancellation(cancelForNavigation);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !ref.current) return;
      event.preventDefault();
      event.stopPropagation();
      finish(true);
    };
    window.addEventListener("keydown", onKey, true);
    const unsubscribe = useEditorStore.subscribe((state) => {
      const session = ref.current;
      if (
        session &&
        (state.selectedFrameId !== session.ownerId ||
          !ownsLiveGesture(session.marker) ||
          (session.historyEntry && state.history.at(-1) !== session.historyEntry))
      )
        finish();
    });
    return () => {
      unsubscribe();
      window.removeEventListener("keydown", onKey, true);
      finish(true);
    };
  }, [finish]);

  const begin = (event: React.PointerEvent<HTMLElement>, ids: string[], edge?: "start" | "end") => {
    if (event.button !== 0) return;
    finish(true);
    const state = useEditorStore.getState();
    if (state.dragState || !ids.length) return;
    const block = state.animation.blocks.find((item) => item.id === ids[0]);
    if (!block) return;
    const plan = planTimelineMove(state.animation.blocks, ids, state.animation.duration);
    if (!plan) return;
    const tree = createLayerTreeModel(state.layers);
    if (
      state.animation.blocks.some((item) => {
        if (!plan.edges.has(item.id)) return false;
        const layer = tree.allLayers.find(
          (candidate) => String(candidate.id) === String(item.layerId),
        );
        return !layer || layer.locked || tree.ancestorsOf(layer.id).some((parent) => parent.locked);
      })
    )
      return;
    const originalTime = edge === "end" ? block.endTime : block.startTime;
    const [min, max] = edge
      ? timelineKeyframeRange(state.animation.blocks, block, edge, state.animation.duration)
      : plan.range;
    const adjacent = edge && linkedTimelineKeyframe(state.animation.blocks, block, edge);
    const excluded = edge
      ? new Set([block.id, ...(adjacent ? [adjacent.id] : [])])
      : new Set(plan.edges.keys());
    const element = event.currentTarget;
    const row =
      element.closest<HTMLElement>("[data-timeline-lane]") ??
      element.closest<HTMLElement>("[data-timeline-row]");
    useEditorStore.setState({ isPlaying: false });
    ref.current = {
      marker: beginLiveGesture("timeline-retime"),
      ownerId: state.selectedFrameId,
      pointerId: event.pointerId,
      element,
      startX: event.clientX,
      duration: state.animation.duration,
      width: Math.max(1, row?.getBoundingClientRect().width ?? 300),
      ids,
      edge,
      originalTime,
      anchors: edge
        ? [originalTime]
        : plan.targets.flatMap((item) => [item.startTime, item.endTime]),
      range: edge ? [min - originalTime, max - originalTime] : [min, max],
      targets: timelineSnapTargets(
        state.animation.blocks,
        state.animation.duration,
        state.progress * state.animation.duration,
        excluded,
      ),
      blocks: state.animation.blocks,
      offset: 0,
    };
    moved.current = false;
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      /* Synthetic pointers may not support capture. */
    }
  };

  const move = (event: React.PointerEvent<HTMLElement>) => {
    const session = ref.current;
    if (!session || event.pointerId !== session.pointerId) return;
    const state = useEditorStore.getState();
    if (
      !ownsLiveGesture(session.marker) ||
      state.animation.blocks !== session.blocks ||
      state.animation.duration !== session.duration
    ) {
      finish();
      return;
    }
    const pixels = event.clientX - session.startX;
    if (!moved.current && Math.abs(pixels) < 3) return;
    const result = snapTimelineOffset({
      offset: (pixels * session.duration) / session.width,
      anchors: session.anchors,
      targets: session.targets,
      range: session.range,
      duration: session.duration,
      contentWidth: session.width,
      gridStep,
      enabled: snapping,
      bypass: event.altKey,
    });
    if (Math.abs(result.offset - session.offset) < 1e-9) {
      reportSnap.current?.(result.target);
      return;
    }
    if (!session.historyEntry) {
      state.pushHistory();
      session.historyEntry = useEditorStore.getState().history.at(-1);
    }
    if (session.edge)
      state.updateTimelineKeyframe(
        session.ids[0],
        session.edge,
        { time: session.originalTime + result.offset },
        { recordHistory: false },
      );
    else
      state.moveTimelineBlocks(session.ids, result.offset - session.offset, {
        recordHistory: false,
      });
    const next = useEditorStore.getState();
    const target = next.animation.blocks.find((item) => item.id === session.ids[0]);
    session.blocks = next.animation.blocks;
    session.offset =
      (session.edge === "end" ? target!.endTime : target!.startTime) - session.originalTime;
    moved.current = true;
    reportSnap.current?.(Math.abs(session.offset - result.offset) < 1e-7 ? result.target : null);
  };

  const end = (event: React.PointerEvent<HTMLElement>, cancelled = false) => {
    if (ref.current?.pointerId !== event.pointerId) return;
    finish(cancelled || (moved.current && Math.abs(ref.current.offset) < 1e-9));
  };
  return { begin, move, end, moved };
}
