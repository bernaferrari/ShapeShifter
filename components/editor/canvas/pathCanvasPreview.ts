import { colorAtTime, numberAtTime, pathDAtTime } from "@/lib/shapeshifter/playheadResolve";
import type { Layer, TimelineBlock } from "@/lib/shapeshifter/types";

export interface PreviewLayer {
  layer: Layer;
  d: string;
  transform: string;
  opacity: number;
  fillColor: string;
  fillAlpha: number;
  strokeColor: string;
  strokeAlpha: number;
  strokeWidth: number;
}

/** Evaluates every visible path at one playhead position. */
export function getPreviewLayers(
  layers: Layer[],
  blocks: TimelineBlock[],
  duration: number,
  progress: number,
): PreviewLayer[] {
  const currentMs = progress * duration;
  return layers
    .filter(
      (layer) => layer.visible !== false && (layer.type === "path" || layer.type === "clipPath"),
    )
    .map((layer) => ({
      layer,
      d: pathDAtTime(layer, blocks, currentMs, duration, progress),
      transform: getLayerTransform(layer, layers, blocks, duration, progress),
      opacity: numberAtTime(layer, blocks, "alpha", currentMs, duration, layer.alpha ?? 1),
      fillColor: colorAtTime(
        layer,
        blocks,
        "fillColor",
        currentMs,
        duration,
        layer.fillColor ?? "",
      ),
      fillAlpha: numberAtTime(
        layer,
        blocks,
        "fillAlpha",
        currentMs,
        duration,
        layer.fillAlpha ?? 1,
      ),
      strokeColor: colorAtTime(
        layer,
        blocks,
        "strokeColor",
        currentMs,
        duration,
        layer.strokeColor ?? "",
      ),
      strokeAlpha: numberAtTime(
        layer,
        blocks,
        "strokeAlpha",
        currentMs,
        duration,
        layer.strokeAlpha ?? 1,
      ),
      strokeWidth: numberAtTime(
        layer,
        blocks,
        "strokeWidth",
        currentMs,
        duration,
        layer.strokeWidth ?? 0,
      ),
    }));
}

/** Resolves transforms inherited through the complete parent chain. */
export function getLayerTransform(
  layer: Layer,
  layers: Layer[],
  blocks: TimelineBlock[],
  duration: number,
  progress: number,
) {
  const currentMs = progress * duration;
  const chain: Layer[] = [];
  let current: Layer | undefined = layer;
  while (current) {
    chain.unshift(current);
    current =
      current.parentId == null
        ? undefined
        : layers.find((candidate) => String(candidate.id) === String(current?.parentId));
  }

  return chain
    .map((candidate) => {
      const value = (property: string, fallback: number) =>
        numberAtTime(candidate, blocks, property, currentMs, duration, fallback);
      const pivotX = value("pivotX", candidate.pivotX ?? 0);
      const pivotY = value("pivotY", candidate.pivotY ?? 0);
      const translateX = value("translateX", candidate.translateX ?? 0);
      const translateY = value("translateY", candidate.translateY ?? 0);
      const rotation = value("rotation", candidate.rotation ?? 0);
      const scaleX = value("scaleX", candidate.scaleX ?? 1);
      const scaleY = value("scaleY", candidate.scaleY ?? 1);

      return [
        translateX || translateY ? `translate(${translateX} ${translateY})` : "",
        pivotX || pivotY ? `translate(${pivotX} ${pivotY})` : "",
        rotation ? `rotate(${rotation})` : "",
        scaleX !== 1 || scaleY !== 1 ? `scale(${scaleX} ${scaleY})` : "",
        pivotX || pivotY ? `translate(${-pivotX} ${-pivotY})` : "",
      ]
        .filter(Boolean)
        .join(" ");
    })
    .filter(Boolean)
    .join(" ");
}
