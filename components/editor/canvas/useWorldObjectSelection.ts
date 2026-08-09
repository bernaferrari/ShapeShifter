"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { getCanvasFrameBounds } from "./useWorldCamera";
import { snapValueToStep, type Rect } from "@/lib/shapeshifter/camera";
import {
  ObjectDragGesture,
  type ObjectDragModifiers,
} from "@/lib/shapeshifter/gestures/select/ObjectDragGesture";
import { hitTestOwnedLayers } from "@/lib/shapeshifter/scene/hitTest";
import { resolveWorldLayerDraws } from "@/lib/shapeshifter/scene/render";
import { getOwnedLayerBounds, type SceneOwner } from "@/lib/shapeshifter/scene/selection";
import { snapRectToGuides, type GuideLine } from "@/lib/shapeshifter/smartGuides";
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
          for (const item of getOwnedLayerBounds(owner)) {
            if (selectedLayerRefKeys.has(`${item.ownerId}:${String(item.layerId)}`)) continue;
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
      dragRef.current = new ObjectDragGesture(start, {
        beginTransaction: () => useEditorStore.getState().pushHistory(),
        cloneSelection: () =>
          useEditorStore.getState().duplicateSelectedLayersOffset(0, 0, {
            recordHistory: false,
          }),
        resolveTotalDelta: resolveDragTotal,
        applyDelta: (delta) => {
          useEditorStore
            .getState()
            .translateSelectedLayer(delta.x, delta.y, { recordHistory: false });
          syncActiveOwner();
        },
        commit: (result) => {
          const store = useEditorStore.getState();
          store.recordLayerTranslationAtPlayhead();
          syncActiveOwner({ includeAnimation: true });
          const ownerIds = new Set(store.selectedLayerRefs.map((ref) => ref.ownerId));
          if (ownerIds.size > 1) {
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
        rollback: () => useEditorStore.getState().cancelLastHistoryTransaction(),
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
      const targetFrameId = hitArtboard(point);
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
      dragRef.current.update(point, modifiers);
      updateDropPreview(point);
      return true;
    },
    [updateDropPreview],
  );

  const finishDrag = useCallback(
    (point: { x: number; y: number } | null, modifiers: ObjectDragModifiers) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag) return false;
      if (point) {
        drag.update(point, modifiers);
        drag.finish(point);
      } else {
        drag.cancel();
      }
      clearFeedback();
      return true;
    },
    [clearFeedback],
  );

  const cancelDrag = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    drag?.cancel();
    clearFeedback();
  }, [clearFeedback]);

  const clearPendingDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  const hasDrag = useCallback(() => Boolean(dragRef.current), []);

  const isDragging = Boolean(dragRef.current?.isMoved);
  const draggedDraws = useMemo(() => {
    if (!isDragging) return [];
    const keys = new Set(selectedLayerRefs.map((ref) => `${ref.ownerId}:${String(ref.layerId)}`));
    return sceneOwners.flatMap((owner) => {
      const ownerAnimation =
        owner.ownerId === selectedFrameId
          ? animation
          : owner.ownerId === PAGE_ROOT_ID
            ? rootAnimation
            : frames.find((frame) => frame.id === owner.ownerId)?.animation;
      if (!ownerAnimation) return [];
      return resolveWorldLayerDraws(owner.layers, ownerAnimation, progress, false)
        .filter((draw) => keys.has(`${owner.ownerId}:${String(draw.id)}`))
        .map((draw) => ({ ...draw, ownerId: owner.ownerId, origin: owner.origin }));
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
