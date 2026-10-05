import { toast } from "sonner";
import { structuralLockIssue } from "../commands/structuralLayers";
import { planLayerDeletion } from "../commands/deleteLayers";
import { computeDetailViewport } from "../../shapeshifter/camera";
import { generateId } from "../../shapeshifter/ids";
import { parsePath, pathToString } from "../../shapeshifter/pathUtils";
import type { Layer, LayerType, TimelineBlock } from "../../shapeshifter/types";
import { createPathLayer } from "../defaultWorkspace";
import type { EditorState } from "../editorStore";
import { PAGE_ROOT_ID } from "../../shapeshifter/scene/owners";
import { saveActiveFrame, updateOwnedLayers } from "../workspaceState";
import { buildDocumentFromEditor } from "../documentRuntime";
import {
  insertTimelineKeyframe,
  linkedTimelineKeyframe,
  setTrackValueAt,
  timelineKeyframeRange,
} from "../../shapeshifter/motion/timelineKeyframes";
import { retimeTimelineBlocks } from "../../shapeshifter/motion/timelineRetiming";
import { createLayerTreeModel } from "../../shapeshifter/scene/layerHierarchy";
import { planTimelinePaste } from "../../shapeshifter/motion/timelineClipboard";
import { resolveTimelinePreviewRange } from "../../shapeshifter/motion/previewRange";
import {
  timelinePropertiesForLayer,
  isTimelineNumberValid,
} from "../../shapeshifter/motion/timelineProperties";
import {
  pathKeyframeAtTime,
  pathTracksFor,
  playheadPathEditingActive,
  seedPathKeyframe,
  selectedPathLayer,
  withBasePathGeometry,
} from "../playheadPathEditing";

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
  | "syncPathEditingWithPlayhead"
  | "ensurePathKeyframeAtPlayhead"
  | "setPropertiesAtPlayhead"
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
      const result = planLayerDeletion(state, [{ ownerId: state.selectedFrameId, layerId: id }]);
      if (!result.ok) {
        toast.error("Cannot delete layer", { description: result.message });
        return;
      }
      state.pushHistory();
      set(result.patch);
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
      if (
        !layer ||
        structuralLockIssue(state.layers, [layerId], false) ||
        !timelinePropertiesForLayer(layer.type).includes(propertyName as never) ||
        state.animation.blocks.some(
          (block) =>
            String(block.layerId) === String(layerId) && block.propertyName === propertyName,
        )
      )
        return;
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
      const target = state.animation.blocks.find((block) => block.id === blockId);
      if (!target || !canEditTimelineTargets(state, [target])) return;
      if (options?.recordHistory !== false) state.pushHistory();
      set({
        animation: {
          ...state.animation,
          blocks: state.animation.blocks.map((block) =>
            block.id === blockId ? { ...block, ...patch } : block,
          ),
        },
      });
    },

    insertTimelineKeyframe: (blockId, time) => {
      const state = get();
      const block = state.animation.blocks.find((item) => item.id === blockId);
      if (!block || !canEditTimelineTargets(state, [block])) return false;
      const pair = insertTimelineKeyframe(block, time, generateId());
      if (!pair) return false;
      const replace = (blocks: typeof state.animation.blocks) =>
        blocks.flatMap((item) => (item.id === blockId ? pair : [item]));
      state.pushHistory();
      set({
        animation: { ...state.animation, blocks: replace(state.animation.blocks) },
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
        // The edited shape is always the shape at the playhead.
        progress: Math.max(0, Math.min(1, block.startTime / Math.max(1, state.animation.duration))),
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
        // Preserve the linear workspace from/to preview when making it explicit.
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
        })),
        selectedBlockIds: [block.id],
        isActionMode: true,
        editingSide: "from",
        selection: null,
        selectedPoints: [],
        selectedSubPaths: [],
        toolMode: "direct",
        isPlaying: false,
        progress: 0,
        timelineCollapsed: false,
        hasCanvasSelection: true,
        selectionKind: "layer",
      });
      return true;
    },

    syncPathEditingWithPlayhead: () => {
      const state = get();
      const layer = selectedPathLayer(state);
      const tracks =
        layer && playheadPathEditingActive(state, layer)
          ? pathTracksFor(state.animation.blocks, layer.id)
          : [];
      const target = layer
        ? pathKeyframeAtTime(tracks, state.progress * state.animation.duration)
        : null;
      if (layer && target) {
        const patch = seedPathKeyframe(state, layer, target);
        if (patch) set(patch);
        return;
      }
      if (!state.isActionMode) return;
      // Off a keyframe (or out of point editing): the base artwork owns the layer again.
      set({
        isActionMode: false,
        editingSide: "from",
        layers: withBasePathGeometry(state, state.selectedLayerId),
        animation: state.animation,
      });
    },

    ensurePathKeyframeAtPlayhead: () => {
      const state = get();
      const layer = selectedPathLayer(state);
      if (!layer || !playheadPathEditingActive(state, layer)) return false;
      const tracks = pathTracksFor(state.animation.blocks, layer.id);
      if (!tracks.length) return false;
      const time = state.progress * state.animation.duration;
      if (pathKeyframeAtTime(tracks, time)) {
        get().syncPathEditingWithPlayhead();
        return true;
      }
      const cover = tracks.find((block) => time > block.startTime && time < block.endTime);
      if (cover) {
        if (!get().insertTimelineKeyframe(cover.id, time)) return false;
      } else {
        const first = tracks[0]!;
        const last = tracks.at(-1)!;
        const after = time > last.endTime;
        const value = after ? last.toValue : first.fromValue;
        const block: TimelineBlock = {
          ...(after ? last : first),
          id: generateId(),
          fromValue: value,
          toValue: value,
          startTime: after ? last.endTime : time,
          endTime: after ? time : first.startTime,
        };
        state.pushHistory();
        set({
          animation: { ...state.animation, blocks: [...state.animation.blocks, block] },
          layers: updateLayerById(state.layers, layer.id, (item) => ({
            ...item,
          })),
          selectedBlockIds: [block.id],
        });
      }
      get().syncPathEditingWithPlayhead();
      return get().isActionMode;
    },

    setPropertiesAtPlayhead: (layerId, values, options) => {
      const state = get();
      if (structuralLockIssue(state.layers, [layerId], false)) return {};
      const time = state.progress * state.animation.duration;
      const unanimated: Record<string, TimelineBlock["fromValue"]> = {};
      let blocks = state.animation.blocks;
      const layers = state.layers;
      for (const [propertyName, value] of Object.entries(values)) {
        const id = generateId();
        const apply = (list: TimelineBlock[]) =>
          setTrackValueAt(list, layerId, propertyName, time, value, id);
        const next = apply(blocks);
        if (!next) {
          unanimated[propertyName] = value;
          continue;
        }
        blocks = next;
      }
      if (blocks !== state.animation.blocks) {
        if (options?.recordHistory !== false) state.pushHistory();
        set({ animation: { ...state.animation, blocks }, layers });
      }
      return unanimated;
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
        target.startTime === target.endTime
          ? {
              startTime: time,
              endTime: time,
              ...(patch.value !== undefined && { fromValue: patch.value, toValue: patch.value }),
            }
          : edge === "start"
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
      if (options?.recordHistory !== false) state.pushHistory();
      set({
        animation: { ...state.animation, blocks },
      });
    },

    removeTimelineBlocks: (blockIds) => {
      const state = get();
      const ids = new Set(blockIds);
      const targets = state.animation.blocks.filter((block) => ids.has(block.id));
      if (!targets.length || !canEditTimelineTargets(state, targets)) return;
      state.pushHistory();
      set({
        animation: {
          ...state.animation,
          blocks: state.animation.blocks.filter((block) => !ids.has(block.id)),
        },
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
      const sameTrack = state.animation.blocks.filter(
        (block) =>
          String(block.layerId) === String(target.layerId) &&
          block.propertyName === target.propertyName,
      );
      const adjacent = linkedTimelineKeyframe(state.animation.blocks, target, edge);

      if (!adjacent) {
        if (target.startTime === target.endTime && sameTrack.length === 1) {
          toast.info("Keep one pose while animation is enabled", {
            description: "Use Remove animation to stop animating this property.",
          });
          return;
        }
        const survivingTime = edge === "start" ? target.endTime : target.startTime;
        const survivingValue = edge === "start" ? target.toValue : target.fromValue;
        state.pushHistory();
        set({
          animation: {
            ...state.animation,
            blocks: state.animation.blocks.flatMap((block) => {
              if (block.id !== target.id) return [block];
              if (
                target.startTime === target.endTime ||
                sameTrack.some(
                  (other) =>
                    other.id !== target.id &&
                    (other.startTime === survivingTime || other.endTime === survivingTime),
                )
              )
                return [];
              return [
                {
                  ...target,
                  startTime: survivingTime,
                  endTime: survivingTime,
                  fromValue: survivingValue,
                  toValue: survivingValue,
                },
              ];
            }),
          },
          selectedBlockIds:
            sameTrack.length > 1
              ? state.selectedBlockIds.filter((id) => id !== target.id)
              : [target.id],
        });
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
          // Commit page metadata and the editor's graph in the same transaction.
          ...(isPageRoot
            ? {
                document: {
                  ...buildDocumentFromEditor({ ...state, vector }),
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
        };
      });
    },
  };
}
