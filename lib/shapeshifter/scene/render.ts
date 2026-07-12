import type { AnimationState, Layer } from "../types";
import { pathToString } from "../pathUtils";
import { colorAtTime, numberAtTime, pathDAtTime } from "../playheadResolve";

export interface WorldLayerDraw {
  id: string | number;
  d: string;
  fill: string | null;
  stroke: string | null;
  fillOpacity: number;
  strokeOpacity: number;
  strokeWidth: number;
  fillGradient: Layer["fillGradient"];
  fillType: Layer["fillType"];
  translateX: number;
  translateY: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  pivotX: number;
  pivotY: number;
}

/** Resolve one owner document into render-ready values at the current playhead. */
export function resolveWorldLayerDraws(
  layers: Layer[],
  animation: AnimationState,
  progress: number,
  usePlayhead: boolean,
): WorldLayerDraw[] {
  const duration = Math.max(1, animation.duration);
  const currentMs = progress * duration;
  return layers
    .filter(
      (layer) =>
        layer.visible !== false &&
        (layer.type === "path" ||
          layer.type === "clipPath" ||
          Boolean(layer.from) ||
          Boolean(layer.pathData)),
    )
    .map((layer) => {
      const fillColor = usePlayhead
        ? colorAtTime(
            layer,
            animation.blocks,
            "fillColor",
            currentMs,
            duration,
            layer.fillColor || "",
          )
        : layer.fillColor;
      return {
        id: layer.id,
        d: usePlayhead
          ? pathDAtTime(layer, animation.blocks, currentMs, duration, progress)
          : pathToString(layer.from || layer.pathData),
        fill: fillColor && fillColor !== "none" && fillColor !== "" ? fillColor : null,
        stroke: layer.strokeColor && layer.strokeColor !== "" ? layer.strokeColor : null,
        fillOpacity: usePlayhead
          ? numberAtTime(layer, animation.blocks, "fillAlpha", currentMs, duration, 1)
          : (layer.fillAlpha ?? 1),
        strokeOpacity: usePlayhead
          ? numberAtTime(layer, animation.blocks, "strokeAlpha", currentMs, duration, 1)
          : (layer.strokeAlpha ?? 1),
        strokeWidth: Number(layer.strokeWidth) || 0,
        fillGradient: layer.fillGradient,
        fillType: layer.fillType,
        translateX: usePlayhead
          ? numberAtTime(layer, animation.blocks, "translateX", currentMs, duration)
          : Number(layer.translateX) || 0,
        translateY: usePlayhead
          ? numberAtTime(layer, animation.blocks, "translateY", currentMs, duration)
          : Number(layer.translateY) || 0,
        rotation: usePlayhead
          ? numberAtTime(layer, animation.blocks, "rotation", currentMs, duration)
          : Number(layer.rotation) || 0,
        scaleX: usePlayhead
          ? numberAtTime(layer, animation.blocks, "scaleX", currentMs, duration, 1)
          : Number.isFinite(layer.scaleX)
            ? Number(layer.scaleX)
            : 1,
        scaleY: usePlayhead
          ? numberAtTime(layer, animation.blocks, "scaleY", currentMs, duration, 1)
          : Number.isFinite(layer.scaleY)
            ? Number(layer.scaleY)
            : 1,
        pivotX: usePlayhead
          ? numberAtTime(layer, animation.blocks, "pivotX", currentMs, duration)
          : Number(layer.pivotX) || 0,
        pivotY: usePlayhead
          ? numberAtTime(layer, animation.blocks, "pivotY", currentMs, duration)
          : Number(layer.pivotY) || 0,
      };
    });
}
