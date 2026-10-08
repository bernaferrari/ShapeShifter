import { parseEditorColor } from "../playheadResolve";
import { validatePathData } from "../path/pathValidation";
import type { Layer, TimelineBlock } from "../types";

export interface TimelineClipboard {
  blocks: TimelineBlock[];
}
export type TimelinePasteResult = { ok: true; blockIds: string[] } | { ok: false; message: string };
const transforms = new Set([
  "translateX",
  "translateY",
  "rotation",
  "pivotX",
  "pivotY",
  "scaleX",
  "scaleY",
  "alpha",
]);
const pathNumbers = new Set([
  "strokeWidth",
  "fillAlpha",
  "strokeAlpha",
  "trimPathStart",
  "trimPathEnd",
  "trimPathOffset",
]);
const colors = new Set(["fillColor", "strokeColor"]);
const overlaps = (a: TimelineBlock, b: TimelineBlock) =>
  a.propertyName === b.propertyName &&
  a.startTime < b.endTime - 1e-7 &&
  a.endTime > b.startTime + 1e-7;

/** Prepare a paste completely before changing the document or recording history. */
export function planTimelinePaste(
  clipboard: TimelineClipboard,
  layer: Layer,
  existing: TimelineBlock[],
  time: number,
  duration: number,
  id: () => string,
): { ok: true; blocks: TimelineBlock[]; duration: number } | { ok: false; message: string } {
  if (layer.locked) return { ok: false, message: "Unlock the target layer to paste motion." };
  if (!clipboard.blocks.length || !Number.isFinite(time) || time < 0)
    return { ok: false, message: "Copy motion and choose a valid playhead time first." };
  const firstTime = Math.min(...clipboard.blocks.map((block) => block.startTime));
  const blocks: TimelineBlock[] = [];
  for (const source of clipboard.blocks) {
    const property = source.propertyName;
    const type = property === "pathData" ? "path" : colors.has(property) ? "color" : "number";
    const supported =
      layer.type === "group"
        ? transforms.has(property)
        : layer.type === "clipPath"
          ? property === "pathData"
          : property === "pathData" ||
            colors.has(property) ||
            transforms.has(property) ||
            pathNumbers.has(property);
    if (!supported || (source.type && source.type !== type))
      return {
        ok: false,
        message: `The ${property} motion is incompatible with this ${layer.type} layer.`,
      };
    const valid = [source.fromValue, source.toValue].every((value) =>
      type === "path"
        ? validatePathData(value) === null
        : type === "color"
          ? typeof value === "string" && parseEditorColor(value) !== null
          : (typeof value === "number" || (typeof value === "string" && value.trim() !== "")) &&
            Number.isFinite(Number(value)),
    );
    if (
      !valid ||
      !Number.isFinite(source.startTime) ||
      source.startTime < 0 ||
      !Number.isFinite(source.endTime) ||
      source.endTime - source.startTime < 1
    )
      return { ok: false, message: `The copied ${property} segment has invalid values or timing.` };
    blocks.push({
      ...source,
      id: id(),
      layerId: layer.id,
      type,
      startTime: time + source.startTime - firstTime,
      endTime: time + source.endTime - firstTime,
    });
  }
  const targetTracks = existing.filter((block) => String(block.layerId) === String(layer.id));
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]!;
    if (
      !Number.isFinite(block.startTime) ||
      !Number.isFinite(block.endTime) ||
      block.endTime - block.startTime < 1
    )
      return {
        ok: false,
        message: "Choose a finite playhead time with room for the copied motion.",
      };
    if (
      targetTracks.some((other) => overlaps(block, other)) ||
      blocks.slice(0, index).some((other) => overlaps(block, other))
    )
      return {
        ok: false,
        message: `There is already ${block.propertyName} motion at this time. Move the playhead to an empty range or another layer.`,
      };
  }
  return {
    ok: true,
    blocks,
    duration: Math.max(duration, ...blocks.map((block) => block.endTime)),
  };
}
