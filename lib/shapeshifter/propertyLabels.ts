/**
 * Human-readable names for the raw animatable property keys used throughout the
 * store/timeline (`pathData`, `trimPathStart`, …). The keys stay machine-friendly
 * in the data model; the UI shows these labels instead of leaking internals.
 */
export const PROPERTY_LABELS: Record<string, string> = {
  pathData: "Shape",
  fillColor: "Fill color",
  fillAlpha: "Fill opacity",
  strokeColor: "Stroke color",
  strokeAlpha: "Stroke opacity",
  strokeWidth: "Stroke width",
  trimPathStart: "Trim start",
  trimPathEnd: "Trim end",
  trimPathOffset: "Trim offset",
  rotation: "Rotation",
  scaleX: "Scale X",
  scaleY: "Scale Y",
  pivotX: "Pivot X",
  pivotY: "Pivot Y",
  translateX: "Move X",
  translateY: "Move Y",
  alpha: "Opacity",
};

export function propertyLabel(name: string): string {
  return PROPERTY_LABELS[name] ?? name;
}
