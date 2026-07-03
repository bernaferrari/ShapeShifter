import { parsePath, ensureStableCommandIds } from "./pathUtils";
import { arcToBeziers } from "./geometry";
import type {
  Command,
  FillType,
  Gradient,
  GradientStop,
  Layer,
  PathData,
  Point,
  StrokeLineCap,
  StrokeLineJoin,
} from "./types";

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

/** Apply an affine transform to every point in a PathData.
 *  For conformal matrices (uniform scale + rotation/reflection + translation)
 *  the fast path scales `rx/ry` and rotates `xRotation` in place. For
 *  NON-conformal matrices (non-uniform scale or skew) that path misorients the
 *  ellipse, so arcs are flattened to cubic Bézier segments (via `arcToBeziers`)
 *  in their original coordinate space and the control points are then
 *  transformed — matching how Figma/SVG rasterize arcs under skew. */
function transformPathData(path: PathData, matrix: Matrix): PathData {
  if (isIdentity(matrix)) return path;
  const sx = Math.sqrt(matrix[0] * matrix[0] + matrix[1] * matrix[1]);
  const sy = Math.sqrt(matrix[2] * matrix[2] + matrix[3] * matrix[3]);
  const det = matrix[0] * matrix[3] - matrix[1] * matrix[2];
  const rotDeg = (Math.atan2(matrix[1], matrix[0]) * 180) / Math.PI;

  // Conformal = uniform-scale (+ optional rotation/reflection). Detected via
  // equal column lengths AND orthogonal columns of the upper-left 2×2.
  const EPS = 1e-9;
  const isConformal =
    Math.abs(sx - sy) < EPS && Math.abs(matrix[0] * matrix[2] + matrix[1] * matrix[3]) < EPS;

  if (isConformal) {
    return {
      subPaths: path.subPaths.map((sp) => ({
        commands: sp.commands.map((cmd) => ({
          ...cmd,
          points: cmd.points.map((p) => transformPoint(matrix, p)),
          arcParams: cmd.arcParams
            ? {
                rx: (cmd.arcParams.rx ?? 0) * sx,
                ry: (cmd.arcParams.ry ?? 0) * sy,
                xRotation: (cmd.arcParams.xRotation ?? 0) + rotDeg,
                largeArc: cmd.arcParams.largeArc,
                sweep: det < 0 ? !cmd.arcParams.sweep : cmd.arcParams.sweep,
              }
            : undefined,
        })),
      })),
    };
  }

  // Non-conformal: flatten arcs to Béziers (in original space) and transform.
  return {
    subPaths: path.subPaths.map((sp) => {
      const out: Command[] = [];
      let cur: Point | null = null;
      let start: Point | null = null;
      for (const cmd of sp.commands) {
        if (cmd.type === "A" && cmd.arcParams && cur) {
          const ap = cmd.arcParams;
          const end: Point = cmd.points[cmd.points.length - 1] ?? cur;
          const beziers = arcToBeziers(
            cur.x,
            cur.y,
            ap.rx ?? 0,
            ap.ry ?? 0,
            ap.xRotation ?? 0,
            ap.largeArc ?? false,
            ap.sweep ?? false,
            end.x,
            end.y,
          );
          if (beziers.length === 0) {
            out.push({ id: cmd.id, type: "L", points: [transformPoint(matrix, end)] });
          } else {
            for (const seg of beziers) {
              out.push({
                id: cmd.id,
                type: "C",
                points: [
                  transformPoint(matrix, seg.cp1),
                  transformPoint(matrix, seg.cp2),
                  transformPoint(matrix, seg.to),
                ],
              });
            }
          }
          cur = end;
        } else {
          out.push({ ...cmd, points: cmd.points.map((p) => transformPoint(matrix, p)) });
          if (cmd.type === "M" && cmd.points[0]) {
            cur = cmd.points[0];
            start = cmd.points[0];
          } else if (cmd.type === "Z") {
            cur = start;
          } else if (cmd.points.length > 0) {
            cur = cmd.points[cmd.points.length - 1];
          }
        }
      }
      return { commands: out };
    }),
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

// ── Gradient parsing (objectBoundingBox <linearGradient>/<radialGradient>) ──

const stopOffset = (raw: string): number => {
  if (!raw) return 0;
  const trimmed = raw.trim();
  const n = trimmed.endsWith("%") ? Number(trimmed.slice(0, -1)) / 100 : Number(trimmed);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
};

/** Read a gradient element's stops, following a single xlink:href inheritance level. */
function parseGradientStops(el: Element, doc: Document, depth = 0): GradientStop[] {
  let stopEls = Array.from(el.querySelectorAll("stop"));
  if (stopEls.length === 0 && depth < 4) {
    const href =
      el.getAttribute("href") ?? el.getAttributeNS("http://www.w3.org/1999/xlink", "href") ?? "";
    if (href.startsWith("#")) {
      const ref = doc.getElementById(href.slice(1));
      if (ref) return parseGradientStops(ref, doc, depth + 1);
    }
  }
  return stopEls.map((stop) => {
    // Stop styling can live on attributes or an inline style="" string.
    const inline = new Map<string, string>();
    for (const decl of (stop.getAttribute("style") ?? "").split(";")) {
      const [k, ...v] = decl.split(":");
      if (k && v.length) inline.set(k.trim().toLowerCase(), v.join(":").trim());
    }
    const read = (n: string) => inline.get(n) ?? stop.getAttribute(n) ?? "";
    const opacityRaw = read("stop-opacity");
    return {
      offset: stopOffset(read("offset")),
      color: read("stop-color") || "#000000",
      opacity: opacityRaw === "" ? 1 : Math.max(0, Math.min(1, Number(opacityRaw) || 0)),
    };
  });
}

type GradientLookupEntry = {
  gradient: Gradient;
  // When the source gradient used gradientUnits="userSpaceOnUse", the raw
  // user-space coordinates are kept here and converted to objectBoundingBox
  // fractions at style-resolution time using the referencing path's bbox.
  // (The Gradient type has no units field by design — the conversion happens
  // at import so export via objectBoundingBox is correct.)
  userSpaceLinear?: { x1: number; y1: number; x2: number; y2: number };
  userSpaceRadial?: { cx: number; cy: number; r: number };
};

type BBox = { minX: number; minY: number; maxX: number; maxY: number };

/** Sample every command point of a path's `d` string for an approximate bbox. */
function pathBBox(d: string): BBox | null {
  let parsed: PathData;
  try {
    parsed = parsePath(d);
  } catch {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;
  for (const sp of parsed.subPaths) {
    for (const cmd of sp.commands) {
      for (const p of cmd.points) {
        if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
          any = true;
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
      }
    }
  }
  return any ? { minX, minY, maxX, maxY } : null;
}

/** Convert a userSpaceOnUse gradient entry to the objectBoundingBox fraction model. */
function convertUserSpaceGradient(entry: GradientLookupEntry, bbox: BBox): Gradient {
  const w = bbox.maxX - bbox.minX || 1;
  const h = bbox.maxY - bbox.minY || 1;
  const refLen = (w + h) / 2 || 1;
  if (entry.userSpaceRadial) {
    const u = entry.userSpaceRadial;
    return {
      ...entry.gradient,
      cx: (u.cx - bbox.minX) / w,
      cy: (u.cy - bbox.minY) / h,
      r: u.r / refLen,
    };
  }
  const u = entry.userSpaceLinear!;
  const fx1 = (u.x1 - bbox.minX) / w;
  const fy1 = (u.y1 - bbox.minY) / h;
  const fx2 = (u.x2 - bbox.minX) / w;
  const fy2 = (u.y2 - bbox.minY) / h;
  const angle = Math.round((Math.atan2(fy2 - fy1, fx2 - fx1) * 180) / Math.PI);
  return { ...entry.gradient, angle };
}

/** Build a map of gradient id → entry (model Gradient + optional user-space coords). */
function buildGradientLookup(doc: Document): Map<string, GradientLookupEntry> {
  const map = new Map<string, GradientLookupEntry>();
  for (const el of Array.from(doc.querySelectorAll("linearGradient, radialGradient"))) {
    const id = el.getAttribute("id");
    if (!id) continue;
    const stops = parseGradientStops(el, doc);
    if (stops.length < 2) continue;

    const units = (el.getAttribute("gradientUnits") || "objectBoundingBox").trim();
    const isRadial = el.tagName.toLowerCase() === "radialgradient";

    if (units === "userSpaceOnUse") {
      // Keep raw user-space coordinates; convert to fractions at fill resolution
      // (where the referencing path's bbox is known).
      if (isRadial) {
        map.set(id, {
          gradient: { type: "radial", stops },
          userSpaceRadial: {
            cx: parseRatio(el.getAttribute("cx"), 0.5),
            cy: parseRatio(el.getAttribute("cy"), 0.5),
            r: parseRatio(el.getAttribute("r"), 0.5),
          },
        });
      } else {
        map.set(id, {
          gradient: { type: "linear", stops },
          userSpaceLinear: {
            x1: parseRatio(el.getAttribute("x1"), 0),
            y1: parseRatio(el.getAttribute("y1"), 0),
            x2: parseRatio(el.getAttribute("x2"), 1),
            y2: parseRatio(el.getAttribute("y2"), 0),
          },
        });
      }
    } else {
      // objectBoundingBox (default): coords are already fractions [0..1].
      if (isRadial) {
        map.set(id, {
          gradient: {
            type: "radial",
            stops,
            cx: parseRatio(el.getAttribute("cx"), 0.5),
            cy: parseRatio(el.getAttribute("cy"), 0.5),
            r: parseRatio(el.getAttribute("r"), 0.5),
          },
        });
      } else {
        const x1 = parseRatio(el.getAttribute("x1"), 0);
        const y1 = parseRatio(el.getAttribute("y1"), 0);
        const x2 = parseRatio(el.getAttribute("x2"), 1);
        const y2 = parseRatio(el.getAttribute("y2"), 0);
        const angle = Math.round((Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI);
        map.set(id, { gradient: { type: "linear", stops, angle } });
      }
    }
  }
  return map;
}

const parseRatio = (raw: string | null, fallback: number): number => {
  if (raw == null || raw === "") return fallback;
  const trimmed = raw.trim();
  const n = trimmed.endsWith("%") ? Number(trimmed.slice(0, -1)) / 100 : Number(trimmed);
  return Number.isFinite(n) ? n : fallback;
};

/** Extract a `url(#id)` reference target, or null. */
const urlRef = (value: string): string | null => {
  const m = /url\(['"]?#([^'")]+)['"]?\)/.exec(value);
  return m ? m[1] : null;
};

// ── Style extraction (attributes + inline CSS `style` attribute) ────────

function getStyle(
  element: Element,
  gradients?: Map<string, GradientLookupEntry>,
  pathDataD?: string,
) {
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

  // Resolve a url(#id) gradient fill into the model (solid fill stays a string).
  const fillRefId = fill ? urlRef(fill) : null;
  let fillGradient: Gradient | undefined;
  if (fillRefId) {
    const entry = gradients?.get(fillRefId);
    if (entry) {
      if (entry.userSpaceLinear || entry.userSpaceRadial) {
        // userSpaceOnUse: convert raw user-space coords to objectBoundingBox
        // fractions using THIS referencing path's bbox (sampled from its d).
        const bbox = pathDataD ? pathBBox(pathDataD) : null;
        fillGradient = bbox ? convertUserSpaceGradient(entry, bbox) : entry.gradient;
      } else {
        fillGradient = entry.gradient;
      }
    }
  }

  return {
    ...(fillGradient ? { fillGradient } : {}),
    fillColor: fill === "none" || fillRefId ? "" : fill,
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

function layerFromPathData(
  name: string,
  pathData: string,
  id: string,
  matrix: Matrix,
  style = {},
  parentId: string | null = null,
) {
  let parsed = parsePath(pathData);
  parsed = transformPathData(parsed, matrix);
  // k7zp/3t0c: guarantee stable ULID command IDs even for freshly parsed imported geometry.
  // Harmless no-op on already-good data; upgrades any legacy cmd_ patterns.
  parsed = ensureStableCommandIds(parsed);
  return {
    id,
    name,
    type: "path",
    from: parsed,
    to: parsed,
    pathData: parsed,
    visible: true,
    locked: false,
    parentId,
    ...style,
  } satisfies Layer;
}

const SVG_SHAPE_TAGS: Record<string, true> = {
  path: true,
  rect: true,
  circle: true,
  ellipse: true,
  line: true,
  polygon: true,
  polyline: true,
};

/** Convert a leaf SVG shape element to its `d` string. */
function svgPathDataFor(element: Element, tag: string): string {
  switch (tag) {
    case "path":
      return element.getAttribute("d") ?? "";
    case "rect":
      return pathFromRect(element);
    case "circle":
    case "ellipse":
      return pathFromCircle(element);
    case "line":
      return pathFromLine(element);
    case "polygon":
      return pathFromPoints(element, true);
    default:
      return pathFromPoints(element, false);
  }
}

/**
 * Recursively walk an SVG container (<svg> or <g>), emitting group Layer nodes
 * for <g> elements (preserving id/name + parentId nesting) and path layers for
 * leaf shapes. Ancestor transforms are baked into leaf geometry exactly as
 * before via getAccumulatedTransform; <defs>/<symbol>/<clipPath> subtrees are
 * skipped (their contents are not directly renderable). Mirrors parseVdGroup.
 */
function walkSvgChildren(
  container: Element,
  parentId: string | null,
  counter: { n: number },
  gradients: Map<string, GradientLookupEntry>,
  namePrefix: string,
  layers: Layer[],
): void {
  for (const child of Array.from(container.children)) {
    const tag = child.tagName.toLowerCase();
    if (tag === "defs" || tag === "symbol" || tag === "clippath") continue;

    if (tag === "g") {
      const groupId = `${namePrefix}_g_${counter.n++}`;
      const name = child.getAttribute("id") || `${namePrefix}_group_${counter.n}`;
      const emptyPath = ensureStableCommandIds(parsePath(""));
      layers.push({
        id: groupId,
        name,
        type: "group",
        from: emptyPath,
        to: emptyPath,
        pathData: emptyPath,
        visible: true,
        locked: false,
        parentId,
      } satisfies Layer);
      walkSvgChildren(child, groupId, counter, gradients, namePrefix, layers);
      continue;
    }

    if (SVG_SHAPE_TAGS[tag]) {
      try {
        const pathData = svgPathDataFor(child, tag);
        if (!pathData.trim()) continue;
        const name = child.getAttribute("id") || `${namePrefix}_${tag}_${counter.n + 1}`;
        const id = `${Date.now()}_${counter.n++}`;
        const matrix = getAccumulatedTransform(child);
        const layer = layerFromPathData(
          name,
          pathData,
          id,
          matrix,
          getStyle(child, gradients, pathData),
          parentId,
        );
        // Harden: skip any layer whose parsed geometry contains non-finite coords
        // (bad path data, NaN from malformed arcs/nums, complex edge cases).
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
        if (hasNaN) continue;
        layers.push(layer);
      } catch {
        // Graceful fallback: never crash on a bad element (partial-load recovery).
      }
    }
  }
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

    // Apply <use> x/y as a translate, and copy the use element's transform
    const ux = use.getAttribute("x");
    const uy = use.getAttribute("y");
    const existingTransform = use.getAttribute("transform") ?? "";
    const offset = ux || uy ? `translate(${ux ?? 0}, ${uy ?? 0})` : "";
    const combined = `${existingTransform} ${offset}`.trim();

    // Wrap in a <g> with the combined transform and insert in place of <use>
    const wrapper = doc.createElementNS("http://www.w3.org/2000/svg", "g");
    if (combined) wrapper.setAttribute("transform", combined);

    if (referenced.tagName.toLowerCase() === "symbol") {
      for (const child of Array.from(referenced.children)) {
        wrapper.appendChild(child.cloneNode(true));
      }
    } else {
      const clone = referenced.cloneNode(true) as Element;
      clone.removeAttribute("id"); // avoid duplicate IDs
      wrapper.appendChild(clone);
    }
    use.parentNode?.replaceChild(wrapper, use);
  }

  const gradients = buildGradientLookup(doc);
  const layers: Layer[] = [];
  walkSvgChildren(doc.documentElement, null, { n: 0 }, gradients, namePrefix, layers);
  return layers;
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
