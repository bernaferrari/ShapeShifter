import { dominantColor, normalizeStops } from "../gradients";
import { arcToBeziers } from "../geometry";
import { INTERPOLATOR_CURVES } from "../interpolators";
import { colorAtTime, numberAtTime, parseEditorColor } from "../playheadResolve";
import { createLayerTreeModel } from "../scene/layerHierarchy";
import type { AnimationState, Layer, PathData, TimelineBlock, VectorMetadata } from "../types";
import { vectorCoordinateSize } from "../vectorSpace";
import { normalizePathData, parsePath } from "../pathUtils";

const LOTTIE_CANVAS_SIZE = 512;

/** Map viewport-space path data into the fixed Lottie composition without distortion. */
function lottieProjection(
  vector?: Pick<Partial<VectorMetadata>, "width" | "height" | "viewportWidth" | "viewportHeight">,
) {
  const viewport = vectorCoordinateSize(vector ?? {});
  const scale = Math.min(LOTTIE_CANVAS_SIZE / viewport.width, LOTTIE_CANVAS_SIZE / viewport.height);
  return {
    width: LOTTIE_CANVAS_SIZE,
    height: LOTTIE_CANVAS_SIZE,
    scale,
    offsetX: (LOTTIE_CANVAS_SIZE - viewport.width * scale) / 2,
    offsetY: (LOTTIE_CANVAS_SIZE - viewport.height * scale) / 2,
  };
}
/**
 * Lottie export with proper Bézier in/out tangent handles.
 * Correctly distinguishes vertices (endpoints) from control points (tangents).
 * Supports cubic bezier, quadratic (converted to cubic), elliptical arcs
 * (converted to cubic via arcToBeziers), and line segments.
 */
function hexToLottieRgba(hex: string, alpha = 1): [number, number, number, number] {
  const color = parseEditorColor(hex);
  if (!color) return [0, 0, 0, alpha];
  return [color.r / 255, color.g / 255, color.b / 255, (color.a / 255) * alpha];
}

function paintAlpha(color: string, alpha = 1) {
  return Math.max(0, Math.min(1, alpha * ((parseEditorColor(color)?.a ?? 255) / 255)));
}

function gradientAlpha(layer: Layer) {
  if (!layer.fillGradient) return 1;
  const color = dominantColor(layer.fillGradient);
  return Math.max(
    ...normalizeStops(layer.fillGradient.stops)
      .filter((stop) => stop.color === color)
      .map((stop) => stop.opacity ?? 1),
    0,
  );
}

export function exportLottie(
  fromPath: PathData,
  toPath: PathData,
  name: string,
  duration = 1.2,
  layer?: Layer,
  vector?: Pick<Partial<VectorMetadata>, "width" | "height" | "viewportWidth" | "viewportHeight">,
) {
  const projection = lottieProjection(vector);
  const w = projection.width;
  const h = projection.height;
  const fr = 30;
  const op = Math.round(duration * fr);
  const sx = projection.scale;
  const sy = projection.scale;

  const extractContours = (path: PathData) => {
    // One Lottie shape per subpath: concatenating contours would connect
    // disjoint outlines (donut rings, glyph counters) into a single polyline.
    const contours: { v: number[][]; i: number[][]; o: number[][]; c: boolean }[] = [];

    for (const sp of normalizePathData(path).subPaths) {
      const verts: number[][] = [];
      const inT: number[][] = [];
      const outT: number[][] = [];
      let closed = false;
      let current: { x: number; y: number } | undefined;

      const vertexAt = (p: { x: number; y: number }) => {
        current = p;
        verts.push([p.x * sx, p.y * sy]);
        inT.push([0, 0]);
        outT.push([0, 0]);
      };
      const curveTo = (
        cp1: { x: number; y: number },
        cp2: { x: number; y: number },
        end: { x: number; y: number },
      ) => {
        if (!current) return;
        const prevIdx = verts.length - 1;
        const prev = verts[prevIdx];
        outT[prevIdx] = [cp1.x * sx - prev[0], cp1.y * sy - prev[1]];
        vertexAt(end);
        inT[inT.length - 1] = [cp2.x * sx - end.x * sx, cp2.y * sy - end.y * sy];
      };

      for (const cmd of sp.commands) {
        if (cmd.type === "M" && cmd.points.length > 0) {
          if (verts.length > 0) {
            contours.push({ v: verts, i: inT, o: outT, c: closed });
            verts.length = 0;
            inT.length = 0;
            outT.length = 0;
            closed = false;
          }
          vertexAt(cmd.points[0]);
        } else if (cmd.type === "L" && cmd.points.length > 0) {
          vertexAt(cmd.points[cmd.points.length - 1]);
        } else if (cmd.type === "A" && cmd.points.length > 0) {
          // Arcs are preserved by parsePath to avoid silent data loss;
          // convert to cubic segments so the geometry survives export.
          if (cmd.arcParams && current) {
            const end = cmd.points[cmd.points.length - 1];
            for (const bez of arcToBeziers(
              current.x,
              current.y,
              cmd.arcParams.rx,
              cmd.arcParams.ry,
              cmd.arcParams.xRotation,
              cmd.arcParams.largeArc,
              cmd.arcParams.sweep,
              end.x,
              end.y,
            )) {
              curveTo(bez.cp1, bez.cp2, bez.to);
            }
          }
        } else if (cmd.type === "C" && cmd.points.length === 3) {
          const [cp1, cp2, end] = cmd.points;
          curveTo(cp1, cp2, end);
        } else if (cmd.type === "Q" && cmd.points.length === 2) {
          // Convert quadratic to cubic tangents
          const [cp, end] = cmd.points;
          if (!current) continue;
          const prev = verts[verts.length - 1];
          const cp1x = prev[0] + (2 / 3) * (cp.x * sx - prev[0]);
          const cp1y = prev[1] + (2 / 3) * (cp.y * sy - prev[1]);
          const ex = end.x * sx;
          const ey = end.y * sy;
          outT[outT.length - 1] = [cp1x - prev[0], cp1y - prev[1]];
          vertexAt(end);
          inT[inT.length - 1] = [(2 / 3) * (cp.x * sx - ex), (2 / 3) * (cp.y * sy - ey)];
        } else if (cmd.type === "Z") {
          closed = true;
        }
      }
      if (verts.length > 0) {
        contours.push({ v: verts, i: inT, o: outT, c: closed });
      }
    }

    return contours;
  };

  const fallbackContour = () => ({
    v: [
      [140, 140],
      [200, 140],
      [200, 200],
      [140, 200],
    ],
    i: [
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ],
    o: [
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ],
    c: true,
  });
  const fromContours = extractContours(fromPath);
  const toContours = extractContours(toPath);
  const fromShape = fromContours[0] ?? fallbackContour();
  const toShape = toContours[0] ?? fallbackContour();

  // Every contour pair must have equal vertex counts in both keyframes —
  // Lottie morphs interpolate v/i/o arrays element-wise, so mismatched
  // lengths are invalid (players reject or garble the shape). The fallback
  // contour covers a missing target subpath; a present-but-different-length
  // target is padded by duplicating its last vertex.
  const padPair = (a: { v: number[][]; i: number[][]; o: number[][] }, b: typeof a) => {
    while (a.v.length < b.v.length) {
      const last = a.v[a.v.length - 1];
      a.v.push([...last]);
      a.i.push([0, 0]);
      a.o.push([0, 0]);
    }
    while (b.v.length < a.v.length) {
      const last = b.v[b.v.length - 1];
      b.v.push([...last]);
      b.i.push([0, 0]);
      b.o.push([0, 0]);
    }
  };
  padPair(fromShape, toShape);

  // Additional contours are exported as extra animated shapes so every
  // subpath stays a separate closed/open outline in the composition.
  const extraShapes = Array.from(
    { length: Math.max(fromContours.length, toContours.length) - 1 },
    (_, index) => {
      const contour = fromContours[index + 1] ?? fallbackContour();
      const toContour = toContours[index + 1] ?? fallbackContour();
      padPair(contour, toContour);
      return {
        ty: "sh",
        nm: `Path ${index + 2}`,
        ks: {
          a: 1,
          k: [
            { t: 0, s: [contour], e: [structuredClone(toContour)], ...lottieBezier("LINEAR") },
            { t: op, s: [toContour] },
          ],
        },
      };
    },
  );

  return {
    v: "5.9.0",
    fr,
    ip: 0,
    op,
    w,
    h,
    nm: name,
    ddd: 0,
    assets: [],
    layers: [
      {
        ddd: 0,
        ind: 1,
        ty: 4,
        nm: "Morph Shape",
        sr: 1,
        ip: 0,
        op,
        st: 0,
        ks: {
          p: { a: 0, k: [projection.offsetX, projection.offsetY] },
          r: { a: 0, k: 0 },
          s: { a: 0, k: [100, 100] },
          o: { a: 0, k: 100 },
          a: { a: 0, k: [0, 0] },
        },
        shapes: [
          {
            ty: "gr",
            nm: "Group",
            it: [
              {
                ty: "sh",
                nm: "Path",
                ks: {
                  a: 1,
                  k: [
                    {
                      t: 0,
                      s: [fromShape],
                      e: [structuredClone(toShape)],
                      ...lottieBezier("LINEAR"),
                    },
                    { t: op, s: [toShape] },
                  ],
                },
              },
              ...extraShapes,
              ...(layer?.strokeColor && layer.strokeColor !== "none" && (layer.strokeWidth ?? 2) > 0
                ? [
                    {
                      ty: "st",
                      nm: "Stroke",
                      c: { a: 0, k: hexToLottieRgba(layer.strokeColor, layer.strokeAlpha ?? 1) },
                      o: { a: 0, k: paintAlpha(layer.strokeColor, layer.strokeAlpha ?? 1) * 100 },
                      w: { a: 0, k: (layer.strokeWidth ?? 2) * sx },
                      lc:
                        layer.strokeLinecap === "round"
                          ? 2
                          : layer.strokeLinecap === "square"
                            ? 3
                            : 1,
                      lj:
                        layer.strokeLinejoin === "round"
                          ? 2
                          : layer.strokeLinejoin === "bevel"
                            ? 3
                            : 1,
                    },
                  ]
                : layer
                  ? []
                  : [
                      {
                        ty: "st",
                        nm: "Stroke",
                        c: { a: 0, k: [0.25, 0.45, 0.95, 1] },
                        o: { a: 0, k: 100 },
                        w: { a: 0, k: 5 },
                        lc: 2,
                        lj: 2,
                      },
                    ]),
              ...(layer?.fillGradient
                ? [
                    // Lottie gradient fills are complex; approximate with the dominant stop.
                    {
                      ty: "fl",
                      nm: "Fill",
                      c: { a: 0, k: hexToLottieRgba(dominantColor(layer.fillGradient), 1) },
                      o: {
                        a: 0,
                        k:
                          paintAlpha(
                            dominantColor(layer.fillGradient),
                            (layer.fillAlpha ?? 1) * gradientAlpha(layer),
                          ) * 100,
                      },
                      r: layer.fillType === "evenOdd" ? 2 : 1,
                    },
                  ]
                : layer?.fillColor && layer.fillColor !== "none"
                  ? [
                      {
                        ty: "fl",
                        nm: "Fill",
                        c: { a: 0, k: hexToLottieRgba(layer.fillColor, 1) },
                        o: { a: 0, k: paintAlpha(layer.fillColor, layer.fillAlpha ?? 1) * 100 },
                        r: layer.fillType === "evenOdd" ? 2 : 1,
                      },
                    ]
                  : layer
                    ? []
                    : [
                        {
                          ty: "fl",
                          nm: "Fill",
                          c: { a: 0, k: [0.2, 0.35, 0.85, 0.15] },
                          o: { a: 0, k: 15 },
                        },
                      ]),
              {
                ty: "tr",
                p: { a: 0, k: [0, 0] },
                r: { a: 0, k: 0 },
                s: { a: 0, k: [100, 100] },
                a: { a: 0, k: [0, 0] },
                o: { a: 0, k: 100 },
              },
            ],
          },
        ],
      },
    ],
  } as any;
}

function flattenLottieLayers(layers: Layer[]): Layer[] {
  const tree = createLayerTreeModel(layers);
  const ordered: Layer[] = [];
  const visit = (layer: Layer) => {
    ordered.push(layer);
    tree.childrenOf(layer).forEach(visit);
  };
  tree.roots.forEach(visit);

  // Documents are commonly stored as a flat layer list. Looking only at
  // `children` treats a flat child of a hidden group as a visible root, which
  // both leaks hidden artwork and loses the parent relationship in Lottie.
  // Normalize each item through the shared hierarchy model instead.
  return ordered.flatMap((layer) => {
    const ancestors = tree.ancestorsOf(layer.id);
    if (layer.visible === false || ancestors.some((ancestor) => ancestor.visible === false))
      return [];
    if (layer.type === "clipPath") {
      // Lottie mattes need a separate track-matte layer pair this exporter
      // does not build; say so instead of silently unclipping the artwork.
      console.warn(
        `[lottie] Clip path "${layer.name}" was skipped: Lottie export does not support clipping, so clipped artwork exports unclipped.`,
      );
      return [];
    }
    const geometry = layer.pathData ?? layer.from;
    if (
      !geometry ||
      (layer.type === "path" && !geometry.subPaths.some((subPath) => subPath.commands.length > 0))
    )
      return [];

    const parent = ancestors[0];
    return [{ ...layer, parentId: parent?.id ?? null }];
  });
}

export interface LottieDocumentOptions {
  /** Source timeline in milliseconds. Omit to export static layer transforms. */
  animation?: AnimationState;
  /** Source viewport; path data is fit into Lottie's pixel canvas without distortion. */
  vector?: VectorMetadata;
  /** Output duration in seconds. Defaults to the source animation duration. */
  duration?: number;
}

function lottieBezier(interpolator?: string) {
  const resolved = interpolator || "ACCELERATE_DECELERATE";
  const named = INTERPOLATOR_CURVES[resolved as keyof typeof INTERPOLATOR_CURVES];
  const values = named ?? interpolator?.match(/[-+]?(?:\d*\.)?\d+/g)?.map(Number);
  if (!values || values.length < 4) return undefined;
  const [x1, y1, x2, y2] = values;
  if ([x1, y1, x2, y2].some((value) => !Number.isFinite(value))) return undefined;
  // Lottie stores outgoing then incoming cubic control points as arrays.
  return { o: { x: [x1], y: [y1] }, i: { x: [x2], y: [y2] } };
}

function blocksFor(
  animation: AnimationState | undefined,
  layerId: string | number,
  property: string,
) {
  return (animation?.blocks ?? [])
    .filter((block) => String(block.layerId) === String(layerId) && block.propertyName === property)
    .sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);
}

function numberAnimation(
  blocks: TimelineBlock[],
  initial: number,
  millisecondsToFrame: number,
  transform = (value: number) => value,
): { a: 0 | 1; k: number | Array<Record<string, unknown>> } {
  if (!blocks.length) return { a: 0, k: initial };
  const number = (value: string | number, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    a: 1,
    k: segmentKeyframes(blocks, millisecondsToFrame, (value) => [
      transform(number(value, initial)),
    ]),
  };
}

/** A completed animator holds during gaps; each authored endpoint gets its own keyframe. */
function segmentKeyframes(
  blocks: TimelineBlock[],
  millisecondsToFrame: number,
  value: (source: string | number) => unknown[],
) {
  const keys = new Map<number, Record<string, unknown>>();
  for (const block of blocks) {
    const start = Math.max(0, block.startTime * millisecondsToFrame);
    const end = Math.max(start, block.endTime * millisecondsToFrame);
    keys.set(start, {
      t: start,
      s: value(block.fromValue),
      e: value(block.toValue),
      ...lottieBezier(block.interpolator),
    });
    keys.set(end, { t: end, s: value(block.toValue), h: 1 });
  }
  return [...keys.values()].sort((left, right) => Number(left.t) - Number(right.t));
}

/**
 * Lottie scale is a single 2D property, while the editor authors X and Y as
 * separate tracks. Merge them onto one timeline: each keyframe timestamp
 * samples both axes (a block animates its own axis; the other holds its
 * static value), so playback never snaps an axis to an unauthored keyframe.
 */
function scaleAnimation(
  xBlocks: TimelineBlock[],
  yBlocks: TimelineBlock[],
  initialXPercent: number,
  initialYPercent: number,
  millisecondsToFrame: number,
): { a: 0 | 1; k: [number, number] | Array<Record<string, unknown>> } {
  if (!xBlocks.length && !yBlocks.length) return { a: 0, k: [initialXPercent, initialYPercent] };

  // numberAtTime filters blocks by layer id, so the synthetic layer must
  // carry the same id as the scale tracks being sampled. Scale layers have
  // no authored percent field to sample; the synthetic identity carries the
  // static percentages as the sampling base.
  const baseLayer = {
    id: (xBlocks[0] ?? yBlocks[0]).layerId,
    scaleX: initialXPercent / 100,
    scaleY: initialYPercent / 100,
  } as unknown as Layer;
  const blocks = [...xBlocks, ...yBlocks];
  const durationMs = Math.max(...blocks.map((block) => block.endTime), 1);

  const timestamps = new Set<number>([0]);
  for (const block of blocks) {
    timestamps.add(block.startTime);
    timestamps.add(block.endTime);
  }

  // Animated Lottie properties use {t, s, e} keyframe objects; s holds the
  // sampled 2D value at each timestamp and the easing comes from whichever
  // block starts at that time.
  const times = [...timestamps].sort((a, b) => a - b);
  const samples = times.map(
    (ms) =>
      [
        numberAtTime(baseLayer, xBlocks, "scaleX", ms, durationMs, initialXPercent / 100) * 100,
        numberAtTime(baseLayer, yBlocks, "scaleY", ms, durationMs, initialYPercent / 100) * 100,
      ] as [number, number],
  );
  const easingAt = (ms: number) =>
    lottieBezier(blocks.find((block) => block.startTime === ms)?.interpolator);

  return {
    a: 1,
    k: [
      ...times.slice(0, -1).map((t, index) => ({
        t: t * millisecondsToFrame,
        s: samples[index],
        e: samples[index + 1],
        ...easingAt(t),
        ...(!blocks.some((block) => block.startTime <= t && t < block.endTime) ? { h: 1 } : {}),
      })),
      { t: times.at(-1)! * millisecondsToFrame, s: samples.at(-1)! },
    ],
  };
}

function colorAnimation(
  blocks: TimelineBlock[],
  initial: string,
  alpha: number,
  millisecondsToFrame: number,
) {
  if (!blocks.length) return { a: 0, k: hexToLottieRgba(initial, alpha) };
  return {
    a: 1,
    k: segmentKeyframes(blocks, millisecondsToFrame, (value) =>
      hexToLottieRgba(String(value), alpha),
    ),
  };
}

/** Lottie color alpha is ignored by players; transparency belongs on the paint opacity. */
function styleOpacity(
  layer: Layer,
  animation: AnimationState | undefined,
  kind: "fill" | "stroke",
  millisecondsToFrame: number,
) {
  const alphaProperty = `${kind}Alpha`;
  const colorProperty = `${kind}Color`;
  const alphaBlocks = blocksFor(animation, layer.id, alphaProperty);
  const colorBlocks =
    kind === "fill" && layer.fillGradient ? [] : blocksFor(animation, layer.id, colorProperty);
  const color =
    kind === "fill" && layer.fillGradient
      ? dominantColor(layer.fillGradient)
      : (layer[kind === "fill" ? "fillColor" : "strokeColor"] ?? "transparent");
  const stopAlpha = kind === "fill" ? gradientAlpha(layer) : 1;
  const alpha = layer[kind === "fill" ? "fillAlpha" : "strokeAlpha"] ?? 1;
  if (!colorBlocks.length)
    return numberAnimation(
      alphaBlocks,
      paintAlpha(color, alpha * stopAlpha) * 100,
      millisecondsToFrame,
      (value) => paintAlpha(color, value * stopAlpha) * 100,
    );
  if (!alphaBlocks.length)
    return {
      a: 1,
      k: segmentKeyframes(colorBlocks, millisecondsToFrame, (value) => [
        paintAlpha(String(value), alpha * stopAlpha) * 100,
      ]),
    };

  // The product of independent alpha curves is not itself a cubic Bézier.
  // Sample it at output-frame boundaries through the shared scene evaluator.
  const lastMs = Math.max(...[...alphaBlocks, ...colorBlocks].map((block) => block.endTime));
  const times = new Set<number>([0, lastMs * millisecondsToFrame]);
  for (let frame = 1; frame < lastMs * millisecondsToFrame; frame++) times.add(frame);
  for (const block of [...alphaBlocks, ...colorBlocks]) {
    times.add(block.startTime * millisecondsToFrame);
    times.add(block.endTime * millisecondsToFrame);
  }
  const samples = [...times]
    .sort((a, b) => a - b)
    .map((frame) => {
      const ms = frame / millisecondsToFrame;
      const evaluatedAlpha = numberAtTime(layer, alphaBlocks, alphaProperty, ms, lastMs, alpha);
      const evaluatedColor = colorAtTime(layer, colorBlocks, colorProperty, ms, lastMs, color);
      return { t: frame, s: [paintAlpha(evaluatedColor, evaluatedAlpha * stopAlpha) * 100] };
    });
  return {
    a: 1,
    k: samples.map((sample, index) =>
      index === samples.length - 1
        ? sample
        : { ...sample, e: samples[index + 1].s, ...lottieBezier("LINEAR") },
    ),
  };
}

/**
 * Exports a complete visible document, including parent groups and timeline
 * transform/style tracks.
 */
export function exportLottieDocument(
  layers: Layer[],
  name: string,
  options: LottieDocumentOptions = {},
) {
  const sourceAnimation = options.animation;
  const duration = options.duration ?? Math.max(0.001, (sourceAnimation?.duration ?? 1200) / 1000);
  const sourceVector = options.vector;
  const tree = createLayerTreeModel(layers);
  const projection = lottieProjection(sourceVector);
  const exportableLayers = flattenLottieLayers(layers);
  const emptyPath: PathData = { subPaths: [{ commands: [] }] };

  if (exportableLayers.length === 0) {
    return { ...exportLottie(emptyPath, emptyPath, name, duration), layers: [] };
  }

  const base = exportLottie(
    exportableLayers[0].pathData ?? exportableLayers[0].from,
    exportableLayers[0].to ?? exportableLayers[0].pathData ?? exportableLayers[0].from,
    name,
    duration,
    exportableLayers[0],
    sourceVector,
  );
  const sx = projection.scale;
  const sy = projection.scale;
  const millisecondsToFrame = base.op / Math.max(1, sourceAnimation?.duration ?? duration * 1000);
  const indices = new Map(exportableLayers.map((layer, index) => [String(layer.id), index + 1]));

  return {
    ...base,
    nm: name,
    layers: exportableLayers
      .map((layer, index) => {
        const parentIndex =
          layer.parentId == null ? undefined : indices.get(String(layer.parentId));
        const isGroup = layer.type === "group" || layer.type === "vector";
        const single = exportLottie(
          layer.pathData ?? layer.from,
          layer.to ?? layer.pathData ?? layer.from,
          layer.name,
          duration,
          layer,
          sourceVector,
        ).layers[0];
        const rootOffset = parentIndex == null ? [projection.offsetX, projection.offsetY] : [0, 0];
        const translateX = layer.translateX ?? 0;
        const translateY = layer.translateY ?? 0;
        const pivotX = layer.pivotX ?? 0;
        const pivotY = layer.pivotY ?? 0;
        const inheritedOpacity =
          (sourceVector?.alpha ?? 1) *
          tree
            .ancestorsOf(layer.id)
            .reduce((opacity, ancestor) => opacity * (ancestor.alpha ?? 1), 1);
        const translateXBlocks = blocksFor(sourceAnimation, layer.id, "translateX");
        const translateYBlocks = blocksFor(sourceAnimation, layer.id, "translateY");
        const pathBlocks = blocksFor(sourceAnimation, layer.id, "pathData");
        const blockShapes = pathBlocks.map((block) =>
          exportLottie(
            parsePath(String(block.fromValue)),
            parsePath(String(block.toValue)),
            layer.name,
            duration,
            layer,
            sourceVector,
          ).layers[0].shapes[0].it.filter((item: { ty: string }) => item.ty === "sh"),
        );
        const shapes = isGroup
          ? []
          : single.shapes.map((shape: { ty?: string; it?: Array<Record<string, unknown>> }) =>
              shape.ty !== "gr" || !shape.it
                ? shape
                : {
                    ...shape,
                    it: shape.it.map((item, shapeIndex) => {
                      if (item.ty === "sh" && pathBlocks.length) {
                        const keysByTime = new Map<number, Record<string, unknown>>();
                        pathBlocks.forEach((block, blockIndex) => {
                          const keys = blockShapes[blockIndex][shapeIndex]?.ks?.k;
                          if (!keys) return;
                          const start = block.startTime * millisecondsToFrame;
                          const end = block.endTime * millisecondsToFrame;
                          keysByTime.set(start, {
                            t: start,
                            s: keys[0].s,
                            e: structuredClone(keys[1].s),
                            ...lottieBezier(block.interpolator),
                          });
                          keysByTime.set(end, { t: end, s: keys[1].s, h: 1 });
                        });
                        return {
                          ...item,
                          ks: {
                            a: 1,
                            k: [...keysByTime.values()].sort(
                              (left, right) => Number(left.t) - Number(right.t),
                            ),
                          },
                        };
                      }
                      if (item.ty === "fl") {
                        return {
                          ...item,
                          c: colorAnimation(
                            layer.fillGradient
                              ? []
                              : blocksFor(sourceAnimation, layer.id, "fillColor"),
                            layer.fillGradient
                              ? dominantColor(layer.fillGradient)
                              : (layer.fillColor ?? "#00000000"),
                            1,
                            millisecondsToFrame,
                          ),
                          o: styleOpacity(layer, sourceAnimation, "fill", millisecondsToFrame),
                        };
                      }
                      if (item.ty === "st") {
                        return {
                          ...item,
                          c: colorAnimation(
                            blocksFor(sourceAnimation, layer.id, "strokeColor"),
                            layer.strokeColor ?? "#00000000",
                            1,
                            millisecondsToFrame,
                          ),
                          o: styleOpacity(layer, sourceAnimation, "stroke", millisecondsToFrame),
                        };
                      }
                      return item;
                    }),
                  },
            );
        return {
          ...single,
          ind: index + 1,
          nm: layer.name,
          ...(parentIndex != null ? { parent: parentIndex } : {}),
          ...(isGroup ? { ty: 3, shapes: [] } : { shapes }),
          ks: {
            ...single.ks,
            p: {
              a: translateXBlocks.length || translateYBlocks.length ? 1 : 0,
              ...(translateXBlocks.length || translateYBlocks.length
                ? {
                    s: true,
                    x: numberAnimation(
                      translateXBlocks,
                      rootOffset[0] + (translateX + pivotX) * sx,
                      millisecondsToFrame,
                      (value) => rootOffset[0] + (value + pivotX) * sx,
                    ),
                    y: numberAnimation(
                      translateYBlocks,
                      rootOffset[1] + (translateY + pivotY) * sy,
                      millisecondsToFrame,
                      (value) => rootOffset[1] + (value + pivotY) * sy,
                    ),
                  }
                : {
                    k: [
                      rootOffset[0] + (translateX + pivotX) * sx,
                      rootOffset[1] + (translateY + pivotY) * sy,
                    ],
                  }),
            },
            a: { a: 0, k: [pivotX * sx, pivotY * sy] },
            r: numberAnimation(
              blocksFor(sourceAnimation, layer.id, "rotation"),
              layer.rotation ?? 0,
              millisecondsToFrame,
            ),
            s: scaleAnimation(
              blocksFor(sourceAnimation, layer.id, "scaleX"),
              blocksFor(sourceAnimation, layer.id, "scaleY"),
              (layer.scaleX ?? 1) * 100,
              (layer.scaleY ?? 1) * 100,
              millisecondsToFrame,
            ),
            o: numberAnimation(
              blocksFor(sourceAnimation, layer.id, "alpha"),
              (layer.alpha ?? 1) * 100 * inheritedOpacity,
              millisecondsToFrame,
              (value) => value * 100 * inheritedOpacity,
            ),
          },
        };
      })
      .reverse(),
  };
}

export interface LottieExportDiagnostic {
  severity: "warning";
  code: string;
  layerId?: string | number;
  propertyName?: string;
  message: string;
}

/** Returns document-specific fidelity warnings alongside the interoperable JSON. */
export function exportLottieDocumentWithDiagnostics(
  layers: Layer[],
  name: string,
  options: LottieDocumentOptions = {},
) {
  const tree = createLayerTreeModel(layers);
  const diagnostics: LottieExportDiagnostic[] = [];
  const animation = typeof options === "number" ? undefined : options.animation;
  const visible = new Set(
    tree.allLayers
      .filter(
        (layer) =>
          layer.visible !== false &&
          tree.ancestorsOf(layer.id).every((ancestor) => ancestor.visible !== false),
      )
      .map((layer) => String(layer.id)),
  );
  for (const layer of tree.allLayers) {
    if (!visible.has(String(layer.id))) continue;
    if (layer.type === "clipPath")
      diagnostics.push({
        severity: "warning",
        code: "CLIPPING_UNSUPPORTED",
        layerId: layer.id,
        message: `Lottie omits clip path "${layer.name}"; clipped artwork may appear outside its mask.`,
      });
    if (layer.fillGradient)
      diagnostics.push({
        severity: "warning",
        code: "GRADIENT_APPROXIMATED",
        layerId: layer.id,
        message: `Lottie replaces the gradient on "${layer.name}" with a representative solid color.`,
      });
    if ((layer.trimPathStart ?? 0) !== 0 || (layer.trimPathEnd ?? 1) !== 1)
      diagnostics.push({
        severity: "warning",
        code: "TRIM_UNSUPPORTED",
        layerId: layer.id,
        message: `Lottie omits the static trim path on "${layer.name}".`,
      });
  }
  const supported = new Set([
    "pathData",
    "translateX",
    "translateY",
    "rotation",
    "scaleX",
    "scaleY",
    "alpha",
    "fillColor",
    "strokeColor",
    "fillAlpha",
    "strokeAlpha",
  ]);
  for (const block of animation?.blocks ?? []) {
    if (!visible.has(String(block.layerId))) continue;
    const layer = tree.allLayers.find(
      (candidate) => String(candidate.id) === String(block.layerId),
    );
    if (
      !supported.has(block.propertyName) ||
      (block.propertyName === "alpha" && (layer?.type === "group" || layer?.type === "vector")) ||
      (block.propertyName === "fillColor" && layer?.fillGradient)
    )
      diagnostics.push({
        severity: "warning",
        code: "TRACK_UNSUPPORTED",
        layerId: block.layerId,
        propertyName: block.propertyName,
        message: `Lottie omits ${block.propertyName} animation on "${layer?.name ?? block.layerId}".`,
      });
    else if (!block.interpolator || block.interpolator === "ACCELERATE_DECELERATE")
      diagnostics.push({
        severity: "warning",
        code: "EASING_APPROXIMATED",
        layerId: block.layerId,
        propertyName: block.propertyName,
        message: `Lottie approximates Android's cosine easing on "${layer?.name ?? block.layerId}" with a cubic Bézier.`,
      });
  }
  if (
    typeof options !== "number" &&
    (options.vector?.alpha ?? 1) !== 1 &&
    tree.allLayers.filter((layer) => layer.type === "path" && visible.has(String(layer.id)))
      .length > 1
  )
    diagnostics.push({
      severity: "warning",
      code: "ROOT_ALPHA_APPROXIMATED",
      message:
        "Lottie applies drawable alpha to each layer; overlapping translucent artwork may differ from Android's whole-drawable compositing.",
    });
  if (typeof options !== "number" && options.vector?.tint)
    diagnostics.push({
      severity: "warning",
      code: "ROOT_TINT_UNSUPPORTED",
      message: "Lottie omits the Android drawable tint.",
    });
  return { lottie: exportLottieDocument(layers, name, options), diagnostics };
}

export function downloadLottie(from: PathData, to: PathData, layerName: string, layer?: Layer) {
  const lottieObj = exportLottie(from, to, layerName, 1.2, layer);
  const json = JSON.stringify(lottieObj, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${layerName.toLowerCase().replace(/\s+/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
