/**
 * Human-readable names for the raw animatable property keys used throughout the
 * store/timeline (`pathData`, `trimPathStart`, …). The keys stay machine-friendly
 * in the data model; the UI shows these labels instead of leaking internals.
 */
export const PROPERTY_LABELS: Record<string, string> = {
  // pathData is not shown as its own timeline row — its clip lives on the layer's own bar.
  // Named "Path" (not "Shape") to match the Layer > Type field, which already uses
  // Path/Clip/Group — one vocabulary for the same concept everywhere in the panel.
  pathData: "Path",
  fillColor: "Fill",
  fillAlpha: "Opacity",
  strokeColor: "Stroke",
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
  translateX: "Position X",
  translateY: "Position Y",
  alpha: "Opacity",
};

export function propertyLabel(name: string): string {
  return PROPERTY_LABELS[name] ?? name;
}
