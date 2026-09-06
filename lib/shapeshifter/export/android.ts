import { compileAndroidArtboard, type AndroidExportBundle } from "../androidCompiler";
import { pathToString } from "../pathUtils";
import type { Layer, VectorMetadata } from "../types";
import type { ExportOptions } from "./types";

function vectorMetadata(layer: Layer, options: ExportOptions): VectorMetadata {
  return {
    id: "legacy-vector",
    name: layer.name || "vector",
    width: options.width ?? 48,
    height: options.height ?? 48,
    viewportWidth: options.viewBoxWidth ?? 48,
    viewportHeight: options.viewBoxHeight ?? 48,
    alpha: 1,
  };
}

function canonicalLayerBundle(
  layer: Layer,
  options: ExportOptions,
  animate: boolean,
): AndroidExportBundle {
  const duration = Math.max(1, Math.round((options.duration ?? 1.2) * 1000));
  const from = pathToString(layer.pathData ?? layer.from);
  const to = pathToString(layer.to ?? layer.from);
  return compileAndroidArtboard({
    name: layer.name || "vector",
    layers: [layer],
    vector: vectorMetadata(layer, options),
    animation: {
      id: "legacy-motion",
      name: "Legacy motion",
      duration,
      blocks: animate
        ? [
            {
              id: "legacy-path-morph",
              layerId: layer.id,
              propertyName: "pathData",
              fromValue: from,
              toValue: to,
              startTime: 0,
              endTime: duration,
              interpolator: "FAST_OUT_SLOW_IN",
              type: "path",
            },
          ]
        : [],
    },
  });
}

/**
 * @deprecated Prefer `compileAndroidArtboard` for document exports. This
 * single-layer adapter returns canonical VectorDrawable XML so it cannot
 * silently diverge from the production Android compiler.
 */
export function exportVectorDrawable(layer: Layer, options: ExportOptions = {}): string {
  const bundle = canonicalLayerBundle(layer, options, false);
  return bundle.files.find((file) => file.path.endsWith("_vector.xml"))?.content ?? "";
}

/**
 * @deprecated Use `compileAndroidArtboard` / `compileLiveAndroidArtboardAsync`.
 * An AnimatedVectorDrawable is a resource bundle, not a concatenated XML string;
 * this adapter therefore returns the compiler's complete canonical bundle.
 */
export function exportAnimatedVectorDrawable(
  layer: Layer,
  options: ExportOptions = {},
): AndroidExportBundle {
  return canonicalLayerBundle(layer, options, true);
}
