import type { InterpolatorName, Layer, TimelineBlock } from "../types";
import { timelinePropertiesForLayer } from "./timelineProperties";

export type MotionPresetId = "spin" | "tilt" | "pulse" | "pop" | "fade" | "draw";

export interface MotionPreset {
  id: MotionPresetId;
  name: string;
  description: string;
  properties: readonly string[];
  /** Rotation and scale read as intended only around the shape's center. */
  centered: boolean;
}

export const MOTION_PRESETS: readonly MotionPreset[] = [
  {
    id: "spin",
    name: "Spin",
    description: "One full turn, ending where it started.",
    properties: ["rotation"],
    centered: true,
  },
  {
    id: "tilt",
    name: "Tilt",
    description: "Rocks to each side, then settles.",
    properties: ["rotation"],
    centered: true,
  },
  {
    id: "pulse",
    name: "Pulse",
    description: "Grows, then settles back to size.",
    properties: ["scaleX", "scaleY"],
    centered: true,
  },
  {
    id: "pop",
    name: "Pop",
    description: "Springs in from nothing.",
    properties: ["scaleX", "scaleY"],
    centered: true,
  },
  {
    id: "fade",
    name: "Fade",
    description: "Fades in from transparent.",
    properties: ["alpha"],
    centered: false,
  },
  {
    id: "draw",
    name: "Draw",
    description: "Draws the stroke from start to end.",
    properties: ["trimPathEnd"],
    centered: false,
  },
];

export const motionPresetsForLayer = (layer: Pick<Layer, "type">) => {
  const available = timelinePropertiesForLayer(layer.type) as readonly string[];
  return MOTION_PRESETS.filter((preset) =>
    preset.properties.every((property) => available.includes(property)),
  );
};

type Segment = Pick<
  TimelineBlock,
  "propertyName" | "startTime" | "endTime" | "fromValue" | "toValue" | "interpolator" | "type"
>;

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Chain keyframe values into back-to-back segments that share their edges. */
function track(
  propertyName: string,
  keys: Array<[time: number, value: number]>,
  interpolator: InterpolatorName,
): Segment[] {
  return keys.slice(1).map(([time, value], index) => ({
    propertyName,
    startTime: round(keys[index]![0]),
    endTime: round(time),
    fromValue: round(keys[index]![1]),
    toValue: round(value),
    interpolator,
    type: "number",
  }));
}

/**
 * Ordinary timeline segments for a preset, relative to the layer's base pose,
 * so the result stays fully editable and loops back to where it started.
 */
export function motionPresetSegments(
  id: MotionPresetId,
  layer: Pick<Layer, "rotation" | "scaleX" | "scaleY" | "alpha">,
  duration: number,
): Segment[] {
  const d = Math.max(1, duration);
  const rotation = layer.rotation ?? 0;
  const scale = (name: "scaleX" | "scaleY") => layer[name] ?? 1;
  switch (id) {
    case "spin":
      return track(
        "rotation",
        [
          [0, rotation],
          [d, rotation + 360],
        ],
        "LINEAR",
      );
    case "tilt":
      return track(
        "rotation",
        [
          [0, rotation],
          [d / 4, rotation + 15],
          [(d * 3) / 4, rotation - 15],
          [d, rotation],
        ],
        "ACCELERATE_DECELERATE",
      );
    case "pulse":
      return (["scaleX", "scaleY"] as const).flatMap((name) =>
        track(
          name,
          [
            [0, scale(name)],
            [d / 2, scale(name) * 1.2],
            [d, scale(name)],
          ],
          "ACCELERATE_DECELERATE",
        ),
      );
    case "pop":
      return (["scaleX", "scaleY"] as const).flatMap((name) => [
        ...track(
          name,
          [
            [0, 0],
            [d * 0.6, scale(name) * 1.12],
          ],
          "FAST_OUT_SLOW_IN",
        ),
        ...track(
          name,
          [
            [d * 0.6, scale(name) * 1.12],
            [d, scale(name)],
          ],
          "ACCELERATE_DECELERATE",
        ),
      ]);
    case "fade":
      return track(
        "alpha",
        [
          [0, 0],
          [d, layer.alpha ?? 1],
        ],
        "FAST_OUT_SLOW_IN",
      );
    case "draw":
      return track(
        "trimPathEnd",
        [
          [0, 0],
          [d, 1],
        ],
        "FAST_OUT_SLOW_IN",
      );
  }
}

const close = (a: number, b: number) => Math.abs(a - b) < 1e-3;

/**
 * Presets whose keyframes are still on the layer exactly as applied. Once a
 * track is edited by hand it is ordinary animation and no longer listed.
 */
export function appliedMotionPresets(
  layer: Pick<Layer, "id" | "type" | "rotation" | "scaleX" | "scaleY" | "alpha">,
  blocks: readonly TimelineBlock[],
  duration: number,
): MotionPreset[] {
  const own = blocks.filter((block) => String(block.layerId) === String(layer.id));
  return motionPresetsForLayer(layer).filter((preset) => {
    const actual = own.filter((block) => preset.properties.includes(block.propertyName));
    const expected = motionPresetSegments(preset.id, layer, duration);
    return (
      actual.length === expected.length &&
      expected.every((segment) =>
        actual.some(
          (block) =>
            block.propertyName === segment.propertyName &&
            close(block.startTime, segment.startTime) &&
            close(block.endTime, segment.endTime) &&
            close(Number(block.fromValue), Number(segment.fromValue)) &&
            close(Number(block.toValue), Number(segment.toValue)),
        ),
      )
    );
  });
}
