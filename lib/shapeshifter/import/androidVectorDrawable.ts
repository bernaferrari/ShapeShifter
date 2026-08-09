import { ensureStableCommandIds, parsePath } from "../pathUtils";
import type { FillType, Layer, StrokeLineCap, StrokeLineJoin } from "../types";

export interface VectorDrawableImportResult {
  layers: Layer[];
  viewportWidth: number;
  viewportHeight: number;
  width: number;
  height: number;
}

function vdAttr(el: Element, name: string, fallback = ""): string {
  return el.getAttribute(`android:${name}`) ?? el.getAttribute(name) ?? fallback;
}

function parseVdGroup(groupEl: Element, parentId: string | null, counter: { n: number }): Layer[] {
  const layers: Layer[] = [];
  const groupId = `vd_${Date.now()}_g${counter.n++}`;
  const name = vdAttr(groupEl, "name", `group_${counter.n}`);
  const emptyPath = ensureStableCommandIds(parsePath(""));

  layers.push({
    id: groupId,
    name,
    type: "group",
    from: emptyPath,
    to: emptyPath,
    visible: true,
    locked: false,
    parentId,
    rotation: Number(vdAttr(groupEl, "rotation", "0")),
    scaleX: Number(vdAttr(groupEl, "scaleX", "1")),
    scaleY: Number(vdAttr(groupEl, "scaleY", "1")),
    pivotX: Number(vdAttr(groupEl, "pivotX", "0")),
    pivotY: Number(vdAttr(groupEl, "pivotY", "0")),
    translateX: Number(vdAttr(groupEl, "translateX", "0")),
    translateY: Number(vdAttr(groupEl, "translateY", "0")),
  } satisfies Layer);

  for (const child of Array.from(groupEl.children)) {
    const tag = child.tagName.toLowerCase().replace(/.*:/, "");
    if (tag === "path") {
      const l = parseVdPath(child, groupId, counter);
      if (l) layers.push(l);
    } else if (tag === "clip-path") {
      const l = parseVdClipPath(child, groupId, counter);
      if (l) layers.push(l);
    } else if (tag === "group") {
      layers.push(...parseVdGroup(child, groupId, counter));
    }
  }

  return layers;
}

function parseVdPath(el: Element, parentId: string | null, counter: { n: number }): Layer | null {
  const pathData = vdAttr(el, "pathData");
  if (!pathData.trim()) return null;
  let parsed = parsePath(pathData);
  parsed = ensureStableCommandIds(parsed);
  return {
    id: `vd_${Date.now()}_p${counter.n++}`,
    name: vdAttr(el, "name", `path_${counter.n}`),
    type: "path",
    from: parsed,
    to: parsed,
    pathData: parsed,
    visible: true,
    locked: false,
    parentId,
    fillColor: vdAttr(el, "fillColor"),
    fillAlpha: Number(vdAttr(el, "fillAlpha", "1")),
    strokeColor: vdAttr(el, "strokeColor"),
    strokeAlpha: Number(vdAttr(el, "strokeAlpha", "1")),
    strokeWidth: Number(vdAttr(el, "strokeWidth", "0")),
    strokeLinecap: vdAttr(el, "strokeLineCap", "butt") as StrokeLineCap,
    strokeLinejoin: vdAttr(el, "strokeLineJoin", "miter") as StrokeLineJoin,
    strokeMiterLimit: Number(vdAttr(el, "strokeMiterLimit", "4")),
    trimPathStart: Number(vdAttr(el, "trimPathStart", "0")),
    trimPathEnd: Number(vdAttr(el, "trimPathEnd", "1")),
    trimPathOffset: Number(vdAttr(el, "trimPathOffset", "0")),
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
  return {
    id: `vd_${Date.now()}_cp${counter.n++}`,
    name: vdAttr(el, "name", `clip_${counter.n}`),
    type: "clipPath",
    from: parsed,
    to: parsed,
    pathData: parsed,
    visible: true,
    locked: false,
    parentId,
  } satisfies Layer;
}

export function importLayersFromVectorDrawable(xmlText: string): Layer[] {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const root = doc.documentElement;
  const counter = { n: 0 };
  const layers: Layer[] = [];

  // Walk direct children of <vector> (groups, paths, clip-paths)
  for (const child of Array.from(root.children)) {
    const tag = child.tagName.toLowerCase().replace(/.*:/, "");
    if (tag === "group") {
      layers.push(...parseVdGroup(child, null, counter));
    } else if (tag === "path") {
      const l = parseVdPath(child, null, counter);
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
      const l = parseVdPath(el, null, counter);
      if (l) layers.push(l);
    }
  }

  return layers;
}

/** Extract viewport metadata from a VectorDrawable root element. */
export function extractVectorDrawableMetadata(xmlText: string): {
  viewportWidth: number;
  viewportHeight: number;
  width: number;
  height: number;
} {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const root = doc.documentElement;
  return {
    viewportWidth: Number(vdAttr(root, "viewportWidth", "24")),
    viewportHeight: Number(vdAttr(root, "viewportHeight", "24")),
    width: parseInt(vdAttr(root, "width", "24"), 10),
    height: parseInt(vdAttr(root, "height", "24"), 10),
  };
}
