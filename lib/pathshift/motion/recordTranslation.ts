import type { AnimationState, Layer, TimelineBlock } from "../types";

export interface TranslationRecordResult {
  layers: Layer[];
  animation: AnimationState;
}

export interface TranslationRecordOptions {
  /** Record at the pointer's playhead without snapping to nearby authored keys. */
  exactPlayhead?: boolean;
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
  { exactPlayhead = false }: TranslationRecordOptions = {},
): TranslationRecordResult {
  const selected = new Set(selectedIds.map(String));
  const targets = layers.filter((layer) => selected.has(String(layer.id)));
  if (targets.length === 0) return { layers, animation };

  const duration = Math.max(1, animation.duration);
  const ms = exactPlayhead
    ? Math.max(0, Math.min(duration, progress * duration))
    : Math.round(progress * duration);
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
      .sort(
        (a, b) =>
          a.block.startTime - b.block.startTime ||
          (exactPlayhead
            ? a.block.endTime - b.block.endTime ||
              String(a.block.id).localeCompare(String(b.block.id))
            : 0),
      );

    const nextId = (suffix: string) =>
      `block-${layer.id}-${propertyName}-${idSeed}-${sequence++}-${suffix}`;
    if (segments.length === 0) {
      // A fresh track spans the whole timeline, so its start must resolve to what
      // numberAtTime returned before the track existed — the layer's current base
      // value. Seeding 0 would teleport the layer from its authored resting pose
      // to the origin during playback/scrub.
      return [
        ...blocks,
        {
          id: nextId("new"),
          layerId: layer.id,
          propertyName,
          type: "number",
          fromValue: value,
          toValue: value,
          startTime: 0,
          endTime: duration,
          interpolator: "FAST_OUT_SLOW_IN",
        },
      ];
    }

    const cover = exactPlayhead
      ? segments.filter(({ block }) => ms >= block.startTime && ms <= block.endTime).at(-1)
      : segments.find(({ block }) => ms >= block.startTime && ms <= block.endTime);
    if (
      exactPlayhead &&
      cover &&
      (Math.abs(ms - cover.block.startTime) < 1e-7 || Math.abs(ms - cover.block.endTime) < 1e-7)
    ) {
      const atStart = Math.abs(ms - cover.block.startTime) < 1e-7;
      const prior = atStart ? cover.block.fromValue : cover.block.toValue;
      // Continuous adjoining segments share one authored key. Keep both sides
      // linked while leaving deliberately discontinuous animator values intact.
      return blocks.map((block, index) => {
        if (String(block.layerId) !== String(layer.id) || block.propertyName !== propertyName)
          return block;
        const from =
          Math.abs(block.startTime - ms) < 1e-7 &&
          (index === cover.index || block.fromValue === prior);
        const to =
          Math.abs(block.endTime - ms) < 1e-7 && (index === cover.index || block.toValue === prior);
        return from || to
          ? {
              ...block,
              ...(from ? { fromValue: value } : {}),
              ...(to ? { toValue: value } : {}),
              type: "number",
            }
          : block;
      });
    }
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
            endTime: exactPlayhead ? ms : duration,
            interpolator: last.interpolator || "FAST_OUT_SLOW_IN",
          },
        ];
      }
      const first = segments[0]!.block;
      const interior = ms > first.startTime && ms < last.endTime && segments.length > 1;
      if (interior) {
        // Recording inside a gap between two authored segments: end the previous
        // segment at the playhead and append a new block seeded from the layer's
        // current base value, so both the authored head and tail survive.
        let gapIndex = -1;
        for (let i = 0; i < segments.length - 1; i += 1) {
          if (segments[i]!.block.endTime <= ms) gapIndex = i;
        }
        const previousBlock = segments[gapIndex]!.block;
        const nextBlock = segments[gapIndex + 1]!.block;
        if (exactPlayhead) {
          return [
            ...blocks,
            {
              ...previousBlock,
              id: nextId("gap-left"),
              fromValue: previousBlock.toValue,
              toValue: value,
              startTime: previousBlock.endTime,
              endTime: ms,
              type: "number",
            },
            {
              ...nextBlock,
              id: nextId("gap-right"),
              fromValue: value,
              toValue: nextBlock.fromValue,
              startTime: ms,
              endTime: nextBlock.startTime,
              type: "number",
            },
          ];
        }
        return [
          ...blocks.map((block, index) =>
            index === segments[gapIndex]!.index
              ? { ...previousBlock, endTime: ms, type: "number" as const }
              : block,
          ),
          {
            id: nextId("interior"),
            layerId: layer.id,
            propertyName,
            type: "number",
            fromValue: value,
            toValue: Number(nextBlock.fromValue) || 0,
            startTime: ms,
            endTime: nextBlock.startTime,
            interpolator: previousBlock.interpolator || "FAST_OUT_SLOW_IN",
          },
        ];
      }
      if (exactPlayhead && ms > 0) {
        const first = segments[0]!.block;
        return [
          ...blocks,
          {
            ...first,
            id: nextId("head-left"),
            fromValue: first.fromValue,
            toValue: value,
            startTime: 0,
            endTime: ms,
            type: "number",
          },
          {
            ...first,
            id: nextId("head-right"),
            fromValue: value,
            toValue: first.fromValue,
            startTime: ms,
            endTime: first.startTime,
            type: "number",
          },
        ];
      }
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
    if (!exactPlayhead && (nearStart || Math.abs(ms - previous.startTime) < minSeg)) {
      return blocks.map((block, index) =>
        index === cover.index ? { ...previous, fromValue: value, type: "number" } : block,
      );
    }
    if (!exactPlayhead && (nearEnd || Math.abs(ms - previous.endTime) < minSeg)) {
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
