import { parsePath } from "./pathUtils";
import type { FillType, Layer, PathData, Point, StrokeLineCap, StrokeLineJoin } from "./types";

// ── 2D affine transform matrix [a, b, c, d, e, f] ──────────────────────

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiplyMatrices(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function transformPoint(m: Matrix, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

function isIdentity(m: Matrix) {
  return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
}

function parseSvgTransform(attr: string): Matrix {
  let result: Matrix = [...IDENTITY];
  const re = /(\w+)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(attr)) !== null) {
    const nums = match[2].split(/[\s,]+/).map(Number);
    let m: Matrix;
    switch (match[1]) {
      case "translate":
        m = [1, 0, 0, 1, nums[0] ?? 0, nums[1] ?? 0];
        break;
      case "scale": {
        const sx = nums[0] ?? 1;
        m = [sx, 0, 0, nums[1] ?? sx, 0, 0];
        break;
      }
      case "rotate": {
        const a = ((nums[0] ?? 0) * Math.PI) / 180;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        const rot: Matrix = [cos, sin, -sin, cos, 0, 0];
        if (nums.length >= 3) {
          const cx = nums[1];
          const cy = nums[2];
          m = multiplyMatrices(multiplyMatrices([1, 0, 0, 1, cx, cy], rot), [1, 0, 0, 1, -cx, -cy]);
        } else {
          m = rot;
        }
        break;
      }
      case "skewX": {
        m = [1, 0, Math.tan(((nums[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      }
      case "skewY": {
        m = [1, Math.tan(((nums[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
      }
      case "matrix":
        m = [nums[0] ?? 1, nums[1] ?? 0, nums[2] ?? 0, nums[3] ?? 1, nums[4] ?? 0, nums[5] ?? 0];
        break;
      default:
        continue;
    }
    result = multiplyMatrices(result, m);
  }
  return result;
}

/** Walk up the DOM collecting ancestor transforms and return the combined matrix. */
function getAccumulatedTransform(element: Element): Matrix {
  const chain: Matrix[] = [];
  let el: Element | null = element;
  while (el) {
    const attr = el.getAttribute("transform");
    if (attr) chain.unshift(parseSvgTransform(attr));
    el = el.parentElement;
  }
  let result: Matrix = [...IDENTITY];
  for (const m of chain) result = multiplyMatrices(result, m);
  return result;
}

/** Apply an affine transform to every point in a PathData. */
function transformPathData(path: PathData, matrix: Matrix): PathData {
  if (isIdentity(matrix)) return path;
  const sx = Math.sqrt(matrix[0] * matrix[0] + matrix[1] * matrix[1]);
  const sy = Math.sqrt(matrix[2] * matrix[2] + matrix[3] * matrix[3]);
  const det = matrix[0] * matrix[3] - matrix[1] * matrix[2];
  const rotDeg = (Math.atan2(matrix[1], matrix[0]) * 180) / Math.PI;

  return {
    subPaths: path.subPaths.map((sp) => ({
      commands: sp.commands.map((cmd) => ({
        ...cmd,
        points: cmd.points.map((p) => transformPoint(matrix, p)),
        arcParams: cmd.arcParams
          ? {
              rx: (cmd.arcParams.rx ?? 0) * sx,
              ry: (cmd.arcParams.ry ?? 0) * sy,
              xRotation: (cmd.arcParams.xRotation ?? (cmd.arcParams as any).rotation ?? 0) + rotDeg,
              largeArc: cmd.arcParams.largeArc,
              sweep: det < 0 ? !cmd.arcParams.sweep : cmd.arcParams.sweep,
            }
          : undefined,
      })),
    })),
  };
}

// ── Shape-to-path converters ────────────────────────────────────────────

const pathFromRect = (element: Element) => {
  const x = Number(element.getAttribute("x") ?? 0);
  const y = Number(element.getAttribute("y") ?? 0);
  const width = Number(element.getAttribute("width") ?? 0);
  const height = Number(element.getAttribute("height") ?? 0);
  return `M ${x} ${y} L ${x + width} ${y} L ${x + width} ${y + height} L ${x} ${y + height} Z`;
};

const pathFromCircle = (element: Element) => {
  const cx = Number(element.getAttribute("cx") ?? 0);
  const cy = Number(element.getAttribute("cy") ?? 0);
  const rx = Number(element.getAttribute("r") ?? element.getAttribute("rx") ?? 0);
  const ry = Number(element.getAttribute("r") ?? element.getAttribute("ry") ?? rx);
  const k = 0.552284749831;
  return [
    `M ${cx + rx} ${cy}`,
    `C ${cx + rx} ${cy + ry * k} ${cx + rx * k} ${cy + ry} ${cx} ${cy + ry}`,
    `C ${cx - rx * k} ${cy + ry} ${cx - rx} ${cy + ry * k} ${cx - rx} ${cy}`,
    `C ${cx - rx} ${cy - ry * k} ${cx - rx * k} ${cy - ry} ${cx} ${cy - ry}`,
    `C ${cx + rx * k} ${cy - ry} ${cx + rx} ${cy - ry * k} ${cx + rx} ${cy}`,
    "Z",
  ].join(" ");
};

const pathFromLine = (element: Element) => {
  const x1 = Number(element.getAttribute("x1") ?? 0);
  const y1 = Number(element.getAttribute("y1") ?? 0);
  const x2 = Number(element.getAttribute("x2") ?? 0);
  const y2 = Number(element.getAttribute("y2") ?? 0);
  return `M ${x1} ${y1} L ${x2} ${y2}`;
};

const pathFromPoints = (element: Element, close: boolean) => {
  const points = (element.getAttribute("points") ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((value) => Number.isFinite(value));
  if (points.length < 2) return "";
  const commands = [`M ${points[0]} ${points[1]}`];
  for (let index = 2; index + 1 < points.length; index += 2) {
    commands.push(`L ${points[index]} ${points[index + 1]}`);
  }
  if (close) commands.push("Z");
  return commands.join(" ");
};

// ── Style extraction (attributes + inline CSS `style` attribute) ────────

function getStyle(element: Element) {
  // Parse inline style attribute into a lookup map
  const inlineStyle = new Map<string, string>();
  const styleAttr = element.getAttribute("style");
  if (styleAttr) {
    for (const decl of styleAttr.split(";")) {
      const [prop, ...rest] = decl.split(":");
      if (prop && rest.length) {
        inlineStyle.set(prop.trim().toLowerCase(), rest.join(":").trim());
      }
    }
  }

  // Helper: inline style takes priority over presentational attribute
  const get = (name: string) => inlineStyle.get(name) ?? element.getAttribute(name) ?? "";

  const fill = get("fill");
  const stroke = get("stroke");
  const fillOpacity = Number(get("fill-opacity") || 1);
  const strokeOpacity = Number(get("stroke-opacity") || 1);
  const strokeWidth = Number(get("stroke-width") || 0);
  return {
    fillColor: fill === "none" ? "" : fill,
    fillAlpha: Number.isFinite(fillOpacity) ? fillOpacity : 1,
    strokeColor: stroke === "none" ? "" : stroke,
    strokeAlpha: Number.isFinite(strokeOpacity) ? strokeOpacity : 1,
    strokeWidth: Number.isFinite(strokeWidth) ? strokeWidth : 0,
    strokeLinecap: (get("stroke-linecap") || "butt") as StrokeLineCap,
    strokeLinejoin: (get("stroke-linejoin") || "miter") as StrokeLineJoin,
    strokeMiterLimit: Number(get("stroke-miterlimit") || 4),
    fillType: ((get("fill-rule") || "nonzero") === "evenodd" ? "evenOdd" : "nonZero") as FillType,
  };
}

function layerFromPathData(name: string, pathData: string, id: string, matrix: Matrix, style = {}) {
  let parsed = parsePath(pathData);
  parsed = transformPathData(parsed, matrix);
  return {
    id,
    name,
    type: "path",
    from: parsed,
    to: parsed,
    pathData: parsed,
    visible: true,
    locked: false,
    ...style,
  } satisfies Layer;
}

/** Check if an element is inside a <defs>, <symbol>, or <clipPath> (not directly renderable). */
function isInsideDefs(el: Element): boolean {
  let parent = el.parentElement;
  while (parent) {
    const tag = parent.tagName.toLowerCase();
    if (tag === "defs" || tag === "symbol" || tag === "clippath") return true;
    parent = parent.parentElement;
  }
  return false;
}

export function importLayersFromSvg(svgText: string, namePrefix = "svg") {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");

  // ── Resolve <use> references ──
  for (const use of Array.from(doc.querySelectorAll("use"))) {
    const href =
      use.getAttribute("href") ?? use.getAttributeNS("http://www.w3.org/1999/xlink", "href") ?? "";
    if (!href.startsWith("#")) continue;
    const referenced = doc.getElementById(href.slice(1));
    if (!referenced) continue;

    // Clone the referenced subtree
    const clone = referenced.cloneNode(true) as Element;
    clone.removeAttribute("id"); // avoid duplicate IDs

    // Apply <use> x/y as a translate, and copy the use element's transform
    const ux = use.getAttribute("x");
    const uy = use.getAttribute("y");
    const existingTransform = use.getAttribute("transform") ?? "";
    const offset = ux || uy ? `translate(${ux ?? 0}, ${uy ?? 0})` : "";
    const combined = `${existingTransform} ${offset}`.trim();

    // Wrap in a <g> with the combined transform and insert in place of <use>
    const wrapper = doc.createElementNS("http://www.w3.org/2000/svg", "g");
    if (combined) wrapper.setAttribute("transform", combined);
    wrapper.appendChild(clone);
    use.parentNode?.replaceChild(wrapper, use);
  }

  const elements = Array.from(
    doc.querySelectorAll("path, rect, circle, ellipse, line, polygon, polyline"),
  ).filter((el) => !isInsideDefs(el));

  return elements.flatMap((element, index) => {
    try {
      const tag = element.tagName.toLowerCase();
      const pathData =
        tag === "path"
          ? (element.getAttribute("d") ?? "")
          : tag === "rect"
            ? pathFromRect(element)
            : tag === "circle" || tag === "ellipse"
              ? pathFromCircle(element)
              : tag === "line"
                ? pathFromLine(element)
                : tag === "polygon"
                  ? pathFromPoints(element, true)
                  : pathFromPoints(element, false);

      if (!pathData.trim()) return [];
      const name = element.getAttribute("id") || `${namePrefix}_${tag}_${index + 1}`;
      const matrix = getAccumulatedTransform(element);
      const layer = layerFromPathData(
        name,
        pathData,
        `${Date.now()}_${index}`,
        matrix,
        getStyle(element),
      );
      // Harden: skip any layer whose parsed geometry contains non-finite coords (bad path data, NaN from malformed arcs/nums, complex edge cases)
      const hasNaN = layer.from.subPaths.some((sp) =>
        sp.commands.some(
          (c) =>
            c.points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)) ||
            (c.arcParams &&
              (!Number.isFinite(c.arcParams.rx) ||
                !Number.isFinite(c.arcParams.ry) ||
                !Number.isFinite(c.arcParams.xRotation))),
        ),
      );
      if (hasNaN) return [];
      return [layer];
    } catch {
      // Graceful fallback: never crash on bad element in pro SVG (partial load recovery)
      return [];
    }
  });
}

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
  const emptyPath = parsePath("");

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
  const parsed = parsePath(pathData);
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
  const parsed = parsePath(pathData);
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
