import { KEYFRAME_TIME_EPSILON, sameKeyframeTime } from "../shapeshifter/motion/timelineKeyframes";
import { androidPathMorphSignature, parsePath, pathToString } from "../shapeshifter/pathUtils";
import { blocksFor } from "../shapeshifter/playheadResolve";
import type { Layer, PathData, TimelineBlock } from "../shapeshifter/types";
import type { ToolMode } from "../shapeshifter/toolModes";
import type { EditorState } from "./editorStore";

/**
 * "You always edit the shape at the playhead."
 *
 * Point tools edit the path keyframe under the playhead. The layer's editable
 * `from`/`to` pair is seeded from that keyframe's segment, and edits flow back
 * through the explicit-segment sync used for morph editing. Leaving the keyframe
 * restores the layer's base pair (first and last keyframes) so static exports and
 * the document never keep a mid-animation shape as their base artwork.
 */

/** Keyframe times within this distance of the playhead count as "on" the keyframe. */
export const PLAYHEAD_KEYFRAME_EPSILON = KEYFRAME_TIME_EPSILON;

const POINT_TOOLS = new Set<ToolMode>(["direct", "pen", "knife", "pencil"]);

export function isPathPointTool(toolMode: ToolMode) {
  return POINT_TOOLS.has(toolMode);
}

export function pathTracksFor(blocks: TimelineBlock[], layerId: string | number) {
  return [...blocksFor(blocks, layerId, "pathData")].sort((a, b) => a.startTime - b.startTime);
}

export interface PlayheadPathTarget {
  block: TimelineBlock;
  side: "from" | "to";
}

/** The path keyframe exactly under the playhead, preferring the segment that starts there. */
export function pathKeyframeAtTime(
  tracks: TimelineBlock[],
  time: number,
): PlayheadPathTarget | null {
  const starting = tracks.find((block) => sameKeyframeTime(block.startTime, time));
  if (starting) return { block: starting, side: "from" };
  const ending = tracks.find((block) => sameKeyframeTime(block.endTime, time));
  return ending ? { block: ending, side: "to" } : null;
}

export function selectedPathLayer(state: EditorState): Layer | undefined {
  if (state.selectionKind !== "layer" || state.selectedLayerIds.length > 1) return undefined;
  if (state.selectedLayerRefs.length > 1) return undefined;
  const layer = state.layers.find((item) => String(item.id) === String(state.selectedLayerId));
  return layer && (layer.type === "path" || layer.type === "clipPath") ? layer : undefined;
}

/** Whether the editor should be editing a path keyframe right now. */
export function playheadPathEditingActive(state: EditorState, layer: Layer | undefined) {
  return Boolean(layer && !layer.locked && isPathPointTool(state.toolMode) && !state.isPlaying);
}

function replaceLayer(layers: Layer[], id: string | number, transform: (layer: Layer) => Layer) {
  return layers.map((layer): Layer => {
    const next = String(layer.id) === String(id) ? transform(layer) : layer;
    return next.children?.length
      ? { ...next, children: replaceLayer(next.children, id, transform) }
      : next;
  });
}

/** Restore a layer's editable pair to its outer keyframes (the base artwork). */
export function withBasePathGeometry(state: EditorState, layerId: string | number): Layer[] {
  const tracks = pathTracksFor(state.animation.blocks, layerId);
  if (!tracks.length) return state.layers;
  const from = parsePath(String(tracks[0]!.fromValue));
  const to = parsePath(String(tracks.at(-1)!.toValue));
  return replaceLayer(state.layers, layerId, (layer) =>
    pathToString(layer.from) === pathToString(from) &&
    pathToString(layer.to ?? layer.from) === pathToString(to)
      ? layer
      : { ...layer, from, to, pathData: from },
  );
}

/** Patch that seeds the editable pair from a keyframe's segment, or null when already seeded. */
export function seedPathKeyframe(
  state: EditorState,
  layer: Layer,
  target: PlayheadPathTarget,
): Partial<EditorState> | null {
  const { block, side } = target;
  const fromValue = String(block.fromValue);
  const toValue = String(block.toValue);
  const sameContext =
    state.isActionMode &&
    state.selectedBlockIds.length === 1 &&
    state.selectedBlockIds[0] === block.id &&
    state.editingSide === side;
  if (
    sameContext &&
    pathToString(layer.from) === fromValue &&
    pathToString(layer.to ?? layer.from) === toValue
  )
    return null;
  const from = parsePath(fromValue);
  const to = parsePath(toValue);
  const previous: PathData = layer[state.editingSide] ?? layer.from;
  const next = side === "from" ? from : to;
  // Point indices survive moving between compatible keyframes, so selection is kept.
  const keepSelection = androidPathMorphSignature(previous) === androidPathMorphSignature(next);
  return {
    layers: replaceLayer(state.layers, layer.id, (item) => ({ ...item, from, to, pathData: from })),
    // Seeding is not an edit: passing animation bypasses the endpoint sync.
    animation: state.animation,
    selectedBlockIds: [block.id],
    isActionMode: true,
    editingSide: side,
    ...(keepSelection ? {} : { selection: null, selectedPoints: [], selectedSubPaths: [] }),
  };
}
