import type { AnimationState, Layer, TimelineBlock } from "../types";

export interface TranslationRecordResult {
  layers: Layer[];
  animation: AnimationState;
}

export type NumericLayerProperty =
  | "translateX"
  | "translateY"
  | "rotation"
  | "scaleX"
  | "scaleY"
  | "pivotX"
  | "pivotY"
  | "fillAlpha"
  | "strokeAlpha"
  | "strokeWidth"
  | "trimPathStart"
  | "trimPathEnd"
  | "trimPathOffset"
  | "alpha";

const numericFallback: Partial<Record<NumericLayerProperty, number>> = {
  scaleX: 1,
  scaleY: 1,
  fillAlpha: 1,
  strokeAlpha: 1,
  trimPathEnd: 1,
  alpha: 1,
};

/**
 * Record the selected layers' current position at a normalized playhead.
 * Pure so every scene owner can use identical key insertion/split semantics.
 */
export function recordTranslationAtProgress(
  layers: Layer[],
  animation: AnimationState,
  selectedIds: Array<string | number>,
  progress: number,
  idSeed = Date.now(),
  properties: NumericLayerProperty[] = ["translateX", "translateY"],
): TranslationRecordResult {
  const selected = new Set(selectedIds.map(String));
  const targets = layers.filter((layer) => selected.has(String(layer.id)));
  if (targets.length === 0) return { layers, animation };

  const duration = Math.max(1, animation.duration);
  const ms = Math.round(progress * duration);
  const nearStart = ms <= duration * 0.05;
  const nearEnd = ms >= duration * 0.95;
  const minSeg = 50;
  let sequence = 0;

  const upsertKey = (
    blocks: TimelineBlock[],
    layer: Layer,
    propertyName: NumericLayerProperty,
    value: number,
  ): TimelineBlock[] => {
    const segments = blocks
      .map((block, index) => ({ block, index }))
      .filter(
        ({ block }) =>
          String(block.layerId) === String(layer.id) && block.propertyName === propertyName,
      )
      .sort((a, b) => a.block.startTime - b.block.startTime);

    const nextId = (suffix: string) =>
      `block-${layer.id}-${propertyName}-${idSeed}-${sequence++}-${suffix}`;
    if (segments.length === 0) {
      return [
        ...blocks,
        {
          id: nextId("new"),
          layerId: layer.id,
          propertyName,
          type: "number",
          fromValue: nearStart ? value : 0,
          toValue: value,
          startTime: 0,
          endTime: duration,
          interpolator: "FAST_OUT_SLOW_IN",
        },
      ];
    }

    const cover = segments.find(({ block }) => ms >= block.startTime && ms <= block.endTime);
    if (!cover) {
      const last = segments[segments.length - 1]!.block;
      if (ms > last.endTime) {
        return [
          ...blocks,
          {
            id: nextId("tail"),
            layerId: layer.id,
            propertyName,
            type: "number",
            fromValue: Number(last.toValue) || 0,
            toValue: value,
            startTime: last.endTime,
            endTime: duration,
            interpolator: last.interpolator || "FAST_OUT_SLOW_IN",
          },
        ];
      }
      const first = segments[0]!.block;
      return [
        ...blocks,
        {
          id: nextId("head"),
          layerId: layer.id,
          propertyName,
          type: "number",
          fromValue: value,
          toValue: Number(first.fromValue) || 0,
          startTime: 0,
          endTime: first.startTime,
          interpolator: first.interpolator || "FAST_OUT_SLOW_IN",
        },
      ];
    }

    const previous = cover.block;
    if (nearStart || Math.abs(ms - previous.startTime) < minSeg) {
      return blocks.map((block, index) =>
        index === cover.index ? { ...previous, fromValue: value, type: "number" } : block,
      );
    }
    if (nearEnd || Math.abs(ms - previous.endTime) < minSeg) {
      return blocks.map((block, index) =>
        index === cover.index ? { ...previous, toValue: value, type: "number" } : block,
      );
    }

    const left: TimelineBlock = {
      ...previous,
      id: nextId("left"),
      fromValue: Number(previous.fromValue) || 0,
      toValue: value,
      endTime: ms,
      type: "number",
    };
    const right: TimelineBlock = {
      ...previous,
      id: nextId("right"),
      fromValue: value,
      toValue: Number(previous.toValue) || 0,
      startTime: ms,
      type: "number",
    };
    return [...blocks.filter((_, index) => index !== cover.index), left, right];
  };

  let blocks = animation.blocks;
  for (const layer of targets) {
    for (const propertyName of properties) {
      const raw = (layer as unknown as Record<string, unknown>)[propertyName];
      const fallback = numericFallback[propertyName] ?? 0;
      const value = typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
      blocks = upsertKey(blocks, layer, propertyName, value);
    }
  }
  return {
    animation: { ...animation, blocks },
    layers: layers.map((layer) =>
      selected.has(String(layer.id)) ? { ...layer, expanded: true } : layer,
    ),
  };
}
