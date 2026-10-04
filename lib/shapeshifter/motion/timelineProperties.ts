import type { AnimatableProperty, LayerType } from "../types";

const transforms: AnimatableProperty[] = [
  "translateX",
  "translateY",
  "rotation",
  "scaleX",
  "scaleY",
  "pivotX",
  "pivotY",
];
const pathProperties: AnimatableProperty[] = [
  "pathData",
  "alpha",
  "fillColor",
  "fillAlpha",
  "strokeColor",
  "strokeAlpha",
  "strokeWidth",
  "trimPathStart",
  "trimPathEnd",
  "trimPathOffset",
];

/** Authorable properties that preserve the editor's Android vector target. */
export function timelinePropertiesForLayer(type: LayerType): AnimatableProperty[] {
  if (type === "clipPath") return ["pathData"];
  if (type === "group" || type === "vector") return [...transforms];
  return [...transforms, ...pathProperties];
}

export function timelineNumberRange(property: string): readonly [number, number] {
  if (["alpha", "fillAlpha", "strokeAlpha", "trimPathStart", "trimPathEnd"].includes(property))
    return [0, 1];
  if (property === "strokeWidth") return [0, 1e7];
  return [-1e7, 1e7];
}

export function isTimelineNumberValid(property: string, value: number): boolean {
  const [min, max] = timelineNumberRange(property);
  return Number.isFinite(value) && value >= min && value <= max;
}
