"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCanvasFrameBounds } from "./useWorldCamera";
import { snapValueToStep, type Rect } from "@/lib/pathshift/camera";
import {
  ObjectDragGesture,
  type ObjectDragModifiers,
} from "@/lib/pathshift/gestures/select/ObjectDragGesture";
import { hitTestOwnedLayers } from "@/lib/pathshift/scene/hitTest";
import { resolveWorldLayerDraws } from "@/lib/pathshift/scene/render";
import { getOwnedLayerBounds, type SceneOwner } from "@/lib/pathshift/scene/selection";
import { snapRectToGuides, type GuideLine } from "@/lib/pathshift/smartGuides";
import type { AnimationState, Layer, Point } from "@/lib/pathshift/types";
import { vectorFromPageMetadata } from "@/lib/pathshift/vectorSpace";
import { canMoveLayerRootsBetweenOwners } from "@/lib/store/commands/moveLayersBetweenOwners";
import { beginLiveGesture, endLiveGesture, ownsLiveGesture } from "@/lib/store/liveGesture";
import type { FrozenLayerTransform } from "./WorldSelectionOverlay";
import {
  applyWorldLayerTranslation,
  buildWorldTransformSelection,
  recordWorldTransformChange,
  selectedWorldSubtreeIds,
} from "./worldLayerTransforms";
import {
  PAGE_ROOT_ID,
  useEditorStore,
  type CanvasFrame,
  type EditorState,
  type LayerSelectionRef,
} from "@/lib/store/editorStore";

interface LayerDropPreview {
  ownerId: string;
  label: string;
  point: { x: number; y: number };
}

interface WorldObjectSelectionOptions {
  frames: CanvasFrame[];
  sceneOwners: SceneOwner[];
  selectedLayerRefs: LayerSelectionRef[];
  selectedLayerRefKeys: Set<string>;
  selectionBounds: Rect | null;
  snapToGrid: boolean;
  snapStep: number;
  worldPerPixel: number;
  selectedFrameId: string;
  animation: EditorState["animation"];
  rootAnimation: EditorState["rootAnimation"];
  progress: number;
  syncActiveOwner: EditorState["syncActiveOwner"];
}

interface DragOwnerBaseline {
  layers: Layer[];
  animation: AnimationState;
  items: FrozenLayerTransform[];
}
interface ObjectDragBaseline {
  marker?: ReturnType<typeof beginLiveGesture>;
  owners: Map<string, DragOwnerBaseline>;
  ownerId: string;
  progress: number;
  idSeed: number;
  selectionKey: string;
  offset: Point;
  total: Point;
  historyEntry?: EditorState["history"][number];
  cloned: boolean;
  changed: boolean;
}
const selectionKey = (state: EditorState) =>
  state.selectedLayerRefs
    .map((ref) => `${ref.ownerId}\u0000${String(ref.layerId)}`)
    .sort()
    .join("\u0001");

function captureDragBaseline(state: EditorState): ObjectDragBaseline {
  const idsByOwner = new Map<string, Array<string | number>>();
  const refs = state.selectedLayerRefs.length
    ? state.selectedLayerRefs
    : state.selectedLayerIds.map((layerId) => ({ ownerId: state.selectedFrameId, layerId }));
  for (const ref of refs)
    idsByOwner.set(ref.ownerId, [...(idsByOwner.get(ref.ownerId) ?? []), ref.layerId]);
  const owners = new Map<string, DragOwnerBaseline>();
  for (const [ownerId, ids] of idsByOwner) {
    const frame = state.frames.find((item) => item.id === ownerId);
    const layers =
      state.selectedFrameId === ownerId
        ? state.layers
        : ownerId === PAGE_ROOT_ID
          ? state.rootLayers
          : frame?.layers;
    const animation =
      state.selectedFrameId === ownerId
        ? state.animation
        : ownerId === PAGE_ROOT_ID
          ? state.rootAnimation
          : frame?.animation;
    if (!layers || !animation) continue;
    const selection = buildWorldTransformSelection(layers, ids, animation, state.progress);
    if (selection?.items.length)
      owners.set(ownerId, {
        layers,
        animation,
        items: selection.items.map((item) => item.evaluated),
      });
  }
  return {
    owners,
    ownerId: state.selectedFrameId,
    progress: state.progress,
    idSeed: Date.now(),
    selectionKey: selectionKey(state),
    offset: { x: 0, y: 0 },
    total: { x: 0, y: 0 },
    cloned: false,
    changed: false,
  };
}

export function useWorldObjectSelection({
  frames,
  sceneOwners,
  selectedLayerRefs,
  selectedLayerRefKeys,
  selectionBounds,
  snapToGrid,
  snapStep,
  worldPerPixel,
  selectedFrameId,
  animation,
  rootAnimation,
  progress,
  syncActiveOwner,
}: WorldObjectSelectionOptions) {
  const dragRef = useRef<ObjectDragGesture | null>(null);
  const baselineRef = useRef<ObjectDragBaseline | null>(null);
  const [smartGuides, setSmartGuides] = useState<GuideLine[]>([]);
  const [dropPreview, setDropPreview] = useState<LayerDropPreview | null>(null);

  const hitArtboard = useCallback(
    (point: { x: number; y: number } | null) => {
      if (!point) return null;
      for (const frame of [...frames].reverse()) {
        const bounds = getCanvasFrameBounds(frame);
        if (
          point.x >= bounds.x &&
          point.x <= bounds.x + bounds.w &&
          point.y >= bounds.y &&
          point.y <= bounds.y + bounds.h
        ) {
          return frame.id;
        }
      }
      return null;
    },
    [frames],
  );

  const hitLayerAtWorld = useCallback(
    (point: { x: number; y: number } | null) => {
      if (!point) return null;
      const rootOwner = sceneOwners.find((owner) => owner.ownerId === PAGE_ROOT_ID);
      const frameOwners = [...sceneOwners]
        .filter((owner) => owner.ownerId !== PAGE_ROOT_ID)
        .filter((owner) => {
          const frame = frames.find((candidate) => candidate.id === owner.ownerId);
          if (!frame) return false;
          const bounds = getCanvasFrameBounds(frame);
          return (
            point.x >= bounds.x &&
            point.x <= bounds.x + bounds.w &&
            point.y >= bounds.y &&
            point.y <= bounds.y + bounds.h
          );
        })
        .reverse();
      const hit = hitTestOwnedLayers(
        rootOwner ? [rootOwner, ...frameOwners] : frameOwners,
        point,
        Math.max(worldPerPixel * 10, 2),
      );
      return hit ? { frameId: hit.ownerId, layerId: hit.layerId } : null;
    },
    [frames, sceneOwners, worldPerPixel],
  );

  const selectOwnedLayer = useCallback((hit: { frameId: string; layerId: string | number }) => {
    const store = useEditorStore.getState();
    if (hit.frameId === PAGE_ROOT_ID) {
      store.selectRootLayer(hit.layerId);
      return;
    }
    if (hit.frameId !== store.selectedFrameId) store.selectFrame(hit.frameId);
    useEditorStore.getState().selectLayer(hit.layerId);
  }, []);

  const resolveDragTotal = useCallback(
    (total: { x: number; y: number }, modifiers: ObjectDragModifiers) => {
      let next = { ...total };
      if (snapToGrid && !modifiers.bypassSnap) {
        next = {
          x: snapValueToStep(next.x, snapStep),
          y: snapValueToStep(next.y, snapStep),
        };
      }

      if (!modifiers.bypassSnap && selectionBounds) {
        const moving = {
          ...selectionBounds,
          x: selectionBounds.x + next.x,
          y: selectionBounds.y + next.y,
        };
        const targets = frames.map(getCanvasFrameBounds);
        for (const owner of sceneOwners) {
          const selectedIds = [...selectedLayerRefKeys]
            .filter((key) => key.startsWith(`${owner.ownerId}:`))
            .map((key) => key.slice(owner.ownerId.length + 1));
          const movedIds = selectedWorldSubtreeIds(owner.layers, selectedIds);
          for (const item of getOwnedLayerBounds(owner)) {
            if (movedIds.has(String(item.layerId))) continue;
            targets.push(item.bounds);
          }
        }
        const snapped = snapRectToGuides(moving, targets, worldPerPixel * 6);
        next.x += snapped.x - moving.x;
        next.y += snapped.y - moving.y;
        setSmartGuides(snapped.guides);
      } else {
        setSmartGuides([]);
      }
      return next;
    },
    [
      frames,
      sceneOwners,
      selectedLayerRefKeys,
      selectionBounds,
      snapStep,
      snapToGrid,
      worldPerPixel,
    ],
  );

  const clearFeedback = useCallback(() => {
    setSmartGuides([]);
    setDropPreview(null);
  }, []);

  const startDrag = useCallback(
    (start: { x: number; y: number }) => {
      const prior = baselineRef.current;
      dragRef.current?.cancel();
      endLiveGesture(prior?.marker);
      const initial = captureDragBaseline(useEditorStore.getState());
      baselineRef.current = initial;
      if (!initial.owners.size) {
        dragRef.current = null;
        baselineRef.current = null;
        return;
      }
      initial.marker = beginLiveGesture("world-object", start);
      useEditorStore.setState({ isPlaying: false });
      dragRef.current = new ObjectDragGesture(start, {
        beginTransaction: () => {
          useEditorStore.getState().pushHistory();
          if (baselineRef.current)
            baselineRef.current.historyEntry = useEditorStore.getState().history.at(-1);
        },
        cloneSelection: () => {
          const before = baselineRef.current;
          if (!before) return;
          const refs = [...before.owners].flatMap(([ownerId, owner]) =>
            owner.items.map((item) => ({ ownerId, layerId: item.id })),
          );
          const activeIds = refs
            .filter((ref) => ref.ownerId === before.ownerId)
            .map((ref) => ref.layerId);
          useEditorStore.setState({
            selectedLayerRefs: refs,
            selectedLayerIds: activeIds,
            selectedLayerId: activeIds.at(-1) ?? refs.at(-1)!.layerId,
          });
          useEditorStore.getState().duplicateSelectedLayersOffset(0, 0, { recordHistory: false });
          baselineRef.current = {
            ...captureDragBaseline(useEditorStore.getState()),
            offset: before.total,
            total: before.total,
            historyEntry: before.historyEntry,
            marker: before.marker,
            cloned: true,
          };
        },
        resolveTotalDelta: resolveDragTotal,
        applyDelta: (_delta, total) => {
          const baseline = baselineRef.current;
          if (!baseline) return;
          const state = useEditorStore.getState();
          const records = new Map<string, { layers: Layer[]; animation: AnimationState }>();
          const delta = { x: total.x - baseline.offset.x, y: total.y - baseline.offset.y };
          baseline.total = total;
          baseline.changed = false;
          for (const [ownerId, owner] of baseline.owners) {
            const translated = applyWorldLayerTranslation(owner.layers, owner.items, delta);
            const recorded = recordWorldTransformChange(
              owner.layers,
              translated,
              owner.animation,
              baseline.progress,
              owner.items.map((item) => item.id),
              ["translateX", "translateY"],
              baseline.idSeed,
            );
            records.set(ownerId, recorded);
            baseline.changed ||=
              recorded.layers !== owner.layers || recorded.animation !== owner.animation;
          }
          const root = records.get(PAGE_ROOT_ID);
          const active = records.get(state.selectedFrameId);
          useEditorStore.setState({
            frames: state.frames.map((frame) =>
              records.has(frame.id) ? { ...frame, ...records.get(frame.id)! } : frame,
            ),
            ...(root ? { rootLayers: root.layers, rootAnimation: root.animation } : {}),
            ...(active ? { layers: active.layers, animation: active.animation } : {}),
            isPlaying: false,
          });
          syncActiveOwner({ includeAnimation: true });
        },
        commit: (result) => {
          const store = useEditorStore.getState();
          const baseline = baselineRef.current;
          if (!baseline) return;
          if (!baseline.changed && !baseline.cloned) {
            if (store.history.at(-1) === baseline.historyEntry)
              store.cancelLastHistoryTransaction();
            clearFeedback();
            return;
          }
          syncActiveOwner({ includeAnimation: true });
          const ownerIds = new Set(store.selectedLayerRefs.map((ref) => ref.ownerId));
          if (ownerIds.size > 1) {
            clearFeedback();
            return;
          }
          if (
            !canMoveLayerRootsBetweenOwners(store.layers, store.animation, store.selectedLayerIds)
          ) {
            clearFeedback();
            return;
          }
          const targetFrameId = hitArtboard(result.end);
          if (targetFrameId && targetFrameId !== store.selectedFrameId) {
            store.moveSelectedLayersToFrame(targetFrameId, { recordHistory: false });
          } else if (!targetFrameId && store.selectedFrameId !== PAGE_ROOT_ID) {
            store.moveSelectedLayersToRoot({ recordHistory: false });
          }
          clearFeedback();
        },
        rollback: () => {
          const state = useEditorStore.getState();
          const baseline = baselineRef.current;
          if (
            baseline?.historyEntry &&
            ownsLiveGesture(baseline.marker) &&
            state.selectedFrameId === baseline.ownerId &&
            state.history.at(-1) === baseline.historyEntry
          )
            state.cancelLastHistoryTransaction();
        },
        cancelled: clearFeedback,
      });
    },
    [clearFeedback, hitArtboard, resolveDragTotal, syncActiveOwner],
  );

  const updateDropPreview = useCallback(
    (point: { x: number; y: number }) => {
      if (!dragRef.current?.isMoved) {
        setDropPreview(null);
        return;
      }
      const ownerIds = new Set(
        useEditorStore.getState().selectedLayerRefs.map((ref) => ref.ownerId),
      );
      if (ownerIds.size !== 1) {
        setDropPreview(null);
        return;
      }
      const sourceOwnerId = ownerIds.values().next().value as string | undefined;
      const state = useEditorStore.getState();
      const targetFrameId = hitArtboard(point);
      if (!canMoveLayerRootsBetweenOwners(state.layers, state.animation, state.selectedLayerIds)) {
        const crossesOwner = targetFrameId
          ? targetFrameId !== sourceOwnerId
          : sourceOwnerId !== PAGE_ROOT_ID;
        setDropPreview(
          crossesOwner
            ? {
                ownerId: sourceOwnerId!,
                label: "Animated parent keeps this layer in its container",
                point,
              }
            : null,
        );
        return;
      }
      if (targetFrameId && targetFrameId !== sourceOwnerId) {
        const target = frames.find((frame) => frame.id === targetFrameId);
        setDropPreview({
          ownerId: targetFrameId,
          label: `Move into ${target?.name || "frame"}`,
          point,
        });
      } else if (!targetFrameId && sourceOwnerId !== PAGE_ROOT_ID) {
        setDropPreview({ ownerId: PAGE_ROOT_ID, label: "Move to page", point });
      } else {
        setDropPreview(null);
      }
    },
    [frames, hitArtboard],
  );

  const updateDrag = useCallback(
    (point: { x: number; y: number }, modifiers: ObjectDragModifiers) => {
      if (!dragRef.current) return false;
      const state = useEditorStore.getState();
      const baseline = baselineRef.current;
      if (
        !baseline ||
        !ownsLiveGesture(baseline.marker) ||
        state.selectedFrameId !== baseline.ownerId ||
        state.progress !== baseline.progress ||
        selectionKey(state) !== baseline.selectionKey ||
        (baseline.historyEntry && state.history.at(-1) !== baseline.historyEntry)
      ) {
        dragRef.current = null;
        baselineRef.current = null;
        endLiveGesture(baseline?.marker);
        clearFeedback();
        return false;
      }
      dragRef.current.update(point, modifiers);
      updateDropPreview(point);
      return true;
    },
    [clearFeedback, updateDropPreview],
  );

  const finishDrag = useCallback(
    (point: { x: number; y: number } | null, modifiers: ObjectDragModifiers) => {
      const drag = dragRef.current;
      const baseline = baselineRef.current;
      dragRef.current = null;
      if (!drag) return false;
      if (point) {
        // Reuse the update guard before consuming the final pointer position.
        dragRef.current = drag;
        if (updateDrag(point, modifiers)) drag.finish(point);
        dragRef.current = null;
      } else {
        drag.cancel();
      }
      baselineRef.current = null;
      endLiveGesture(baseline?.marker);
      clearFeedback();
      return true;
    },
    [clearFeedback, updateDrag],
  );

  const cancelDrag = useCallback(() => {
    const drag = dragRef.current;
    const baseline = baselineRef.current;
    dragRef.current = null;
    drag?.cancel();
    baselineRef.current = null;
    endLiveGesture(baseline?.marker);
    clearFeedback();
  }, [clearFeedback]);
  useEffect(() => cancelDrag, [cancelDrag]);

  const clearPendingDrag = useCallback(() => {
    endLiveGesture(baselineRef.current?.marker);
    dragRef.current = null;
    baselineRef.current = null;
  }, []);

  const hasDrag = useCallback(() => Boolean(dragRef.current), []);

  const isDragging = Boolean(dragRef.current?.isMoved);
  const draggedDraws = useMemo(() => {
    if (!isDragging) return [];
    return sceneOwners.flatMap((owner) => {
      const ownerAnimation =
        owner.ownerId === selectedFrameId
          ? animation
          : owner.ownerId === PAGE_ROOT_ID
            ? rootAnimation
            : frames.find((frame) => frame.id === owner.ownerId)?.animation;
      if (!ownerAnimation) return [];
      const ids = selectedWorldSubtreeIds(
        owner.layers,
        selectedLayerRefs.filter((ref) => ref.ownerId === owner.ownerId).map((ref) => ref.layerId),
      );
      const draws = resolveWorldLayerDraws(owner.layers, ownerAnimation, progress, true);
      const clips = new Set(
        draws
          .filter((draw) => ids.has(String(draw.id)))
          .flatMap((draw) => draw.clipNodeIds.map(String)),
      );
      const state = useEditorStore.getState();
      const vector =
        owner.ownerId === PAGE_ROOT_ID
          ? vectorFromPageMetadata(state.document.page, PAGE_ROOT_ID)
          : owner.ownerId === state.selectedFrameId
            ? state.vector
            : frames.find((frame) => frame.id === owner.ownerId)?.vector;
      return draws
        .filter(
          (draw) => ids.has(String(draw.id)) || (draw.isClipPath && clips.has(String(draw.id))),
        )
        .map((draw) => ({ ...draw, ownerId: owner.ownerId, origin: owner.origin, vector }));
    });
  }, [
    animation,
    frames,
    isDragging,
    progress,
    rootAnimation,
    sceneOwners,
    selectedFrameId,
    selectedLayerRefs,
  ]);

  return {
    smartGuides,
    dropPreview,
    isDragging,
    isDragPending: Boolean(dragRef.current),
    hasDrag,
    draggedDraws,
    hitArtboard,
    hitLayerAtWorld,
    selectOwnedLayer,
    startDrag,
    updateDrag,
    finishDrag,
    cancelDrag,
    clearPendingDrag,
    clearFeedback,
  };
}
