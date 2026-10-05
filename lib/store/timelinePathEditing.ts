import { pathToString } from "../shapeshifter/pathUtils";
import { linkedTimelineKeyframe } from "../shapeshifter/motion/timelineKeyframes";
import type { Layer, TimelineBlock } from "../shapeshifter/types";
import type { EditorState } from "./editorStore";
import { blocksFor } from "../shapeshifter/playheadResolve";

export function timelinePathSelection(
  state: EditorState,
  layerId: string | number | undefined,
): string[] {
  return state.isActionMode &&
    state.selectedBlockIds.length === 1 &&
    state.animation.blocks.some(
      (block) =>
        block.id === state.selectedBlockIds[0] &&
        block.propertyName === "pathData" &&
        String(block.layerId) === String(layerId),
    )
    ? state.selectedBlockIds
    : [];
}

function findLayer(layers: Layer[], id: string | number): Layer | undefined {
  for (const layer of layers) {
    if (String(layer.id) === String(id)) return layer;
    const child = layer.children && findLayer(layer.children, id);
    if (child) return child;
  }
}

/** Synchronize edited geometry with an explicit segment or the outer path keyframes. */
export function syncLayerPathEndpoints(
  before: Layer,
  after: Layer,
  blocks: TimelineBlock[],
  selectedBlockId?: string,
  editedSide?: "from" | "to",
): TimelineBlock[] {
  if (after.locked || String(before.id) !== String(after.id)) return blocks;
  const tracks = blocksFor(blocks, after.id, "pathData");
  if (!tracks.length) return blocks;
  const explicit =
    selectedBlockId === undefined
      ? undefined
      : tracks.find((block) => block.id === selectedBlockId);
  if (selectedBlockId !== undefined && !explicit) return blocks;
  const first = explicit ?? tracks[0]!;
  const last = explicit ?? tracks.at(-1)!;
  const fromChanged =
    before.from !== after.from && pathToString(before.from) !== pathToString(after.from);
  const pathChanged =
    before.pathData !== after.pathData &&
    after.pathData &&
    pathToString(before.pathData ?? before.from) !== pathToString(after.pathData);
  const from =
    editedSide === "to"
      ? undefined
      : editedSide === "from" || fromChanged
        ? after.from
        : pathChanged
          ? after.pathData
          : before.from !== after.from
            ? after.from
            : before.pathData !== after.pathData
              ? after.pathData
              : undefined;
  const to =
    editedSide === "from"
      ? undefined
      : editedSide === "to" || before.to !== after.to
        ? after.to
        : undefined;
  const changes = new Map<string, Partial<TimelineBlock>>();
  for (const [path, block, edge, valueKey] of [
    [from, first, "start", "fromValue"],
    [to, last, "end", "toValue"],
  ] as const) {
    if (!path) continue;
    const value = pathToString(path);
    if (value === block[valueKey]) continue;
    changes.set(block.id, { ...changes.get(block.id), [valueKey]: value });
    const adjacent = explicit && linkedTimelineKeyframe(blocks, block, edge);
    if (adjacent)
      changes.set(adjacent.id, {
        ...changes.get(adjacent.id),
        [edge === "start" ? "toValue" : "fromValue"]: value,
      });
  }
  if (!changes.size) return blocks;
  return blocks.map((block) =>
    changes.has(block.id) ? { ...block, ...changes.get(block.id) } : block,
  );
}

/** Selected morph edits own their segment; world geometry edits own the outer keyframes. */
export function syncEditedTimelinePath(
  state: EditorState,
  patch: Partial<EditorState>,
): Partial<EditorState> {
  // Changing the selected track ends its morph editing context. The dedicated
  // entry action explicitly seeds the next segment before enabling it again.
  if (
    state.isActionMode &&
    patch.selectedBlockIds &&
    patch.selectedBlockIds.join() !== state.selectedBlockIds.join() &&
    patch.isActionMode === undefined &&
    state.animation.blocks.some(
      (block) => block.id === state.selectedBlockIds[0] && block.propertyName === "pathData",
    )
  ) {
    patch = { ...patch, isActionMode: false };
  }
  if (
    !patch.layers ||
    "animation" in patch ||
    "document" in patch ||
    (state.isActionMode && (patch.isActionMode === false || state.selectedBlockIds.length !== 1)) ||
    state.selectedLayerIds.length !== 1 ||
    state.selectedLayerRefs.length > 1 ||
    (patch.selectedLayerId !== undefined &&
      String(patch.selectedLayerId) !== String(state.selectedLayerId)) ||
    (patch.selectedFrameId !== undefined && patch.selectedFrameId !== state.selectedFrameId) ||
    (state.isActionMode &&
      patch.selectedBlockIds &&
      patch.selectedBlockIds.join() !== state.selectedBlockIds.join())
  )
    return patch;
  const before = findLayer(state.layers, state.selectedLayerId);
  const after = findLayer(patch.layers, state.selectedLayerId);
  if (!before || !after || after.locked) return patch;
  const blocks = syncLayerPathEndpoints(
    before,
    after,
    state.animation.blocks,
    state.isActionMode ? state.selectedBlockIds[0] : undefined,
  );
  if (blocks === state.animation.blocks) return patch;
  return {
    ...patch,
    animation: { ...state.animation, blocks },
  };
}
