import {
  dominantColor,
  gradientUsesUserSpace,
  linearGradientCoordinates,
  normalizeStops,
} from "./gradients";
import { svgToAndroidColor } from "./mathUtils";
import {
  areAndroidPathsMorphCompatible,
  normalizePathData,
  parsePath,
  pathToString,
} from "./pathUtils";
import { capabilityFor } from "./formatCapabilities";
import { layerTransformToMatrix, transformPointWithMatrix } from "./scene/layerTransform";
import type {
  AnimationState,
  Gradient,
  Layer,
  PathData,
  TimelineBlock,
  VectorMetadata,
} from "./types";

export interface AndroidDiagnostic {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  layerId?: string;
  propertyName?: string;
}

export interface AndroidAssetFile {
  path: string;
  content: string;
}

export interface AndroidExportBundle {
  resourceName: string;
  files: AndroidAssetFile[];
  diagnostics: AndroidDiagnostic[];
}

export interface AndroidArtboardInput {
  name: string;
  layers: Layer[];
  vector: VectorMetadata;
  animation: AnimationState;
  hiddenLayerIds?: string[];
}

const TRANSFORM_PROPERTIES = new Set([
  "translateX",
  "translateY",
  "scaleX",
  "scaleY",
  "rotation",
  "pivotX",
  "pivotY",
]);
const PATH_PROPERTIES = new Set([
  "pathData",
  "fillColor",
  "fillAlpha",
  "strokeColor",
  "strokeAlpha",
  "strokeWidth",
  "trimPathStart",
  "trimPathEnd",
  "trimPathOffset",
]);

const TRACK_CAPABILITY_BY_PROPERTY: Record<string, "trimPath" | undefined> = {
  trimPathStart: "trimPath",
  trimPathEnd: "trimPath",
  trimPathOffset: "trimPath",
};

const xml = (value: string | number) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
const number = (value: number) =>
  Number((Number.isFinite(value) ? value : 0).toFixed(4)).toString();

export function androidResourceName(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  const safe = normalized || "shapeshifter_asset";
  return /^[a-z]/.test(safe) ? safe : `asset_${safe}`;
}

function flattenLayers(layers: Layer[]): Layer[] {
  const result = new Map<string, Layer>();
  const visit = (layer: Layer, parentId?: string | number | null) => {
    result.set(String(layer.id), { ...layer, parentId: layer.parentId ?? parentId ?? null });
    for (const child of layer.children ?? []) visit(child, layer.id);
  };
  for (const layer of layers) visit(layer);
  return [...result.values()];
}

function uniqueLayerNames(
  layers: Layer[],
  transformWrapperLayerIds: ReadonlySet<string>,
): Map<string, string> {
  const used = new Set<string>();
  const names = new Map<string, string>();
  for (const layer of layers) {
    const base = androidResourceName(
      layer.androidName || layer.name || `layer_${String(layer.id)}`,
    );
    let candidate = base;
    let suffix = 2;
    const needsWrapper = transformWrapperLayerIds.has(String(layer.id));
    while (used.has(candidate) || (needsWrapper && used.has(`${candidate}_transform`))) {
      candidate = `${base}_${suffix++}`;
    }
    used.add(candidate);
    if (needsWrapper) used.add(`${candidate}_transform`);
    names.set(String(layer.id), candidate);
  }
  return names;
}

function androidColor(color: string | undefined, fallback = "#00000000"): string {
  if (!color || color === "none" || color === "transparent") return fallback;
  if (color.startsWith("@") || color.startsWith("?")) return color;
  return svgToAndroidColor(color) ?? fallback;
}

function gradientStopColor(color: string, opacity: number): string {
  const android = androidColor(color);
  if (!android.startsWith("#")) return android;
  const hex = android.slice(1);
  const sourceAlpha = hex.length === 8 ? parseInt(hex.slice(0, 2), 16) : 255;
  const rgb = hex.length === 8 ? hex.slice(2) : hex;
  const alpha = Math.round(Math.max(0, Math.min(1, opacity)) * sourceAlpha)
    .toString(16)
    .padStart(2, "0");
  return `#${alpha}${rgb}`;
}

function gradientXml(gradient: Gradient, width: number, height: number, alpha: number): string {
  const stops = normalizeStops(gradient.stops);
  const items = stops
    .map((stop) => {
      return `          <item android:offset="${number(stop.offset)}" android:color="${gradientStopColor(stop.color, (stop.opacity ?? 1) * alpha)}" />`;
    })
    .join("\n");
  if (gradient.type === "radial") {
    const userSpace = gradientUsesUserSpace(gradient);
    return `<aapt:attr name="android:fillColor">
        <gradient android:type="radial" android:centerX="${number(userSpace ? (gradient.cx ?? width / 2) : (gradient.cx ?? 0.5) * width)}" android:centerY="${number(userSpace ? (gradient.cy ?? height / 2) : (gradient.cy ?? 0.5) * height)}" android:gradientRadius="${number(userSpace ? (gradient.r ?? Math.max(width, height) / 2) : (gradient.r ?? 0.5) * Math.max(width, height))}">
${items}
        </gradient>
      </aapt:attr>`;
  }
  const direction = linearGradientCoordinates(gradient);
  const userSpace = gradientUsesUserSpace(gradient);
  return `<aapt:attr name="android:fillColor">
        <gradient android:startX="${number(userSpace ? direction.x1 : direction.x1 * width)}" android:startY="${number(userSpace ? direction.y1 : direction.y1 * height)}" android:endX="${number(userSpace ? direction.x2 : direction.x2 * width)}" android:endY="${number(userSpace ? direction.y2 : direction.y2 * height)}">
${items}
        </gradient>
      </aapt:attr>`;
}

function transformAttributes(layer: Layer): string {
  return [
    ["translateX", layer.translateX, 0],
    ["translateY", layer.translateY, 0],
    ["scaleX", layer.scaleX, 1],
    ["scaleY", layer.scaleY, 1],
    ["rotation", layer.rotation, 0],
    ["pivotX", layer.pivotX, 0],
    ["pivotY", layer.pivotY, 0],
  ]
    .map(
      ([name, value, fallback]) =>
        ` android:${name}="${number((value as number | undefined) ?? (fallback as number))}"`,
    )
    .join("");
}

function pathElement(
  layer: Layer,
  name: string,
  vector: VectorMetadata,
  indent: string,
  inheritedAlpha = 1,
): string {
  const tag = layer.type === "clipPath" ? "clip-path" : "path";
  const sourcePath = layer.pathData ?? layer.from;
  const pathData =
    layer.type === "clipPath" ? clipPathDataString(layer, sourcePath) : pathToString(sourcePath);
  if (tag === "clip-path") {
    return `${indent}<clip-path android:name="${xml(name)}" android:pathData="${xml(pathData)}"${
      layer.fillType === "evenOdd" ? ' android:fillType="evenOdd"' : ""
    } />`;
  }
  const gradient = layer.fillGradient;
  const attributes = [
    `android:name="${xml(name)}"`,
    `android:pathData="${xml(pathData)}"`,
    !gradient ? `android:fillColor="${xml(androidColor(layer.fillColor))}"` : "",
    `android:fillAlpha="${number((layer.fillAlpha ?? 1) * inheritedAlpha)}"`,
    `android:strokeColor="${xml(androidColor(layer.strokeColor))}"`,
    `android:strokeAlpha="${number((layer.strokeAlpha ?? 1) * inheritedAlpha)}"`,
    `android:strokeWidth="${number(layer.strokeWidth ?? 0)}"`,
    `android:strokeLineCap="${layer.strokeLinecap ?? "butt"}"`,
    `android:strokeLineJoin="${layer.strokeLinejoin ?? "miter"}"`,
    `android:strokeMiterLimit="${number(layer.strokeMiterLimit ?? 4)}"`,
    layer.fillType === "evenOdd" ? 'android:fillType="evenOdd"' : "",
    `android:trimPathStart="${number(layer.trimPathStart ?? 0)}"`,
    `android:trimPathEnd="${number(layer.trimPathEnd ?? 1)}"`,
    `android:trimPathOffset="${number(layer.trimPathOffset ?? 0)}"`,
  ]
    .filter(Boolean)
    .join(`\n${indent}    `);
  if (!gradient) return `${indent}<path\n${indent}    ${attributes} />`;
  const viewportWidth = vector.viewportWidth ?? vector.width;
  const viewportHeight = vector.viewportHeight ?? vector.height;
  // Path fillAlpha stays outside the complex color. This lets Android animate
  // fillAlpha without multiplying a static alpha already baked into every stop.
  return `${indent}<path\n${indent}    ${attributes}>\n${indent}  ${gradientXml(gradient, viewportWidth, viewportHeight, 1)}\n${indent}</path>`;
}

function hasTransform(layer: Layer): boolean {
  return (
    (layer.translateX ?? 0) !== 0 ||
    (layer.translateY ?? 0) !== 0 ||
    (layer.scaleX ?? 1) !== 1 ||
    (layer.scaleY ?? 1) !== 1 ||
    (layer.rotation ?? 0) !== 0 ||
    (layer.pivotX ?? 0) !== 0 ||
    (layer.pivotY ?? 0) !== 0
  );
}

/**
 * Android clip paths scope only to their current group and that group's
 * descendants. A wrapper group around a transformed clip therefore ends the
 * clip before the following sibling paths. Bake local static clip transforms
 * into its geometry instead, leaving the clip in sibling order.
 */
function transformedClipPathData(layer: Layer, pathData: PathData): PathData {
  const matrix = layerTransformToMatrix(layer);
  const normalized = normalizePathData(pathData);
  return {
    subPaths: normalized.subPaths.map((subPath) => ({
      commands: subPath.commands.map((command) => ({
        ...command,
        points: command.points.map((point) => transformPointWithMatrix(point, matrix)),
      })),
    })),
  };
}

function clipPathDataString(layer: Layer, pathData: PathData): string {
  return pathToString(hasTransform(layer) ? transformedClipPathData(layer, pathData) : pathData);
}

function transformedClipPathBlock(block: TimelineBlock, layer: Layer): TimelineBlock {
  if (
    layer.type !== "clipPath" ||
    block.propertyName !== "pathData" ||
    !hasTransform(layer) ||
    typeof block.fromValue !== "string" ||
    typeof block.toValue !== "string"
  ) {
    return block;
  }
  return {
    ...block,
    fromValue: clipPathDataString(layer, parsePath(block.fromValue)),
    toValue: clipPathDataString(layer, parsePath(block.toValue)),
  };
}

function platformInterpolator(value?: string): string | null {
  switch (value) {
    case "FAST_OUT_LINEAR_IN":
      return "@android:interpolator/fast_out_linear_in";
    case "LINEAR_OUT_SLOW_IN":
      return "@android:interpolator/linear_out_slow_in";
    case "ACCELERATE_DECELERATE":
      return "@android:anim/accelerate_decelerate_interpolator";
    case "LINEAR":
      return "@android:anim/linear_interpolator";
    case "FAST_OUT_SLOW_IN":
      return "@android:interpolator/fast_out_slow_in";
    default:
      return null;
  }
}

function customBezier(value: string | undefined): [number, number, number, number] | null {
  if (!value) return null;
  const values = value.match(/[-+]?(?:\d*\.)?\d+/g)?.map(Number) ?? [];
  if (values.length < 4 || values.slice(0, 4).some((item) => !Number.isFinite(item))) return null;
  const [x1, y1, x2, y2] = values;
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) return null;
  return [x1, y1, x2, y2];
}

function objectAnimator(
  block: TimelineBlock,
  propertyName: string,
  interpolator: string,
  valueMultiplier = 1,
): string | null {
  const valueType =
    propertyName === "pathData"
      ? "pathType"
      : propertyName === "fillColor" || propertyName === "strokeColor"
        ? "colorType"
        : "floatType";
  if (
    propertyName === "pathData" &&
    (typeof block.fromValue !== "string" ||
      typeof block.toValue !== "string" ||
      !areAndroidPathsMorphCompatible(block.fromValue, block.toValue))
  )
    return null;
  const value = (raw: string | number) =>
    propertyName === "fillColor" || propertyName === "strokeColor"
      ? androidColor(String(raw))
      : propertyName === "fillAlpha" || propertyName === "strokeAlpha"
        ? number(Number(raw) * valueMultiplier)
        : String(raw);
  return `  <objectAnimator
      android:startOffset="${Math.max(0, Math.round(block.startTime))}"
      android:duration="${Math.max(1, Math.round(block.endTime - block.startTime))}"
      android:propertyName="${propertyName}"
      android:valueFrom="${xml(value(block.fromValue))}"
      android:valueTo="${xml(value(block.toValue))}"
      android:valueType="${valueType}"
      android:interpolator="${interpolator}" />`;
}

export function compileAndroidArtboard(input: AndroidArtboardInput): AndroidExportBundle {
  const resourceName = androidResourceName(input.name || input.vector.name);
  const diagnostics: AndroidDiagnostic[] = [];
  const hidden = new Set(input.hiddenLayerIds ?? []);
  const allLayers = flattenLayers(input.layers);
  const allById = new Map(allLayers.map((layer) => [String(layer.id), layer]));
  const exportableMemo = new Map<string, boolean>();
  const isExportable = (layer: Layer, visiting = new Set<string>()): boolean => {
    const id = String(layer.id);
    const cached = exportableMemo.get(id);
    if (cached != null) return cached;
    if (visiting.has(id) || layer.visible === false || hidden.has(id)) {
      exportableMemo.set(id, false);
      return false;
    }
    if (layer.parentId == null) {
      exportableMemo.set(id, true);
      return true;
    }
    const parent = allById.get(String(layer.parentId));
    const result = !parent || isExportable(parent, new Set(visiting).add(id));
    exportableMemo.set(id, result);
    return result;
  };
  const layers = allLayers.filter((layer) => isExportable(layer));
  const byId = new Map(layers.map((layer) => [String(layer.id), layer]));
  const alphaMemo = new Map<string, number>();
  const effectiveAlpha = (layer: Layer, visiting = new Set<string>()): number => {
    const id = String(layer.id);
    const cached = alphaMemo.get(id);
    if (cached != null) return cached;
    const own = Math.max(0, Math.min(1, layer.alpha ?? 1));
    const parent = layer.parentId != null ? byId.get(String(layer.parentId)) : undefined;
    const value =
      !parent || visiting.has(id) ? own : own * effectiveAlpha(parent, new Set(visiting).add(id));
    alphaMemo.set(id, value);
    return value;
  };
  const inheritedAlpha = (layer: Layer) => {
    const parent = layer.parentId != null ? byId.get(String(layer.parentId)) : undefined;
    return parent ? effectiveAlpha(parent) : 1;
  };
  const transformAnimated = new Set(
    input.animation.blocks
      .filter((block) => TRANSFORM_PROPERTIES.has(block.propertyName))
      .map((block) => String(block.layerId)),
  );
  const transformWrapperLayerIds = new Set(
    layers
      .filter(
        (layer) =>
          layer.type !== "group" &&
          layer.type !== "vector" &&
          layer.type !== "clipPath" &&
          (hasTransform(layer) || transformAnimated.has(String(layer.id))),
      )
      .map((layer) => String(layer.id)),
  );
  const names = uniqueLayerNames(layers, transformWrapperLayerIds);
  const children = new Map<string | null, Layer[]>();
  for (const layer of layers) {
    const parent =
      layer.parentId != null && byId.has(String(layer.parentId)) ? String(layer.parentId) : null;
    children.set(parent, [...(children.get(parent) ?? []), layer]);
  }

  const render = (layer: Layer, depth: number): string => {
    const indent = "  ".repeat(depth);
    const name = names.get(String(layer.id))!;
    const nested = children.get(String(layer.id)) ?? [];
    if (layer.type === "group" || layer.type === "vector") {
      const body = nested.map((child) => render(child, depth + 1)).join("\n");
      return `${indent}<group android:name="${xml(name)}"${transformAttributes(layer)}>\n${body}\n${indent}</group>`;
    }
    if (!transformWrapperLayerIds.has(String(layer.id))) {
      return pathElement(layer, name, input.vector, indent, effectiveAlpha(layer));
    }
    const element = pathElement(layer, name, input.vector, `${indent}  `, effectiveAlpha(layer));
    return `${indent}<group android:name="${xml(`${name}_transform`)}"${transformAttributes(layer)}>\n${element}\n${indent}</group>`;
  };

  const hasGradient = layers.some((layer) => layer.fillGradient);
  const body = (children.get(null) ?? []).map((layer) => render(layer, 1)).join("\n");
  const vectorXml = `<vector xmlns:android="http://schemas.android.com/apk/res/android"${hasGradient ? `\n    xmlns:aapt="http://schemas.android.com/aapt"` : ""}
    android:name="${resourceName}"
    android:width="${number(input.vector.width)}${xml(input.vector.widthUnit ?? "dp")}"
    android:height="${number(input.vector.height)}${xml(input.vector.heightUnit ?? "dp")}"
    android:viewportWidth="${number(input.vector.viewportWidth ?? input.vector.width)}"
    android:viewportHeight="${number(input.vector.viewportHeight ?? input.vector.height)}"
    android:alpha="${number(input.vector.alpha ?? 1)}"${
      input.vector.tint
        ? `
    android:tint="${xml(androidColor(input.vector.tint))}"`
        : ""
    }${
      input.vector.tintMode
        ? `
    android:tintMode="${xml(input.vector.tintMode)}"`
        : ""
    }${
      input.vector.autoMirrored
        ? `
    android:autoMirrored="true"`
        : ""
    }>
${body}
</vector>\n`;
  const files: AndroidAssetFile[] = [
    { path: `res/drawable/${resourceName}_vector.xml`, content: vectorXml },
  ];

  const expandedBlocks: Array<{
    block: TimelineBlock;
    propertyName: string;
    valueMultiplier?: number;
  }> = [];
  const animatedPropertiesByLayer = new Map<string, Set<string>>();
  for (const block of input.animation.blocks) {
    const layerId = String(block.layerId);
    const properties = animatedPropertiesByLayer.get(layerId) ?? new Set<string>();
    properties.add(block.propertyName);
    animatedPropertiesByLayer.set(layerId, properties);
  }
  for (const block of input.animation.blocks) {
    const layer = byId.get(String(block.layerId));
    if (!layer) {
      diagnostics.push({
        severity: "warning",
        code: "TARGET_NOT_EXPORTED",
        message: "Animation target is hidden or missing and was skipped.",
        layerId: String(block.layerId),
        propertyName: block.propertyName,
      });
      continue;
    }
    if (layer.type === "clipPath" && block.propertyName !== "pathData") {
      diagnostics.push({
        severity: "warning",
        code: "CLIP_PROPERTY_UNSUPPORTED",
        message: "Android clip paths can only animate pathData.",
        layerId: String(layer.id),
        propertyName: block.propertyName,
      });
      continue;
    }
    const animationBlock = transformedClipPathBlock(block, layer);
    if (block.propertyName === "alpha" && layer.type === "path") {
      const properties = animatedPropertiesByLayer.get(String(layer.id));
      if (properties?.has("fillAlpha") || properties?.has("strokeAlpha")) {
        diagnostics.push({
          severity: "error",
          code: "ALPHA_TRACK_COMBINATION_UNSUPPORTED",
          message:
            "A path cannot export simultaneous alpha and fill/stroke-alpha tracks without changing their multiplied timing.",
          layerId: String(layer.id),
          propertyName: block.propertyName,
        });
        continue;
      }
      const parentAlpha = inheritedAlpha(layer);
      expandedBlocks.push({
        block: animationBlock,
        propertyName: "fillAlpha",
        valueMultiplier: parentAlpha * Math.max(0, Math.min(1, layer.fillAlpha ?? 1)),
      });
      if (layer.strokeColor && layer.strokeColor !== "none")
        expandedBlocks.push({
          block: animationBlock,
          propertyName: "strokeAlpha",
          valueMultiplier: parentAlpha * Math.max(0, Math.min(1, layer.strokeAlpha ?? 1)),
        });
      continue;
    }
    if (block.propertyName === "alpha") {
      diagnostics.push({
        severity: "warning",
        code: "GROUP_ALPHA_UNSUPPORTED",
        message:
          "Android VectorDrawable groups do not expose alpha; animate child path alpha instead.",
        layerId: String(layer.id),
        propertyName: block.propertyName,
      });
      continue;
    }
    if (!PATH_PROPERTIES.has(block.propertyName) && !TRANSFORM_PROPERTIES.has(block.propertyName)) {
      diagnostics.push({
        severity: "warning",
        code: "PROPERTY_UNSUPPORTED",
        message: `Android VectorDrawable does not support ${block.propertyName}.`,
        layerId: String(layer.id),
        propertyName: block.propertyName,
      });
      continue;
    }
    const trackCapability = TRACK_CAPABILITY_BY_PROPERTY[block.propertyName];
    const capability = trackCapability ? capabilityFor("avd", trackCapability) : undefined;
    if (capability && !capability.supported) {
      diagnostics.push({
        severity: trackCapability === "trimPath" ? "error" : "warning",
        code: "UNSUPPORTED_TRACK_FOR_FORMAT",
        message:
          `AnimatedVectorDrawable cannot represent animated ${block.propertyName}. ${capability.note ?? ""}`.trim(),
        layerId: String(layer.id),
        propertyName: block.propertyName,
      });
      continue;
    }
    if (TRANSFORM_PROPERTIES.has(block.propertyName) && layer.type === "clipPath") {
      diagnostics.push({
        severity: "warning",
        code: "CLIP_TRANSFORM_UNSUPPORTED",
        message: "Clip path transforms require a parent group and were skipped.",
        layerId: String(layer.id),
        propertyName: block.propertyName,
      });
      continue;
    }
    if (PATH_PROPERTIES.has(block.propertyName) && layer.type === "group") {
      diagnostics.push({
        severity: "warning",
        code: "PATH_PROPERTY_ON_GROUP",
        message: `${block.propertyName} can only animate a path.`,
        layerId: String(layer.id),
        propertyName: block.propertyName,
      });
      continue;
    }
    if (layer.fillGradient && block.propertyName === "fillColor") {
      diagnostics.push({
        severity: "warning",
        code: "ANIMATED_GRADIENT_UNSUPPORTED",
        message: `Animated gradient colors are not supported; the static gradient remains ${dominantColor(layer.fillGradient)}.`,
        layerId: String(layer.id),
        propertyName: block.propertyName,
      });
      continue;
    }
    expandedBlocks.push({
      block: animationBlock,
      propertyName: block.propertyName,
      valueMultiplier:
        block.propertyName === "fillAlpha" || block.propertyName === "strokeAlpha"
          ? effectiveAlpha(layer)
          : undefined,
    });
  }

  const tracks = new Map<
    string,
    Array<{ block: TimelineBlock; propertyName: string; valueMultiplier?: number }>
  >();
  for (const entry of expandedBlocks) {
    const key = `${String(entry.block.layerId)}\u0000${entry.propertyName}`;
    tracks.set(key, [...(tracks.get(key) ?? []), entry]);
  }
  const targets: Array<{ name: string; animator: string }> = [];
  const customInterpolators = new Map<string, string>();
  const resolveInterpolator = (value: string | undefined): string => {
    if (!value) return "@android:anim/accelerate_decelerate_interpolator";
    const platform = platformInterpolator(value);
    if (platform) return platform;
    if (value.startsWith("@android:")) return value;
    if (value.startsWith("@")) {
      diagnostics.push({
        severity: "warning",
        code: "INTERPOLATOR_RESOURCE_UNRESOLVED",
        message: `Interpolator resource ${value} is not bundled with this export; Android accelerate_decelerate was used.`,
      });
      return "@android:anim/accelerate_decelerate_interpolator";
    }
    const bezier = customBezier(value);
    if (!bezier) {
      diagnostics.push({
        severity: "warning",
        code: "INTERPOLATOR_FALLBACK",
        message: `Interpolator ${value || "FAST_OUT_SLOW_IN"} cannot be emitted exactly; Android fast_out_slow_in was used.`,
      });
      return "@android:interpolator/fast_out_slow_in";
    }
    const existing = customInterpolators.get(value!);
    if (existing) return `@interpolator/${existing}`;
    const name = androidResourceName(`${resourceName}_easing_${customInterpolators.size + 1}`);
    customInterpolators.set(value!, name);
    files.push({
      path: `res/interpolator/${name}.xml`,
      content: `<pathInterpolator xmlns:android="http://schemas.android.com/apk/res/android" android:controlX1="${number(bezier[0])}" android:controlY1="${number(bezier[1])}" android:controlX2="${number(bezier[2])}" android:controlY2="${number(bezier[3])}" />\n`,
    });
    return `@interpolator/${name}`;
  };
  for (const entries of tracks.values()) {
    const first = entries[0]!;
    const layer = byId.get(String(first.block.layerId))!;
    const layerName = names.get(String(layer.id))!;
    const targetName =
      TRANSFORM_PROPERTIES.has(first.propertyName) && transformWrapperLayerIds.has(String(layer.id))
        ? `${layerName}_transform`
        : layerName;
    const animatorName = androidResourceName(`${resourceName}_${layerName}_${first.propertyName}`);
    const animators = [...entries]
      .sort((a, b) => a.block.startTime - b.block.startTime)
      .flatMap((entry) => {
        const rendered = objectAnimator(
          entry.block,
          entry.propertyName,
          resolveInterpolator(entry.block.interpolator),
          entry.valueMultiplier,
        );
        if (rendered) return [rendered];
        diagnostics.push({
          severity: "error",
          code: "INCOMPATIBLE_PATH_MORPH",
          message:
            "Path morph commands are incompatible. Run Prepare for morph before Android export.",
          layerId: String(entry.block.layerId),
          propertyName: entry.propertyName,
        });
        return [];
      });
    if (animators.length === 0) continue;
    files.push({
      path: `res/animator/${animatorName}.xml`,
      content: `<set xmlns:android="http://schemas.android.com/apk/res/android" android:ordering="together">\n${animators.join("\n")}\n</set>\n`,
    });
    targets.push({ name: targetName, animator: animatorName });
  }

  if (targets.length > 0) {
    const avd = `<animated-vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:drawable="@drawable/${resourceName}_vector">
${targets.map((target) => `  <target android:name="${xml(target.name)}" android:animation="@animator/${target.animator}" />`).join("\n")}
</animated-vector>\n`;
    files.push({ path: `res/drawable/${resourceName}_animated.xml`, content: avd });
  } else if (input.animation.blocks.length > 0) {
    diagnostics.push({
      severity: "error",
      code: "NO_ANDROID_ANIMATIONS",
      message: "No compatible Android animation tracks could be compiled.",
    });
  }

  const requiresApi24 = hasGradient || layers.some((layer) => layer.fillType === "evenOdd");
  for (const layer of layers) {
    if (layer.strokeDasharray) {
      diagnostics.push({
        severity: "warning",
        code: "STROKE_DASHARRAY_UNSUPPORTED",
        message:
          "Android VectorDrawable does not support stroke dash arrays; the dash pattern was omitted.",
        layerId: String(layer.id),
      });
    }
  }
  diagnostics.push({
    severity: "info",
    code: "ANDROID_MIN_SDK",
    message: requiresApi24
      ? "Gradient vectors and evenOdd fills require Android API 24 or newer."
      : "VectorDrawable output supports Android API 21 or newer.",
  });
  return { resourceName, files, diagnostics };
}
