/**
 * Resolve Android ObjectAnimator-style tracks at an absolute time in milliseconds.
 * The legacy UI still stores timeline blocks, so this module compiles that shape
 * once per blocks array and gives every preview/export consumer identical values.
 */
import { evaluateInterpolator } from "./interpolators";
import { interpolatedPathIfCompatible, parsePath, pathToString } from "./pathUtils";
import type { Layer, PathData, TimelineBlock } from "./types";

type CompiledBlocks = Map<string, TimelineBlock[]>;

const compiledBlockCache = new WeakMap<TimelineBlock[], CompiledBlocks>();

function trackKey(layerId: string | number, propertyName: string) {
  return `${String(layerId)}\u0000${propertyName}`;
}

/** Build a stable target/property index. Timeline actions replace the blocks array,
 * so this avoids repeated filter/sort work in the RAF path without stale caches. */
export function compileTimelineBlocks(blocks: TimelineBlock[]): CompiledBlocks {
  const cached = compiledBlockCache.get(blocks);
  if (cached) return cached;
  const compiled: CompiledBlocks = new Map();
  for (const block of blocks) {
    const key = trackKey(block.layerId, block.propertyName);
    compiled.set(key, [...(compiled.get(key) ?? []), block]);
  }
  for (const entries of compiled.values()) {
    entries.sort(
      (a, b) =>
        a.startTime - b.startTime ||
        a.endTime - b.endTime ||
        String(a.id).localeCompare(String(b.id)),
    );
  }
  compiledBlockCache.set(blocks, compiled);
  return compiled;
}

export function blocksFor(
  blocks: TimelineBlock[],
  layerId: string | number,
  propertyName: string,
): TimelineBlock[] {
  return compileTimelineBlocks(blocks).get(trackKey(layerId, propertyName)) ?? [];
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function finiteValue(value: string | number, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

interface ResolvedSegment {
  block?: TimelineBlock;
  progress: number;
  before: boolean;
  after: boolean;
}

/**
 * Resolves ObjectAnimator boundaries deterministically. A gap holds the preceding
 * target value, and an overlapping track uses the most recently-started animator.
 * This makes behavior explicit rather than silently snapping to base state.
 */
function resolveSegment(segments: TimelineBlock[], ms: number): ResolvedSegment {
  if (!segments.length) return { progress: 0, before: false, after: false };
  const first = segments[0]!;
  if (ms < first.startTime) return { block: first, progress: 0, before: true, after: false };

  const active = segments.filter((block) => ms >= block.startTime && ms <= block.endTime);
  if (active.length) {
    const block = active.at(-1)!;
    const span = block.endTime - block.startTime;
    const progress =
      span <= 0 ? 1 : evaluateInterpolator((ms - block.startTime) / span, block.interpolator);
    return { block, progress: clamp01(progress), before: false, after: false };
  }

  const completed = segments.filter((block) => block.endTime < ms);
  if (completed.length) {
    const block = completed.at(-1)!;
    return { block, progress: 1, before: false, after: true };
  }
  return { block: first, progress: 0, before: true, after: false };
}

/** Numeric property at an absolute Android animator time. */
export function numberAtTime(
  layer: Layer,
  blocks: TimelineBlock[],
  propertyName: string,
  ms: number,
  _duration: number,
  fallback = 0,
): number {
  const raw = (layer as unknown as Record<string, unknown>)[propertyName];
  const baseNumber = typeof raw === "number" ? raw : Number(raw);
  const base = Number.isFinite(baseNumber) ? baseNumber : fallback;
  const segment = resolveSegment(blocksFor(blocks, layer.id, propertyName), ms);
  if (!segment.block) return base;
  const from = finiteValue(segment.block.fromValue, base);
  const to = finiteValue(segment.block.toValue, from);
  return from + (to - from) * segment.progress;
}

interface ColorChannels {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  transparent: "#00000000",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
};

/** Editor colors are CSS-style #RRGGBBAA. Android #AARRGGBB is converted at import. */
export function parseEditorColor(value: string): ColorChannels | null {
  const normalized = NAMED_COLORS[value.trim().toLowerCase()] ?? value.trim();
  const rgba = normalized.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+)\s*)?\)$/i,
  );
  if (rgba) {
    const alpha = rgba[4] == null ? 1 : Number(rgba[4]);
    const channels = [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), alpha * 255];
    if (channels.some((channel) => !Number.isFinite(channel))) return null;
    return {
      r: clampByte(channels[0]),
      g: clampByte(channels[1]),
      b: clampByte(channels[2]),
      a: clampByte(channels[3]),
    };
  }
  const hex = normalized.replace(/^#/, "");
  if (![3, 4, 6, 8].includes(hex.length) || !/^[\da-f]+$/i.test(hex)) return null;
  const expanded =
    hex.length <= 4
      ? hex
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : hex;
  return {
    r: parseInt(expanded.slice(0, 2), 16),
    g: parseInt(expanded.slice(2, 4), 16),
    b: parseInt(expanded.slice(4, 6), 16),
    a: expanded.length === 8 ? parseInt(expanded.slice(6, 8), 16) : 255,
  };
}

function clampByte(value: number) {
  return Math.round(Math.max(0, Math.min(255, value)));
}

function editorColorString(color: ColorChannels) {
  const hex = (value: number) => clampByte(value).toString(16).padStart(2, "0");
  const rgb = `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`;
  return color.a >= 255 ? rgb : `${rgb}${hex(color.a)}`;
}

/** Color property with alpha-aware, eased interpolation. */
export function colorAtTime(
  layer: Layer,
  blocks: TimelineBlock[],
  propertyName: string,
  ms: number,
  _duration: number,
  fallback: string,
): string {
  const segment = resolveSegment(blocksFor(blocks, layer.id, propertyName), ms);
  if (!segment.block) return fallback;
  const fromValue = String(segment.block.fromValue || fallback);
  const toValue = String(segment.block.toValue || fromValue);
  if (segment.progress <= 0) return fromValue;
  if (segment.progress >= 1) return toValue;
  const from = parseEditorColor(fromValue);
  const to = parseEditorColor(toValue);
  if (!from || !to) return segment.progress < 0.5 ? fromValue : toValue;
  const t = segment.progress;
  return editorColorString({
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t,
    a: from.a + (to.a - from.a) * t,
  });
}

function pathFromValue(value: string | number, fallback: PathData): PathData {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    return parsePath(value);
  } catch {
    return fallback;
  }
}

/** Resolve geometry from the path track itself, rather than a mutable layer endpoint pair. */
export function pathDAtTime(
  layer: Layer,
  blocks: TimelineBlock[],
  ms: number,
  _duration: number,
  progress01: number,
): string {
  const from = layer.from;
  const segments = blocksFor(blocks, layer.id, "pathData");
  const segment = resolveSegment(segments, ms);
  if (segment.block) {
    const pathFrom = pathFromValue(segment.block.fromValue, from);
    const pathTo = pathFromValue(segment.block.toValue, layer.to ?? pathFrom);
    if (segment.progress <= 0) return pathToString(pathFrom);
    if (segment.progress >= 1) return pathToString(pathTo);
    return interpolatedPathIfCompatible(pathFrom, pathTo, segment.progress);
  }

  if (layer.to && progress01 > 0) {
    return interpolatedPathIfCompatible(from, layer.to, clamp01(progress01));
  }
  return pathToString(layer.pathData ?? from);
}

/** Sample the group/path translation trajectory for the authoring overlay. */
export function sampleMotionPath(
  layer: Layer,
  blocks: TimelineBlock[],
  duration: number,
  samples = 48,
): Array<{ x: number; y: number }> {
  const hasX = blocksFor(blocks, layer.id, "translateX").length > 0;
  const hasY = blocksFor(blocks, layer.id, "translateY").length > 0;
  if (!hasX && !hasY) return [];
  // `samples` means segments; include both authored endpoints for an overlay
  // that exactly reaches the final Android animator state.
  const count = Math.max(2, Math.floor(samples) + 1);
  return Array.from({ length: count }, (_, index) => {
    const ms = (duration * index) / (count - 1);
    return {
      x: numberAtTime(layer, blocks, "translateX", ms, duration, layer.translateX ?? 0),
      y: numberAtTime(layer, blocks, "translateY", ms, duration, layer.translateY ?? 0),
    };
  });
}
