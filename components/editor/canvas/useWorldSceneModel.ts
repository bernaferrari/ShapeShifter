"use client";

import { useMemo } from "react";
import { PAGE_ROOT_ID, type CanvasFrame, type LayerSelectionRef } from "@/lib/store/editorStore";
import { unionOwnedLayerBounds, type SceneOwner } from "@/lib/shapeshifter/scene/selection";
import type { Layer, PathData } from "@/lib/shapeshifter/types";

interface WorldSceneModelOptions {
  frames: CanvasFrame[];
  layers: Layer[];
  rootLayers: Layer[];
  selectedFrameId: string;
  selectedFrameIds: string[];
  selectedLayerId: string | number;
  selectedLayerIds: Array<string | number>;
  selectedLayerRefs: LayerSelectionRef[];
  selectionKind: "none" | "frame" | "layer";
  editingSide: "from" | "to";
  progress: number;
  animation: import("@/lib/shapeshifter/types").AnimationState;
  rootAnimation: import("@/lib/shapeshifter/types").AnimationState;
}

export function useWorldSceneModel({
  frames,
  layers,
  rootLayers,
  selectedFrameId,
  selectedFrameIds,
  selectedLayerId,
  selectedLayerIds,
  selectedLayerRefs,
  selectionKind,
  editingSide,
  progress,
  animation,
  rootAnimation,
}: WorldSceneModelOptions) {
  const editFrame = frames.find((frame) => frame.id === selectedFrameId);
  const editLayer = layers.find((layer) => String(layer.id) === String(selectedLayerId));
  const editPath: PathData | null =
    editLayer && editLayer.type !== "group" ? (editLayer[editingSide] as PathData) : null;
  const editOrigin = useMemo(
    () =>
      selectedFrameId === PAGE_ROOT_ID
        ? { x: 0, y: 0 }
        : editFrame
          ? { x: editFrame.x || 0, y: editFrame.y || 0 }
          : null,
    [editFrame, selectedFrameId],
  );
  const rulerOwnerIds = useMemo(() => {
    const candidates =
      selectionKind === "layer"
        ? selectedLayerRefs.map((reference) => reference.ownerId)
        : selectionKind === "frame"
          ? selectedFrameIds
          : [];
    return Array.from(new Set(candidates));
  }, [selectedFrameIds, selectedLayerRefs, selectionKind]);
  const rulerFrame =
    rulerOwnerIds.length === 1 && rulerOwnerIds[0] !== PAGE_ROOT_ID
      ? frames.find((frame) => frame.id === rulerOwnerIds[0])
      : undefined;
  const sceneOwners = useMemo<SceneOwner[]>(
    () => [
      {
        ownerId: PAGE_ROOT_ID,
        origin: { x: 0, y: 0 },
        layers: selectedFrameId === PAGE_ROOT_ID ? layers : rootLayers,
        animation: selectedFrameId === PAGE_ROOT_ID ? animation : rootAnimation,
        progress,
        usePlayhead: true,
      },
      ...frames.map((frame) => ({
        ownerId: frame.id,
        origin: { x: frame.x || 0, y: frame.y || 0 },
        layers: frame.id === selectedFrameId ? layers : (frame.layers ?? []),
        animation: frame.id === selectedFrameId ? animation : frame.animation,
        progress,
        usePlayhead: true,
      })),
    ],
    [animation, frames, layers, progress, rootAnimation, rootLayers, selectedFrameId],
  );
  const selectedLayerRefKeys = useMemo(
    () =>
      new Set(
        selectedLayerRefs.map((reference) => `${reference.ownerId}:${String(reference.layerId)}`),
      ),
    [selectedLayerRefs],
  );
  const selectedLayerOwnerCount = useMemo(
    () => new Set(selectedLayerRefs.map((reference) => reference.ownerId)).size,
    [selectedLayerRefs],
  );
  // Evaluating every owner's full Android scene (flatten + matrix transforms) is only
  // meaningful when something is selected; with an empty selection this memo used to
  // redo all of that work on each progress tick just to return null.
  const hasLayerSelection = selectionKind === "layer" && selectedLayerRefs.length > 0;
  const documentSelectionBounds = useMemo(
    () =>
      hasLayerSelection
        ? unionOwnedLayerBounds(
            sceneOwners.filter((owner) =>
              selectedLayerRefs.some((ref) => ref.ownerId === owner.ownerId),
            ),
            selectedLayerRefs,
          )
        : null,
    [hasLayerSelection, sceneOwners, selectedLayerRefs],
  );
  const activeSelectedLayerIds = useMemo(
    () =>
      selectedLayerIds.length > 0
        ? selectedLayerIds
        : selectedLayerId != null
          ? [selectedLayerId]
          : [],
    [selectedLayerId, selectedLayerIds],
  );

  return {
    editFrame,
    editLayer,
    editPath,
    editOrigin,
    editLayerTranslation: {
      x: Number(editLayer?.translateX) || 0,
      y: Number(editLayer?.translateY) || 0,
    },
    currentFillColor: editLayer?.fillColor || "#111111",
    rulerFrame,
    sceneOwners,
    selectedLayerRefKeys,
    selectedLayerOwnerCount,
    documentSelectionBounds,
    activeSelectedLayerIds,
  };
}
