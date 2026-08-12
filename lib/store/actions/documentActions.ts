import { computeDetailViewport } from "../../shapeshifter/camera";
import { generateId } from "../../shapeshifter/ids";
import { parsePath, pathToString } from "../../shapeshifter/pathUtils";
import type { Layer, LayerType } from "../../shapeshifter/types";
import { createPathLayer } from "../defaultWorkspace";
import type { EditorState } from "../editorStore";
import { saveActiveFrame, updateOwnedLayers } from "../workspaceState";

type DocumentActionKey =
  | "addLayer"
  | "deleteLayer"
  | "toggleLayerVisibility"
  | "toggleOwnedLayerVisibility"
  | "toggleLayerExpanded"
  | "convertLayerType"
  | "addTimelineBlock"
  | "updateTimelineBlock"
  | "removeTimelineBlocks"
  | "removeTimelineProperty"
  | "removeTimelineKeyframe"
  | "updateVector"
  | "setAnimationDuration";

type DocumentActions = Pick<EditorState, DocumentActionKey>;
type SetEditorState = (
  update: Partial<EditorState> | ((state: EditorState) => Partial<EditorState> | EditorState),
) => void;

function layerLabel(type: LayerType): string {
  if (type === "clipPath") return "Clip path";
  if (type === "group") return "Group layer";
  return "Path layer";
}

function mapLayerTimelines(
  layers: Layer[],
  transform: (blocks: NonNullable<Layer["timeline"]>) => NonNullable<Layer["timeline"]>,
): Layer[] {
  return layers.map((layer) => ({
    ...layer,
    ...(layer.timeline ? { timeline: transform(layer.timeline) } : {}),
    ...(layer.children?.length ? { children: mapLayerTimelines(layer.children, transform) } : {}),
  }));
}

function updateLayerById(
  layers: Layer[],
  layerId: string | number,
  transform: (layer: Layer) => Layer,
): Layer[] {
  return layers.map((layer) => {
    const candidate = String(layer.id) === String(layerId) ? transform(layer) : layer;
    return candidate.children?.length
      ? { ...candidate, children: updateLayerById(candidate.children, layerId, transform) }
      : candidate;
  });
}

function withoutTimelineBlocks(layers: Layer[], blockIds: Set<string>): Layer[] {
  return mapLayerTimelines(layers, (blocks) => blocks.filter((block) => !blockIds.has(block.id)));
}

function replaceTimelineBlocks(
  layers: Layer[],
  removedIds: Set<string>,
  replacement: NonNullable<Layer["timeline"]>[number] | null,
): Layer[] {
  return mapLayerTimelines(layers, (blocks) => {
    const firstRemovedIndex = blocks.findIndex((block) => removedIds.has(block.id));
    const remaining = blocks.filter((block) => !removedIds.has(block.id));
    if (!replacement || firstRemovedIndex < 0) return remaining;
    const insertionIndex = firstRemovedIndex;
    return [...remaining.slice(0, insertionIndex), replacement, ...remaining.slice(insertionIndex)];
  });
}

export function createDocumentActions(
  set: SetEditorState,
  get: () => EditorState,
): DocumentActions {
  return {
    addLayer: (type = "path") => {
      const state = get();
      const newLayer = createPathLayer({
        id: generateId(),
        name: `${layerLabel(type)} ${state.layers.length + 1}`,
        type,
        from: parsePath("M 10 10 L 30 10 L 30 30 L 10 30 Z"),
        visible: true,
        locked: false,
        fillColor: type === "path" ? "#000000" : "",
        strokeColor: type === "clipPath" ? "#000000" : "",
        strokeWidth: type === "clipPath" ? 1.5 : 0,
      });
      state.pushHistory();
      set({
        layers: [...state.layers, newLayer],
        selectedLayerId: newLayer.id,
        selectedLayerIds: [newLayer.id],
        selectedLayerRefs: [{ ownerId: state.selectedFrameId, layerId: newLayer.id }],
        hasCanvasSelection: true,
        selectionKind: "layer",
        selectedFrameIds: [],
        selection: null,
        selectedPoints: [],
        selectedSubPaths: [],
      });
    },

    deleteLayer: (id) => {
      const state = get();
      if (state.layers.length === 1) return;
      const layers = state.layers.filter((layer) => String(layer.id) !== String(id));
      const animationBlocks = state.animation.blocks.filter(
        (block) => String(block.layerId) !== String(id),
      );
      const selectedLayerId =
        state.selectedLayerId === id ? (layers[0]?.id ?? 0) : state.selectedLayerId;
      state.pushHistory();
      set({
        layers,
        animation: {
          ...state.animation,
          blocks: animationBlocks,
        },
        selectedBlockIds: state.selectedBlockIds.filter((blockId) =>
          animationBlocks.some((block) => block.id === blockId),
        ),
        selectedLayerId,
        selectedLayerIds: layers.length ? [selectedLayerId] : [],
        selectedLayerRefs: layers.length
          ? [{ ownerId: state.selectedFrameId, layerId: selectedLayerId }]
          : [],
        selection: null,
        selectedPoints: [],
        selectedSubPaths: [],
      });
    },

    toggleLayerVisibility: (id) => get().toggleOwnedLayerVisibility(get().selectedFrameId, id),

    toggleOwnedLayerVisibility: (ownerId, id) => {
      const state = get();
      state.pushHistory();
      set(
        updateOwnedLayers(state, ownerId, (layers) =>
          layers.map((layer) =>
            String(layer.id) === String(id)
              ? { ...layer, visible: layer.visible === false }
              : layer,
          ),
        ),
      );
    },

    toggleLayerExpanded: (id) =>
      set((state) => ({
        layers: state.layers.map((layer) =>
          layer.id === id ? { ...layer, expanded: layer.expanded === false } : layer,
        ),
      })),

    convertLayerType: (id, type) => {
      const state = get();
      state.pushHistory();
      set({
        layers: state.layers.map((layer) => (layer.id === id ? { ...layer, type } : layer)),
      });
    },

    addTimelineBlock: (layerId, propertyName) => {
      const state = get();
      const layer = state.layers.find((candidate) => candidate.id === layerId);
      if (!layer) return;
      const candidate = layer[propertyName as keyof Layer];
      const value =
        propertyName === "pathData"
          ? pathToString(layer.pathData ?? layer.from)
          : typeof candidate === "number" || typeof candidate === "string"
            ? candidate
            : "";
      const block = {
        id: generateId(),
        layerId,
        propertyName,
        startTime: 0,
        endTime: state.animation.duration,
        interpolator: "FAST_OUT_SLOW_IN",
        type:
          propertyName === "pathData"
            ? ("path" as const)
            : typeof value === "number"
              ? ("number" as const)
              : ("color" as const),
        fromValue: value,
        toValue: value,
      };
      state.pushHistory();
      set({
        animation: { ...state.animation, blocks: [...state.animation.blocks, block] },
        layers: updateLayerById(state.layers, layerId, (candidateLayer) => ({
          ...candidateLayer,
          timeline: [...(candidateLayer.timeline ?? []), block],
          expanded: true,
        })),
        selectedBlockIds: [block.id],
        timelineCollapsed: false,
      });
    },

    updateTimelineBlock: (blockId, patch, options) => {
      const state = get();
      if (!state.animation.blocks.some((block) => block.id === blockId)) return;
      if (options?.recordHistory !== false) state.pushHistory();
      set({
        animation: {
          ...state.animation,
          blocks: state.animation.blocks.map((block) =>
            block.id === blockId ? { ...block, ...patch } : block,
          ),
        },
        layers: mapLayerTimelines(state.layers, (blocks) =>
          blocks.map((block) => (block.id === blockId ? { ...block, ...patch } : block)),
        ),
      });
    },

    removeTimelineBlocks: (blockIds) => {
      const state = get();
      const ids = new Set(blockIds);
      if (!state.animation.blocks.some((block) => ids.has(block.id))) return;
      state.pushHistory();
      set({
        animation: {
          ...state.animation,
          blocks: state.animation.blocks.filter((block) => !ids.has(block.id)),
        },
        layers: withoutTimelineBlocks(state.layers, ids),
        selectedBlockIds: state.selectedBlockIds.filter((id) => !ids.has(id)),
      });
    },

    removeTimelineProperty: (layerId, propertyName) => {
      const state = get();
      const ids = state.animation.blocks
        .filter(
          (block) =>
            String(block.layerId) === String(layerId) && block.propertyName === propertyName,
        )
        .map((block) => block.id);
      if (ids.length) state.removeTimelineBlocks(ids);
    },

    removeTimelineKeyframe: (blockId, edge) => {
      const state = get();
      const target = state.animation.blocks.find((block) => block.id === blockId);
      if (!target) return;
      const time = edge === "start" ? target.startTime : target.endTime;
      const sameTrack = state.animation.blocks.filter(
        (block) =>
          String(block.layerId) === String(target.layerId) &&
          block.propertyName === target.propertyName,
      );
      const adjacent = sameTrack.find(
        (block) =>
          block.id !== target.id &&
          (edge === "start" ? block.endTime === time : block.startTime === time),
      );

      if (!adjacent) {
        state.removeTimelineBlocks([target.id]);
        return;
      }

      const left = edge === "start" ? adjacent : target;
      const right = edge === "start" ? target : adjacent;
      const merged = {
        ...left,
        endTime: right.endTime,
        toValue: right.toValue,
      };
      const removedIds = new Set([left.id, right.id]);
      const nextBlocks = state.animation.blocks
        .filter((block) => !removedIds.has(block.id))
        .concat(merged)
        .sort((a, b) => a.startTime - b.startTime);
      state.pushHistory();
      set({
        animation: { ...state.animation, blocks: nextBlocks },
        layers: replaceTimelineBlocks(state.layers, removedIds, merged),
        selectedBlockIds: [merged.id],
      });
    },

    updateVector: (patch) =>
      set((state) => {
        const vector = { ...state.vector, ...patch };
        return {
          vector,
          frames: saveActiveFrame({ ...state, vector }).map((frame) =>
            frame.id === state.selectedFrameId ? { ...frame, name: vector.name, vector } : frame,
          ),
          detailViewport: computeDetailViewport(vector, state.detailViewport.scale),
        };
      }),

    setAnimationDuration: (milliseconds, options) => {
      if (options?.recordHistory !== false) get().pushHistory();
      set((state) => {
        const duration = Math.max(100, milliseconds);
        const resizeBlock = (block: (typeof state.animation.blocks)[number]) => ({
          ...block,
          startTime: Math.min(block.startTime, duration - 50),
          endTime:
            block.endTime === state.animation.duration
              ? duration
              : Math.min(block.endTime, duration),
        });
        return {
          animation: {
            ...state.animation,
            duration,
            blocks: state.animation.blocks.map(resizeBlock),
          },
          layers: mapLayerTimelines(state.layers, (blocks) => blocks.map(resizeBlock)),
        };
      });
    },
  };
}
