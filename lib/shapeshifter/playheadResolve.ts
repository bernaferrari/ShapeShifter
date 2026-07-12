/**
 * Resolve layer visual properties at an absolute time (ms) from timeline blocks.
 * Supports multiple non-overlapping segments per property (multi-keyframe via split blocks).
 */
import type { Layer, TimelineBlock } from "./types";
import { evaluateBlock } from "./interpolators";
import { getInterpolatedPath, pathToString } from "./pathUtils";
import type { PathData } from "./types";

function blocksFor(
  blocks: TimelineBlock[],
  layerId: string | number,
  propertyName: string,
): TimelineBlock[] {
  return blocks
    .filter((b) => String(b.layerId) === String(layerId) && b.propertyName === propertyName)
    .sort((a, b) => a.startTime - b.startTime);
}

/** Numeric property at absolute time (ms). Falls back to layer field. */
export function numberAtTime(
  layer: Layer,
  blocks: TimelineBlock[],
  propertyName: string,
  ms: number,
  duration: number,
  fallback = 0,
): number {
  const raw = (layer as unknown as Record<string, unknown>)[propertyName];
  const numeric = Number(raw);
  const base = raw == null || !Number.isFinite(numeric) ? fallback : numeric;
  const segs = blocksFor(blocks, layer.id, propertyName);
  if (segs.length === 0) return base;

  // Before first segment
  if (ms < segs[0]!.startTime) return Number(segs[0]!.fromValue) || base;
  // After last segment
  const last = segs[segs.length - 1]!;
  if (ms >= last.endTime) return Number(last.toValue) || base;

  for (const block of segs) {
    if (ms < block.startTime) continue;
    if (ms > block.endTime) continue;
    const t = evaluateBlock(ms / Math.max(1, duration), duration, block);
    if (t == null) {
      const local = (ms - block.startTime) / Math.max(1, block.endTime - block.startTime);
      const a = Number(block.fromValue) || 0;
      const b = Number(block.toValue) || 0;
      return a + (b - a) * Math.max(0, Math.min(1, local));
    }
    const a = Number(block.fromValue) || 0;
    const b = Number(block.toValue) || 0;
    return a + (b - a) * Math.max(0, Math.min(1, t));
  }
  return base;
}

export function colorAtTime(
  layer: Layer,
  blocks: TimelineBlock[],
  propertyName: string,
  ms: number,
  duration: number,
  fallback: string,
): string {
  const segs = blocksFor(blocks, layer.id, propertyName);
  if (segs.length === 0) return fallback;
  if (ms < segs[0]!.startTime) return String(segs[0]!.fromValue || fallback);
  const last = segs[segs.length - 1]!;
  if (ms >= last.endTime) return String(last.toValue || fallback);
  // Color blocks: pick nearest end (no lerp without color util mid-flight)
  for (const block of segs) {
    if (ms >= block.startTime && ms <= block.endTime) {
      const mid = (block.startTime + block.endTime) / 2;
      return String(ms < mid ? block.fromValue : block.toValue) || fallback;
    }
  }
  return fallback;
}

/** Path d string at time — morph pathData block or from/to. */
export function pathDAtTime(
  layer: Layer,
  blocks: TimelineBlock[],
  ms: number,
  duration: number,
  progress01: number,
): string {
  const pathBlocks = blocksFor(blocks, layer.id, "pathData");
  const from = layer.from;
  const to = layer.to || layer.from;
  if (!from) return "";

  if (pathBlocks.length > 0) {
    const block = pathBlocks.find((b) => ms >= b.startTime && ms <= b.endTime);
    if (block) {
      const t =
        evaluateBlock(progress01, duration, block) ??
        (ms - block.startTime) / Math.max(1, block.endTime - block.startTime);
      try {
        return getInterpolatedPath(from, to as PathData, Math.max(0, Math.min(1, t)));
      } catch {
        return pathToString(from);
      }
    }
    if (ms < pathBlocks[0]!.startTime) return pathToString(from);
    return pathToString((to as PathData) || from);
  }

  // Implicit morph full duration when from≠to
  if (layer.to && progress01 > 0) {
    try {
      return getInterpolatedPath(from, layer.to, progress01);
    } catch {
      return pathToString(from);
    }
  }
  return pathToString(layer.pathData ?? from);
}

/** Sample position trajectory for motion path (translateX/Y over time). */
export function sampleMotionPath(
  layer: Layer,
  blocks: TimelineBlock[],
  duration: number,
  samples = 48,
): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  const hasX = blocks.some(
    (b) => String(b.layerId) === String(layer.id) && b.propertyName === "translateX",
  );
  const hasY = blocks.some(
    (b) => String(b.layerId) === String(layer.id) && b.propertyName === "translateY",
  );
  if (!hasX && !hasY) return pts;
  for (let i = 0; i <= samples; i++) {
    const ms = (i / samples) * duration;
    pts.push({
      x: numberAtTime(layer, blocks, "translateX", ms, duration),
      y: numberAtTime(layer, blocks, "translateY", ms, duration),
    });
  }
  return pts;
}
