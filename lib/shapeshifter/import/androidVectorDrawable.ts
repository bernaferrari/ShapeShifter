import { ensureStableCommandIds, parsePath } from "../pathUtils";
import type { FillType, Gradient, Layer, StrokeLineCap, StrokeLineJoin } from "../types";
import { androidToCssHexColor } from "../mathUtils";

export interface VectorDrawableImportResult {
  layers: Layer[];
  viewportWidth: number;
  viewportHeight: number;
  width: number;
  height: number;
  widthUnit?: string;
  heightUnit?: string;
  alpha: number;
  tint?: string;
  tintMode?: string;
  autoMirrored?: boolean;
  minSdk: number;
}

function vdAttr(el: Element, name: string, fallback = ""): string {
  return el.getAttribute(`android:${name}`) ?? el.getAttribute(name) ?? fallback;
}

function editorColor(value: string): string {
  if (!value || value.startsWith("@") || value.startsWith("?")) return value;
  return androidToCssHexColor(value);
}

function numberAttribute(value: string, fallback: number) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function dimensionAttribute(value: string, fallback: number): { value: number; unit?: string } {
  const match = value.trim().match(/^([-+]?(?:\d*\.)?\d+)([a-zA-Z]+)?$/);
  if (!match) return { value: fallback };
  return { value: numberAttribute(match[1], fallback), unit: match[2] };
}

function parseVdGroup(
  groupEl: Element,
  parentId: string | null,
  counter: { n: number },
  viewportWidth = 24,
  viewportHeight = 24,
): Layer[] {
  const layers: Layer[] = [];
  const groupId = `vd_${Date.now()}_g${counter.n++}`;
  const name = vdAttr(groupEl, "name", `group_${counter.n}`);
  const emptyPath = ensureStableCommandIds(parsePath(""));

  layers.push({
    id: groupId,
    name,
    androidName: name,
    type: "group",
    from: emptyPath,
    to: emptyPath,
    visible: true,
    locked: false,
    parentId,
    rotation: numberAttribute(vdAttr(groupEl, "rotation", "0"), 0),
    scaleX: numberAttribute(vdAttr(groupEl, "scaleX", "1"), 1),
    scaleY: numberAttribute(vdAttr(groupEl, "scaleY", "1"), 1),
    pivotX: numberAttribute(vdAttr(groupEl, "pivotX", "0"), 0),
    pivotY: numberAttribute(vdAttr(groupEl, "pivotY", "0"), 0),
    translateX: numberAttribute(vdAttr(groupEl, "translateX", "0"), 0),
    translateY: numberAttribute(vdAttr(groupEl, "translateY", "0"), 0),
  } satisfies Layer);

  for (const child of Array.from(groupEl.children)) {
    const tag = child.tagName.toLowerCase().replace(/.*:/, "");
    if (tag === "path") {
      const l = parseVdPath(child, groupId, counter, viewportWidth, viewportHeight);
      if (l) layers.push(l);
    } else if (tag === "clip-path") {
      const l = parseVdClipPath(child, groupId, counter);
      if (l) layers.push(l);
    } else if (tag === "group") {
      layers.push(...parseVdGroup(child, groupId, counter, viewportWidth, viewportHeight));
    }
  }

  return layers;
}

function localName(el: Element): string {
  return el.tagName.toLowerCase().replace(/.*:/, "");
}

function parseAaptGradient(
  el: Element,
  viewportWidth: number,
  viewportHeight: number,
): Gradient | undefined {
  const gradientEl = Array.from(el.getElementsByTagName("*")).find(
    (candidate) => localName(candidate) === "gradient",
  );
  if (!gradientEl) return undefined;
  const stops = Array.from(gradientEl.children)
    .filter((child) => localName(child) === "item")
    .map((item) => ({
      offset: numberAttribute(vdAttr(item, "offset", "0"), 0),
      color: editorColor(vdAttr(item, "color")) || "#000000",
      opacity: 1,
    }));
  if (stops.length < 2) return undefined;
  const type = vdAttr(gradientEl, "type", "linear") === "radial" ? "radial" : "linear";
  const width = viewportWidth || 1;
  const height = viewportHeight || 1;
  if (type === "radial") {
    return {
      type: "radial",
      coordinateSpace: "userSpace",
      cx: numberAttribute(vdAttr(gradientEl, "centerX", String(width / 2)), width / 2),
      cy: numberAttribute(vdAttr(gradientEl, "centerY", String(height / 2)), height / 2),
      r: numberAttribute(
        vdAttr(gradientEl, "gradientRadius", String(Math.max(width, height) / 2)),
        Math.max(width, height) / 2,
      ),
      stops,
    };
  }
  return {
    type: "linear",
    coordinateSpace: "userSpace",
    x1: numberAttribute(vdAttr(gradientEl, "startX", "0"), 0),
    y1: numberAttribute(vdAttr(gradientEl, "startY", "0"), 0),
    x2: numberAttribute(vdAttr(gradientEl, "endX", "1"), 1),
    y2: numberAttribute(vdAttr(gradientEl, "endY", "0"), 0),
    stops,
  };
}

function parseVdPath(
  el: Element,
  parentId: string | null,
  counter: { n: number },
  viewportWidth = 24,
  viewportHeight = 24,
): Layer | null {
  const pathData = vdAttr(el, "pathData");
  if (!pathData.trim()) return null;
  let parsed = parsePath(pathData);
  parsed = ensureStableCommandIds(parsed);
  const name = vdAttr(el, "name", `path_${counter.n}`);
  const fillGradient = parseAaptGradient(el, viewportWidth, viewportHeight);
  return {
    id: `vd_${Date.now()}_p${counter.n++}`,
    name,
    androidName: name,
    type: "path",
    from: parsed,
    to: parsed,
    pathData: parsed,
    visible: true,
    locked: false,
    parentId,
    fillColor: fillGradient ? undefined : editorColor(vdAttr(el, "fillColor")),
    fillGradient,
    fillAlpha: numberAttribute(vdAttr(el, "fillAlpha", "1"), 1),
    strokeColor: editorColor(vdAttr(el, "strokeColor")),
    strokeAlpha: numberAttribute(vdAttr(el, "strokeAlpha", "1"), 1),
    strokeWidth: numberAttribute(vdAttr(el, "strokeWidth", "0"), 0),
    strokeLinecap: vdAttr(el, "strokeLineCap", "butt") as StrokeLineCap,
    strokeLinejoin: vdAttr(el, "strokeLineJoin", "miter") as StrokeLineJoin,
    strokeMiterLimit: numberAttribute(vdAttr(el, "strokeMiterLimit", "4"), 4),
    trimPathStart: numberAttribute(vdAttr(el, "trimPathStart", "0"), 0),
    trimPathEnd: numberAttribute(vdAttr(el, "trimPathEnd", "1"), 1),
    trimPathOffset: numberAttribute(vdAttr(el, "trimPathOffset", "0"), 0),
    fillType: (vdAttr(el, "fillType") === "evenOdd" ? "evenOdd" : "nonZero") as FillType,
  } satisfies Layer;
}

function parseVdClipPath(
  el: Element,
  parentId: string | null,
  counter: { n: number },
): Layer | null {
  const pathData = vdAttr(el, "pathData");
  if (!pathData.trim()) return null;
  let parsed = parsePath(pathData);
  parsed = ensureStableCommandIds(parsed);
  const name = vdAttr(el, "name", `clip_${counter.n}`);
  return {
    id: `vd_${Date.now()}_cp${counter.n++}`,
    name,
    androidName: name,
    type: "clipPath",
    from: parsed,
    to: parsed,
    pathData: parsed,
    visible: true,
    locked: false,
    parentId,
    fillType: (vdAttr(el, "fillType") === "evenOdd" ? "evenOdd" : "nonZero") as FillType,
  } satisfies Layer;
}

export function importLayersFromVectorDrawable(xmlText: string): Layer[] {
  return importVectorDrawable(xmlText).layers;
}

/** Parse one Android VectorDrawable into editable layers plus root metadata. */
export function importVectorDrawable(xmlText: string): VectorDrawableImportResult {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) {
    return {
      layers: [],
      viewportWidth: 24,
      viewportHeight: 24,
      width: 24,
      height: 24,
      alpha: 1,
      minSdk: 21,
    };
  }
  const root = doc.documentElement;
  if (root.tagName.toLowerCase().replace(/.*:/, "") !== "vector") {
    return {
      layers: [],
      viewportWidth: 24,
      viewportHeight: 24,
      width: 24,
      height: 24,
      alpha: 1,
      minSdk: 21,
    };
  }
  const counter = { n: 0 };
  const layers: Layer[] = [];
  const metadata = extractVectorDrawableMetadata(xmlText);

  // Walk direct children of <vector> (groups, paths, clip-paths)
  for (const child of Array.from(root.children)) {
    const tag = child.tagName.toLowerCase().replace(/.*:/, "");
    if (tag === "group") {
      layers.push(
        ...parseVdGroup(child, null, counter, metadata.viewportWidth, metadata.viewportHeight),
      );
    } else if (tag === "path") {
      const l = parseVdPath(child, null, counter, metadata.viewportWidth, metadata.viewportHeight);
      if (l) layers.push(l);
    } else if (tag === "clip-path") {
      const l = parseVdClipPath(child, null, counter);
      if (l) layers.push(l);
    }
  }

  // Fallback: if no layers found from tree walk, try flat query
  if (layers.length === 0) {
    const paths = Array.from(doc.querySelectorAll("path"));
    for (const el of paths) {
      const l = parseVdPath(el, null, counter, metadata.viewportWidth, metadata.viewportHeight);
      if (l) layers.push(l);
    }
  }

  return { layers, ...metadata };
}

/** Extract viewport metadata from a VectorDrawable root element. */
export function extractVectorDrawableMetadata(xmlText: string): {
  viewportWidth: number;
  viewportHeight: number;
  width: number;
  height: number;
  alpha: number;
  widthUnit?: string;
  heightUnit?: string;
  tint?: string;
  tintMode?: string;
  autoMirrored?: boolean;
  minSdk: number;
} {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const root = doc.documentElement;
  const width = dimensionAttribute(vdAttr(root, "width", "24dp"), 24);
  const height = dimensionAttribute(vdAttr(root, "height", "24dp"), 24);
  return {
    viewportWidth: numberAttribute(vdAttr(root, "viewportWidth", "24"), 24),
    viewportHeight: numberAttribute(vdAttr(root, "viewportHeight", "24"), 24),
    width: width.value,
    height: height.value,
    widthUnit: width.unit,
    heightUnit: height.unit,
    alpha: numberAttribute(vdAttr(root, "alpha", "1"), 1),
    tint: editorColor(vdAttr(root, "tint")) || undefined,
    tintMode: vdAttr(root, "tintMode") || undefined,
    autoMirrored: vdAttr(root, "autoMirrored", "false") === "true",
    minSdk: xmlText.includes("<aapt:attr") || xmlText.includes('fillType="evenOdd"') ? 24 : 21,
  };
}
