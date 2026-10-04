import type { Layer, TimelineBlock } from "../shapeshifter/types";

const stableArray = <T>(before: T[], after: T[]) =>
  before.length === after.length && before.every((item, index) => item === after[index])
    ? before
    : after;

/** Timeline edits preserve unrelated layer identities during pointer gestures. */
export function mapLayerTimelines(
  layers: Layer[],
  transform: (blocks: TimelineBlock[]) => TimelineBlock[],
): Layer[] {
  const next = layers.map((layer) => {
    const timeline = layer.timeline && stableArray(layer.timeline, transform(layer.timeline));
    const children = layer.children?.length
      ? mapLayerTimelines(layer.children, transform)
      : layer.children;
    if (timeline === layer.timeline && children === layer.children) return layer;
    return { ...layer, ...(timeline && { timeline }), ...(children && { children }) };
  });
  return stableArray(layers, next);
}
