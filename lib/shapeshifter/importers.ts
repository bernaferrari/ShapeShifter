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

export {
  extractVectorDrawableMetadata,
  importLayersFromVectorDrawable,
} from "./import/androidVectorDrawable";
export type { VectorDrawableImportResult } from "./import/androidVectorDrawable";

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

// ── Gradient parsing (<linearGradient>/<radialGradient>) ──────────────────

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
  userSpaceTransform?: Matrix;
};

function transformUserSpaceGradient(gradient: Gradient, matrix: Matrix): Gradient {
  if (gradient.coordinateSpace !== "userSpace" || isIdentity(matrix))
    return structuredClone(gradient);
  if (gradient.type === "linear") {
    const start = transformPoint(matrix, { x: gradient.x1 ?? 0, y: gradient.y1 ?? 0 });
    const end = transformPoint(matrix, { x: gradient.x2 ?? 1, y: gradient.y2 ?? 0 });
    return { ...structuredClone(gradient), x1: start.x, y1: start.y, x2: end.x, y2: end.y };
  }
  const center = transformPoint(matrix, { x: gradient.cx ?? 0.5, y: gradient.cy ?? 0.5 });
  const sx = Math.hypot(matrix[0], matrix[1]);
  const sy = Math.hypot(matrix[2], matrix[3]);
  const conformal =
    Math.abs(sx - sy) < 1e-9 && Math.abs(matrix[0] * matrix[2] + matrix[1] * matrix[3]) < 1e-9;
  return {
    ...structuredClone(gradient),
    cx: center.x,
    cy: center.y,
    // A non-uniform transform turns a radial gradient elliptical, which the
    // current portable model cannot encode. Keep its authored radius in that
    // edge case rather than silently inventing an arbitrary scale factor.
    r: conformal ? (gradient.r ?? 0.5) * sx : gradient.r,
  };
}

/** Build a map of gradient id → model Gradient. */
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
      // Preserve the source coordinate system instead of collapsing Android/SVG
      // endpoints into an angle. That lets a static SVG or VectorDrawable make a
      // lossless round-trip even when a path occupies only part of the viewport.
      if (isRadial) {
        map.set(id, {
          gradient: {
            type: "radial",
            coordinateSpace: "userSpace",
            stops,
            cx: parseRatio(el.getAttribute("cx"), 0.5),
            cy: parseRatio(el.getAttribute("cy"), 0.5),
            r: parseRatio(el.getAttribute("r"), 0.5),
          },
          userSpaceTransform: parseSvgTransform(el.getAttribute("gradientTransform") ?? ""),
        });
      } else {
        map.set(id, {
          gradient: {
            type: "linear",
            coordinateSpace: "userSpace",
            stops,
            x1: parseRatio(el.getAttribute("x1"), 0),
            y1: parseRatio(el.getAttribute("y1"), 0),
            x2: parseRatio(el.getAttribute("x2"), 1),
            y2: parseRatio(el.getAttribute("y2"), 0),
          },
          userSpaceTransform: parseSvgTransform(el.getAttribute("gradientTransform") ?? ""),
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
  matrix: Matrix = IDENTITY,
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
      const gradientMatrix = entry.userSpaceTransform
        ? multiplyMatrices(matrix, entry.userSpaceTransform)
        : matrix;
      fillGradient = transformUserSpaceGradient(entry.gradient, gradientMatrix);
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

interface SvgClipDefinition {
  clipPath: Element;
  shape: Element;
}

/**
 * Resolve the simple clip-path form emitted by our static exporter. A model
 * clip path represents one geometry, so general SVG clip definitions with
 * multiple shapes are intentionally not flattened into a visually different
 * intersection. The first renderable shape is enough for self-round-trips.
 */
function buildClipLookup(doc: Document): Map<string, SvgClipDefinition> {
  const clips = new Map<string, SvgClipDefinition>();
  for (const clipPath of Array.from(doc.querySelectorAll("clipPath"))) {
    const id = clipPath.getAttribute("id");
    if (!id || (clipPath.getAttribute("clipPathUnits") || "userSpaceOnUse") !== "userSpaceOnUse") {
      continue;
    }
    const shape = Array.from(
      clipPath.querySelectorAll("path, rect, circle, ellipse, line, polygon, polyline"),
    ).find((candidate) => SVG_SHAPE_TAGS[candidate.tagName.toLowerCase()]);
    if (shape) clips.set(id, { clipPath, shape });
  }
  return clips;
}

/** Get transforms inside a clip definition without accidentally applying the SVG root twice. */
function clipDefinitionTransform(definition: SvgClipDefinition): Matrix {
  const chain: Matrix[] = [];
  let current: Element | null = definition.shape;
  while (current) {
    const attr = current.getAttribute("transform");
    if (attr) chain.unshift(parseSvgTransform(attr));
    if (current === definition.clipPath) break;
    current = current.parentElement;
  }
  return chain.reduce<Matrix>((matrix, next) => multiplyMatrices(matrix, next), [...IDENTITY]);
}

function addReferencedClip(
  element: Element,
  parentId: string | null,
  counter: { n: number },
  namePrefix: string,
  clips: Map<string, SvgClipDefinition>,
  layers: Layer[],
) {
  const clipId = urlRef(element.getAttribute("clip-path") ?? "");
  const definition = clipId ? clips.get(clipId) : undefined;
  if (!definition) return;
  try {
    const tag = definition.shape.tagName.toLowerCase();
    const pathData = svgPathDataFor(definition.shape, tag);
    if (!pathData.trim()) return;
    const matrix = multiplyMatrices(
      getAccumulatedTransform(element),
      clipDefinitionTransform(definition),
    );
    const name = definition.clipPath.getAttribute("id") || `${namePrefix}_clip_${counter.n + 1}`;
    const clip = layerFromPathData(
      name,
      pathData,
      `${namePrefix}_clip_${counter.n++}`,
      matrix,
      {},
      parentId,
    );
    layers.push({ ...clip, type: "clipPath", fillColor: "", strokeColor: "" });
  } catch {
    // A malformed external clip must not reject otherwise usable artwork.
  }
}

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
  clips: Map<string, SvgClipDefinition>,
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
      // SVG's clip is scoped to this group. In our retained sibling-order model
      // a clipPath immediately before the group's children has the same scope.
      addReferencedClip(child, groupId, counter, namePrefix, clips, layers);
      walkSvgChildren(child, groupId, counter, gradients, clips, namePrefix, layers);
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
          getStyle(child, gradients, matrix),
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
  const clips = buildClipLookup(doc);
  const layers: Layer[] = [];
  walkSvgChildren(doc.documentElement, null, { n: 0 }, gradients, clips, namePrefix, layers);
  return layers;
}
