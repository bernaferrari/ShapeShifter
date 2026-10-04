import { computeDetailViewport } from "../../shapeshifter/camera";
import { generateId } from "../../shapeshifter/ids";
import { parsePath, pathToString } from "../../shapeshifter/pathUtils";
import type { Layer, LayerType, TimelineBlock } from "../../shapeshifter/types";
import { createPathLayer } from "../defaultWorkspace";
import type { EditorState } from "../editorStore";
import { collectLayerSubtreeIds } from "../../shapeshifter/scene/layerHierarchy";
import { PAGE_ROOT_ID } from "../../shapeshifter/scene/owners";
import { saveActiveFrame, updateOwnedLayers } from "../workspaceState";
import { commitDocumentV2 } from "../documentRuntime";
import {
  insertTimelineKeyframe,
  linkedTimelineKeyframe,
  timelineKeyframeRange,
} from "../../shapeshifter/motion/timelineKeyframes";
import { retimeTimelineBlocks } from "../../shapeshifter/motion/timelineRetiming";
import { createLayerTreeModel } from "../../shapeshifter/scene/layerHierarchy";
import { planTimelinePaste } from "../../shapeshifter/motion/timelineClipboard";
import { resolveTimelinePreviewRange } from "../../shapeshifter/motion/previewRange";
import { mapLayerTimelines } from "../timelineLayerMapping";
import { isTimelineNumberValid } from "../../shapeshifter/motion/timelineProperties";

type DocumentActionKey =
  | "addLayer"
  | "deleteLayer"
  | "toggleLayerVisibility"
  | "toggleOwnedLayerVisibility"
  | "toggleLayerExpanded"
  | "convertLayerType"
  | "addTimelineBlock"
  | "updateTimelineBlock"
  | "insertTimelineKeyframe"
  | "updateTimelineKeyframe"
  | "moveTimelineBlock"
  | "moveTimelineBlocks"
  | "startTimelinePathEditing"
  | "beginTimelineMorphEditing"
  | "copyTimelineBlocks"
  | "pasteTimelineBlocks"
  | "setTimelinePreviewRange"
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

function canEditTimelineTargets(state: EditorState, blocks: TimelineBlock[]) {
  const tree = createLayerTreeModel(state.layers);
  return blocks.every((block) => {
    const layer = tree.allLayers.find((item) => String(item.id) === String(block.layerId));
    return layer && !layer.locked && !tree.ancestorsOf(layer.id).some((parent) => parent.locked);
  });
}
/**
 * Typed base value for a timeline track. Imported SVG/AVD layers may omit
 * transform fields entirely, so numeric tracks must fall back to their Android
 * semantics defaults instead of an empty string (which would mint a bogus
 * color-typed block).
 */
function timelineBaseValue(layer: Layer, propertyName: string): number | string {
  const raw = layer[propertyName as keyof Layer];
  const numeric = typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
  switch (propertyName) {
    case "translateX":
    case "translateY":
    case "rotation":
    case "pivotX":
    case "pivotY":
    case "strokeWidth":
      return numeric ?? 0;
    case "scaleX":
    case "scaleY":
      return numeric ?? 1;
    case "alpha":
    case "fillAlpha":
    case "strokeAlpha":
      return numeric ?? 1;
    case "trimPathStart":
    case "trimPathOffset":
      return numeric ?? 0;
    case "trimPathEnd":
      return numeric ?? 1;
    case "fillColor":
    case "strokeColor":
      return typeof raw === "string" && raw && raw !== "none" ? raw : "#00000000";
    default:
      return typeof raw === "string" ? raw : "";
  }
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
      const removed = collectLayerSubtreeIds(state.layers, id);
      if (removed.size >= state.layers.length) return;
      const layers = state.layers.filter((layer) => !removed.has(String(layer.id)));
      const animationBlocks = state.animation.blocks.filter(
        (block) => !removed.has(String(block.layerId)),
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
      const owned = updateOwnedLayers(state, ownerId, (layers) =>
        layers.map((layer) =>
          String(layer.id) === String(id) ? { ...layer, visible: layer.visible === false } : layer,
        ),
      );
      const ownerLayers =
        ownerId === PAGE_ROOT_ID
          ? owned.rootLayers
          : (owned.frames.find((frame) => frame.id === ownerId)?.layers ?? owned.layers);
      const nextVisible =
        ownerLayers.find((layer) => String(layer.id) === String(id))?.visible !== false;
      const idStr = String(id);
      const syncHidden = (ids: string[]) =>
        nextVisible
          ? ids.filter((hidden) => hidden !== idStr)
          : ids.includes(idStr)
            ? ids
            : [...ids, idStr];
      set({
        ...owned,
        hiddenLayerIds:
          ownerId === state.selectedFrameId
            ? syncHidden(state.hiddenLayerIds)
            : state.hiddenLayerIds,
        frames: owned.frames.map((frame) =>
          frame.id === ownerId
            ? { ...frame, hiddenLayerIds: syncHidden(frame.hiddenLayerIds) }
            : frame,
        ),
        rootHiddenLayerIds:
          ownerId === PAGE_ROOT_ID
            ? syncHidden(state.rootHiddenLayerIds)
            : state.rootHiddenLayerIds,
      });
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
      if (!layer || layer.locked) return;
      const value =
        propertyName === "pathData"
          ? pathToString(layer.pathData ?? layer.from)
          : timelineBaseValue(layer, propertyName);
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
        toValue: propertyName === "pathData" && layer.to ? pathToString(layer.to) : value,
      };
      state.pushHistory();
      set({
        animation: { ...state.animation, blocks: [...state.animation.blocks, block] },
        layers: updateLayerById(state.layers, layerId, (candidateLayer) => ({
          ...candidateLayer,
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

    insertTimelineKeyframe: (blockId, time) => {
      const state = get();
      const block = state.animation.blocks.find((item) => item.id === blockId);
      if (!block) return false;
      const pair = insertTimelineKeyframe(block, time, generateId());
      if (!pair) return false;
      const replace = (blocks: typeof state.animation.blocks) =>
        blocks.flatMap((item) => (item.id === blockId ? pair : [item]));
      state.pushHistory();
      set({
        animation: { ...state.animation, blocks: replace(state.animation.blocks) },
        layers: mapLayerTimelines(state.layers, replace),
        selectedBlockIds: [pair[1].id],
      });
      return true;
    },

    startTimelinePathEditing: (blockId) => {
      const state = get();
      const block = state.animation.blocks.find(
        (item) => item.id === blockId && item.propertyName === "pathData",
      );
      const layer = block && state.layers.find((item) => String(item.id) === String(block.layerId));
      if (!block || !layer || layer.locked) return;
      const from = parsePath(String(block.fromValue));
      const to = parsePath(String(block.toValue));
      const needsGeometry =
        pathToString(layer.from) !== pathToString(from) ||
        pathToString(layer.to ?? layer.from) !== pathToString(to);
      if (needsGeometry) state.pushHistory();
      set({
        layers: needsGeometry
          ? updateLayerById(state.layers, block.layerId, (item) => ({
              ...item,
              from,
              to,
              pathData: from,
            }))
          : state.layers,
        // Seeding the editing geometry must not feed back into another selected track.
        animation: state.animation,
        selectedLayerId: block.layerId,
        selectedLayerIds: [block.layerId],
        selectedLayerRefs: [{ ownerId: state.selectedFrameId, layerId: block.layerId }],
        selectedBlockIds: [block.id],
        isActionMode: true,
        editingSide: "from",
        hasCanvasSelection: true,
        selectionKind: "layer",
        selection: null,
        selectedPoints: [],
        selectedSubPaths: [],
        toolMode: "direct",
        isPlaying: false,
        timelineCollapsed: false,
      });
    },

    beginTimelineMorphEditing: () => {
      const state = get();
      if (state.selectedLayerIds.length !== 1 || state.selectedLayerRefs.length > 1) return false;
      const layer = state.layers.find((item) => String(item.id) === String(state.selectedLayerId));
      if (!layer || layer.locked || (layer.type !== "path" && layer.type !== "clipPath"))
        return false;
      const tracks = state.animation.blocks
        .filter(
          (block) =>
            String(block.layerId) === String(layer.id) && block.propertyName === "pathData",
        )
        .sort((a, b) => a.startTime - b.startTime);
      if (tracks.length) {
        const time = state.progress * state.animation.duration;
        const selected = tracks.find((block) => state.selectedBlockIds.includes(block.id));
        const atPlayhead = tracks.find((block) => block.startTime <= time && time < block.endTime);
        const nearest = tracks.reduce((closest, block) => {
          const distance = Math.max(block.startTime - time, time - block.endTime, 0);
          const closestDistance = Math.max(closest.startTime - time, time - closest.endTime, 0);
          return distance < closestDistance ? block : closest;
        });
        get().startTimelinePathEditing((selected ?? atPlayhead ?? nearest).id);
        return true;
      }

      const from = layer.from;
      const to = layer.to ?? from;
      const block = {
        id: generateId(),
        layerId: layer.id,
        propertyName: "pathData",
        type: "path" as const,
        fromValue: pathToString(from),
        toValue: pathToString(to),
        startTime: 0,
        endTime: state.animation.duration,
        // Preserve the linear legacy from/to preview when making it explicit.
        interpolator: layer.to ? "LINEAR" : "FAST_OUT_SLOW_IN",
      };
      state.pushHistory();
      set({
        animation: { ...state.animation, blocks: [...state.animation.blocks, block] },
        layers: updateLayerById(state.layers, layer.id, (item) => ({
          ...item,
          from,
          to,
          pathData: from,
          expanded: true,
          ...(item.timeline && { timeline: [...item.timeline, block] }),
        })),
        selectedBlockIds: [block.id],
        isActionMode: true,
        editingSide: "from",
        selection: null,
        selectedPoints: [],
        selectedSubPaths: [],
        toolMode: "direct",
        isPlaying: false,
        timelineCollapsed: false,
        hasCanvasSelection: true,
        selectionKind: "layer",
      });
      return true;
    },

    copyTimelineBlocks: (blockIds) => {
      const state = get();
      const ids = new Set(blockIds ?? state.selectedBlockIds);
      const blocks = state.animation.blocks.filter((block) => ids.has(block.id));
      if (!blocks.length || new Set(blocks.map((block) => String(block.layerId))).size !== 1)
        return false;
      set({ timelineClipboard: { blocks: structuredClone(blocks) } });
      return true;
    },

    setTimelinePreviewRange: (range) => {
      const state = get();
      const resolved =
        range &&
        resolveTimelinePreviewRange(
          { ...range, ownerId: state.selectedFrameId },
          state.selectedFrameId,
          state.animation.duration,
        );
      set({
        timelinePreviewRange: resolved ? { ...resolved, ownerId: state.selectedFrameId } : null,
        ...(resolved && { isRepeating: true }),
      });
    },

    pasteTimelineBlocks: (layerId, time) => {
      const state = get();
      if (!state.timelineClipboard) return { ok: false, message: "Copy motion first." };
      if (layerId === undefined && state.selectedLayerIds.length !== 1)
        return { ok: false, message: "Select one target layer to paste motion." };
      const targetId = layerId ?? state.selectedLayerId;
      const layer = state.layers.find((item) => String(item.id) === String(targetId));
      if (!layer)
        return { ok: false, message: "Select a layer in the active artboard to paste motion." };
      const result = planTimelinePaste(
        state.timelineClipboard,
        layer,
        state.animation.blocks,
        time ?? state.progress * state.animation.duration,
        state.animation.duration,
        generateId,
      );
      if (!result.ok) return result;
      state.pushHistory();
      const blockIds = result.blocks.map((block) => block.id);
      set({
        animation: {
          ...state.animation,
          duration: result.duration,
          blocks: [...state.animation.blocks, ...result.blocks],
        },
        layers: updateLayerById(state.layers, layer.id, (item) => ({
          ...item,
          expanded: true,
          ...(item.timeline && { timeline: [...item.timeline, ...result.blocks] }),
        })),
        selectedLayerId: layer.id,
        selectedLayerIds: [layer.id],
        selectedLayerRefs: [{ ownerId: state.selectedFrameId, layerId: layer.id }],
        selectedBlockIds: blockIds,
        timelineCollapsed: false,
        isActionMode: false,
        isPlaying: false,
        progress: (time ?? state.progress * state.animation.duration) / result.duration,
      });
      return { ok: true, blockIds };
    },

    updateTimelineKeyframe: (blockId, edge, patch, options) => {
      const state = get();
      const target = state.animation.blocks.find((item) => item.id === blockId);
      if (!target || !canEditTimelineTargets(state, [target])) return;
      const adjacent = linkedTimelineKeyframe(state.animation.blocks, target, edge);
      const originalTime = edge === "start" ? target.startTime : target.endTime;
      const [min, max] = timelineKeyframeRange(
        state.animation.blocks,
        target,
        edge,
        state.animation.duration,
      );
      const time =
        patch.time === undefined ? originalTime : Math.max(min, Math.min(max, patch.time));
      if (
        !Number.isFinite(time) ||
        (typeof patch.value === "number" &&
          !isTimelineNumberValid(target.propertyName, patch.value))
      )
        return;
      const targetPatch =
        edge === "start"
          ? { startTime: time, ...(patch.value !== undefined && { fromValue: patch.value }) }
          : { endTime: time, ...(patch.value !== undefined && { toValue: patch.value }) };
      const adjacentPatch =
        edge === "start"
          ? { endTime: time, ...(patch.value !== undefined && { toValue: patch.value }) }
          : { startTime: time, ...(patch.value !== undefined && { fromValue: patch.value }) };
      const apply = (block: typeof target) =>
        block.id === blockId
          ? { ...block, ...targetPatch }
          : block.id === adjacent?.id
            ? { ...block, ...adjacentPatch }
            : block;
      if (
        time === originalTime &&
        (patch.value === undefined ||
          patch.value === (edge === "start" ? target.fromValue : target.toValue))
      )
        return;
      if (options?.recordHistory !== false) state.pushHistory();
      set({
        animation: { ...state.animation, blocks: state.animation.blocks.map(apply) },
        layers: mapLayerTimelines(state.layers, (blocks) => blocks.map(apply)),
      });
    },

    moveTimelineBlock: (blockId, offset, options) => {
      get().moveTimelineBlocks([blockId], offset, options);
    },

    moveTimelineBlocks: (blockIds, offset, options) => {
      const state = get();
      const blocks = retimeTimelineBlocks(
        state.animation.blocks,
        blockIds,
        offset,
        state.animation.duration,
      );
      if (blocks === state.animation.blocks) return;
      if (
        !canEditTimelineTargets(
          state,
          blocks.filter((block, index) => block !== state.animation.blocks[index]),
        )
      )
        return;
      const byId = new Map(
        blocks
          .filter((block, index) => block !== state.animation.blocks[index])
          .map((block) => [block.id, block]),
      );
      if (options?.recordHistory !== false) state.pushHistory();
      set({
        animation: { ...state.animation, blocks },
        layers: mapLayerTimelines(state.layers, (items) =>
          items.map((block) => byId.get(block.id) ?? block),
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
      if (!target || !canEditTimelineTargets(state, [target])) return;
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

    updateVector: (patch, options?) => {
      if (options?.recordHistory !== false) get().pushHistory();
      set((state) => {
        const vector = { ...state.vector, ...patch };
        const isPageRoot = state.selectedFrameId === PAGE_ROOT_ID;
        const { id: _vectorId, ...page } = vector;
        // Refit the detail camera only when the artboard's coordinate size
        // changes; metadata-only patches (rename, tint, ...) must not yank it.
        const sizeChanged =
          patch.width !== undefined ||
          patch.height !== undefined ||
          patch.viewportWidth !== undefined ||
          patch.viewportHeight !== undefined;
        return {
          vector,
          frames: isPageRoot
            ? state.frames
            : saveActiveFrame({ ...state, vector }).map((frame) =>
                frame.id === state.selectedFrameId
                  ? { ...frame, name: vector.name, vector }
                  : frame,
              ),
          // Page-owned vectors have no CanvasFrame to carry their metadata. Keep
          // the canonical page metadata current so a live flush, history snapshot,
          // or autosave cannot restore the previous VectorDrawable attributes.
          // Merge over a fresh commit of the flushed workspace rather than the
          // possibly-stale documentV2.page, so the write stays fresh in-task and
          // supersedes (rather than cancels) any pending coalesced rebuild.
          ...(isPageRoot
            ? {
                documentV2: {
                  ...commitDocumentV2({ ...state, vector }),
                  page,
                },
              }
            : {}),
          detailViewport: sizeChanged
            ? computeDetailViewport(vector, state.detailViewport.scale)
            : state.detailViewport,
        };
      });
    },

    setAnimationDuration: (milliseconds, options) => {
      if (
        !Number.isFinite(milliseconds) ||
        Math.max(100, milliseconds) === get().animation.duration
      )
        return;
      if (options?.recordHistory !== false) get().pushHistory();
      set((state) => {
        const duration = Math.max(100, milliseconds);
        const resizeBlock = (block: (typeof state.animation.blocks)[number]) => ({
          ...block,
          startTime: Math.min(block.startTime, duration - 1),
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
          timelinePreviewRange: state.timelinePreviewRange
            ? (() => {
                const range = resolveTimelinePreviewRange(
                  state.timelinePreviewRange,
                  state.selectedFrameId,
                  duration,
                );
                return range ? { ...range, ownerId: state.selectedFrameId } : null;
              })()
            : null,
          layers: mapLayerTimelines(state.layers, (blocks) => blocks.map(resizeBlock)),
        };
      });
    },
  };
}
