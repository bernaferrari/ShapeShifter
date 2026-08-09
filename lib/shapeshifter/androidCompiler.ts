import { dominantColor, linearVector, normalizeStops } from "./gradients";
import { parsePath, pathToString } from "./pathUtils";
import type { AnimationState, Gradient, Layer, TimelineBlock, VectorMetadata } from "./types";

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

function uniqueLayerNames(layers: Layer[]): Map<string, string> {
  const used = new Set<string>();
  const names = new Map<string, string>();
  for (const layer of layers) {
    const base = androidResourceName(layer.name || `layer_${String(layer.id)}`);
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) candidate = `${base}_${suffix++}`;
    used.add(candidate);
    names.set(String(layer.id), candidate);
  }
  return names;
}

function androidColor(color: string | undefined, fallback = "#00000000"): string {
  if (!color || color === "none" || color === "transparent") return fallback;
  return color;
}

function gradientXml(gradient: Gradient, width: number, height: number, alpha: number): string {
  const stops = normalizeStops(gradient.stops);
  const items = stops
    .map((stop) => {
      const stopAlpha = Math.round((stop.opacity ?? 1) * alpha * 255)
        .toString(16)
        .padStart(2, "0");
      const color = stop.color.replace(/^#/, "");
      const expanded =
        color.length === 3
          ? color
              .split("")
              .map((digit) => digit + digit)
              .join("")
          : color.slice(0, 6);
      return `          <item android:offset="${number(stop.offset)}" android:color="#${stopAlpha}${expanded}" />`;
    })
    .join("\n");
  if (gradient.type === "radial") {
    return `<aapt:attr name="android:fillColor">
        <gradient android:type="radial" android:centerX="${number((gradient.cx ?? 0.5) * width)}" android:centerY="${number((gradient.cy ?? 0.5) * height)}" android:gradientRadius="${number((gradient.r ?? 0.5) * Math.max(width, height))}">
${items}
        </gradient>
      </aapt:attr>`;
  }
  const direction = linearVector(gradient.angle ?? 0);
  return `<aapt:attr name="android:fillColor">
        <gradient android:startX="${number(direction.x1 * width)}" android:startY="${number(direction.y1 * height)}" android:endX="${number(direction.x2 * width)}" android:endY="${number(direction.y2 * height)}">
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

function pathElement(layer: Layer, name: string, vector: VectorMetadata, indent: string): string {
  const tag = layer.type === "clipPath" ? "clip-path" : "path";
  const pathData = pathToString(layer.pathData ?? layer.from);
  if (tag === "clip-path") {
    return `${indent}<clip-path android:name="${xml(name)}" android:pathData="${xml(pathData)}" />`;
  }
  const gradient = layer.fillGradient;
  const attributes = [
    `android:name="${xml(name)}"`,
    `android:pathData="${xml(pathData)}"`,
    !gradient ? `android:fillColor="${xml(androidColor(layer.fillColor))}"` : "",
    !gradient ? `android:fillAlpha="${number(layer.fillAlpha ?? 1)}"` : "",
    `android:strokeColor="${xml(androidColor(layer.strokeColor))}"`,
    `android:strokeAlpha="${number(layer.strokeAlpha ?? 1)}"`,
    `android:strokeWidth="${number(layer.strokeWidth ?? 0)}"`,
    `android:strokeLineCap="${layer.strokeLinecap ?? "butt"}"`,
    `android:strokeLineJoin="${layer.strokeLinejoin ?? "miter"}"`,
    `android:strokeMiterLimit="${number(layer.strokeMiterLimit ?? 4)}"`,
    `android:fillType="${layer.fillType === "evenOdd" ? "evenOdd" : "nonZero"}"`,
    `android:trimPathStart="${number(layer.trimPathStart ?? 0)}"`,
    `android:trimPathEnd="${number(layer.trimPathEnd ?? 1)}"`,
    `android:trimPathOffset="${number(layer.trimPathOffset ?? 0)}"`,
  ]
    .filter(Boolean)
    .join(`\n${indent}    `);
  if (!gradient) return `${indent}<path\n${indent}    ${attributes} />`;
  return `${indent}<path\n${indent}    ${attributes}>\n${indent}  ${gradientXml(gradient, vector.width, vector.height, layer.fillAlpha ?? 1)}\n${indent}</path>`;
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

function interpolatorResource(value?: string): string {
  switch (value) {
    case "FAST_OUT_LINEAR_IN":
      return "@android:interpolator/fast_out_linear_in";
    case "LINEAR_OUT_SLOW_IN":
      return "@android:interpolator/linear_out_slow_in";
    case "ACCELERATE_DECELERATE":
      return "@android:anim/accelerate_decelerate_interpolator";
    case "LINEAR":
      return "@android:anim/linear_interpolator";
    default:
      return "@android:interpolator/fast_out_slow_in";
  }
}

function pathSignature(value: string | number): string | null {
  if (typeof value !== "string") return null;
  try {
    return parsePath(value)
      .subPaths.map((subPath) =>
        subPath.commands.map((command) => `${command.type}:${command.points.length}`).join(","),
      )
      .join("|");
  } catch {
    return null;
  }
}

function objectAnimator(block: TimelineBlock, propertyName: string): string | null {
  const valueType =
    propertyName === "pathData"
      ? "pathType"
      : propertyName === "fillColor" || propertyName === "strokeColor"
        ? "colorType"
        : "floatType";
  if (
    propertyName === "pathData" &&
    pathSignature(block.fromValue) !== pathSignature(block.toValue)
  )
    return null;
  return `  <objectAnimator
      android:startOffset="${Math.max(0, Math.round(block.startTime))}"
      android:duration="${Math.max(1, Math.round(block.endTime - block.startTime))}"
      android:propertyName="${propertyName}"
      android:valueFrom="${xml(block.fromValue)}"
      android:valueTo="${xml(block.toValue)}"
      android:valueType="${valueType}"
      android:interpolator="${interpolatorResource(block.interpolator)}" />`;
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
  const names = uniqueLayerNames(layers);
  const transformAnimated = new Set(
    input.animation.blocks
      .filter((block) => TRANSFORM_PROPERTIES.has(block.propertyName))
      .map((block) => String(block.layerId)),
  );
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
    if (!hasTransform(layer) && !transformAnimated.has(String(layer.id))) {
      return pathElement(layer, name, input.vector, indent);
    }
    const element = pathElement(layer, name, input.vector, `${indent}  `);
    return `${indent}<group android:name="${xml(`${name}_transform`)}"${transformAttributes(layer)}>\n${element}\n${indent}</group>`;
  };

  const hasGradient = layers.some((layer) => layer.fillGradient);
  const body = (children.get(null) ?? []).map((layer) => render(layer, 1)).join("\n");
  const vectorXml = `<vector xmlns:android="http://schemas.android.com/apk/res/android"${hasGradient ? `\n    xmlns:aapt="http://schemas.android.com/aapt"` : ""}
    android:name="${resourceName}"
    android:width="${number(input.vector.width)}dp"
    android:height="${number(input.vector.height)}dp"
    android:viewportWidth="${number(input.vector.width)}"
    android:viewportHeight="${number(input.vector.height)}"
    android:alpha="${number(input.vector.alpha ?? 1)}">
${body}
</vector>\n`;
  const files: AndroidAssetFile[] = [
    { path: `res/drawable/${resourceName}_vector.xml`, content: vectorXml },
  ];

  const expandedBlocks: Array<{ block: TimelineBlock; propertyName: string }> = [];
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
    if (block.propertyName === "alpha" && layer.type === "path") {
      expandedBlocks.push({ block, propertyName: "fillAlpha" });
      if (layer.strokeColor && layer.strokeColor !== "none")
        expandedBlocks.push({ block, propertyName: "strokeAlpha" });
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
    expandedBlocks.push({ block, propertyName: block.propertyName });
  }

  const tracks = new Map<string, Array<{ block: TimelineBlock; propertyName: string }>>();
  for (const entry of expandedBlocks) {
    const key = `${String(entry.block.layerId)}\u0000${entry.propertyName}`;
    tracks.set(key, [...(tracks.get(key) ?? []), entry]);
  }
  const targets: Array<{ name: string; animator: string }> = [];
  for (const entries of tracks.values()) {
    const first = entries[0]!;
    const layer = byId.get(String(first.block.layerId))!;
    const layerName = names.get(String(layer.id))!;
    const targetName =
      TRANSFORM_PROPERTIES.has(first.propertyName) &&
      layer.type !== "group" &&
      layer.type !== "vector"
        ? `${layerName}_transform`
        : layerName;
    const animatorName = androidResourceName(`${resourceName}_${layerName}_${first.propertyName}`);
    const animators = [...entries]
      .sort((a, b) => a.block.startTime - b.block.startTime)
      .flatMap((entry) => {
        const rendered = objectAnimator(entry.block, entry.propertyName);
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

  diagnostics.push({
    severity: "info",
    code: "ANDROID_MIN_SDK",
    message: hasGradient
      ? "Gradient vectors require Android API 24 or newer."
      : "VectorDrawable output supports Android API 21 or newer.",
  });
  return { resourceName, files, diagnostics };
}
