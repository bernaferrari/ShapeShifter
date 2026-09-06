import { evaluateAndroidScene } from "@/lib/shapeshifter/scene/evaluate";
import { matrixToSvg } from "@/lib/shapeshifter/scene/layerTransform";
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
  const scene = evaluateAndroidScene(
    layers,
    { id: "preview", name: "preview", duration, blocks },
    progress,
    true,
  );
  return scene.nodes
    .filter((node) => node.visible && (node.type === "path" || node.type === "clipPath"))
    .map((node) => ({
      layer: node.layer,
      d: node.d,
      transform: matrixToSvg(node.worldMatrix),
      opacity: node.alpha,
      fillColor: node.fill ?? "",
      fillAlpha: node.fillOpacity,
      strokeColor: node.stroke ?? "",
      strokeAlpha: node.strokeOpacity,
      strokeWidth: node.strokeWidth,
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
  const preview = getPreviewLayers(layers, blocks, duration, progress).find(
    (candidate) => String(candidate.layer.id) === String(layer.id),
  );
  return preview?.transform ?? "";
}
