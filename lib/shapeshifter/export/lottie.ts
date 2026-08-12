import { dominantColor } from "../gradients";
import { INTERPOLATOR_CURVES } from "../interpolators";
import type { AnimationState, Layer, PathData, TimelineBlock, VectorMetadata } from "../types";

/**
 * Lottie export with proper Bézier in/out tangent handles.
 * Correctly distinguishes vertices (endpoints) from control points (tangents).
 * Supports cubic bezier, quadratic (converted to cubic), and line segments.
 */
function hexToLottieRgba(hex: string, alpha = 1): [number, number, number, number] {
  const m = hex.match(/^#?([0-9a-f]{3,8})$/i);
  if (!m) return [0, 0, 0, alpha];
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const embeddedAlpha = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return [r, g, b, embeddedAlpha * alpha];
}

export function exportLottie(
  fromPath: PathData,
  toPath: PathData,
  name: string,
  duration = 1.2,
  layer?: Layer,
) {
  const w = 512;
  const h = 512;
  const fr = 30;
  const op = Math.round(duration * fr);
  const sx = w / 24;
  const sy = h / 24;

  const extractShape = (path: PathData) => {
    const verts: number[][] = [];
    const inT: number[][] = [];
    const outT: number[][] = [];
    let closed = false;

    for (const sp of path.subPaths) {
      for (const cmd of sp.commands) {
        if (cmd.type === "M" && cmd.points.length > 0) {
          const p = cmd.points[0];
          verts.push([p.x * sx, p.y * sy]);
          inT.push([0, 0]);
          outT.push([0, 0]);
        } else if (cmd.type === "L" && cmd.points.length > 0) {
          const p = cmd.points[cmd.points.length - 1];
          verts.push([p.x * sx, p.y * sy]);
          inT.push([0, 0]);
          outT.push([0, 0]);
        } else if (cmd.type === "C" && cmd.points.length === 3) {
          const [cp1, cp2, end] = cmd.points;
          const prevIdx = verts.length - 1;
          if (prevIdx >= 0) {
            const prev = verts[prevIdx];
            outT[prevIdx] = [cp1.x * sx - prev[0], cp1.y * sy - prev[1]];
          }
          verts.push([end.x * sx, end.y * sy]);
          inT.push([cp2.x * sx - end.x * sx, cp2.y * sy - end.y * sy]);
          outT.push([0, 0]);
        } else if (cmd.type === "Q" && cmd.points.length === 2) {
          // Convert quadratic to cubic tangents
          const [cp, end] = cmd.points;
          const prevIdx = verts.length - 1;
          if (prevIdx >= 0) {
            const prev = verts[prevIdx];
            const cp1x = prev[0] + (2 / 3) * (cp.x * sx - prev[0]);
            const cp1y = prev[1] + (2 / 3) * (cp.y * sy - prev[1]);
            outT[prevIdx] = [cp1x - prev[0], cp1y - prev[1]];
          }
          const ex = end.x * sx;
          const ey = end.y * sy;
          verts.push([ex, ey]);
          inT.push([(2 / 3) * (cp.x * sx - ex), (2 / 3) * (cp.y * sy - ey)]);
          outT.push([0, 0]);
        } else if (cmd.type === "Z") {
          closed = true;
        }
      }
    }

    if (verts.length === 0) {
      verts.push([140, 140], [200, 140], [200, 200], [140, 200]);
      inT.push([0, 0], [0, 0], [0, 0], [0, 0]);
      outT.push([0, 0], [0, 0], [0, 0], [0, 0]);
      closed = true;
    }

    return { v: verts, i: inT, o: outT, c: closed };
  };

  const fromShape = extractShape(fromPath);
  const toShape = extractShape(toPath);

  // Pad shorter shape for compatibility
  while (fromShape.v.length < toShape.v.length) {
    const last = fromShape.v[fromShape.v.length - 1];
    fromShape.v.push([...last]);
    fromShape.i.push([0, 0]);
    fromShape.o.push([0, 0]);
  }
  while (toShape.v.length < fromShape.v.length) {
    const last = toShape.v[toShape.v.length - 1];
    toShape.v.push([...last]);
    toShape.i.push([0, 0]);
    toShape.o.push([0, 0]);
  }

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
        ks: {
          p: { a: 0, k: [w / 2, h / 2] },
          r: { a: 0, k: 0 },
          s: { a: 0, k: [100, 100] },
          o: { a: 0, k: 100 },
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
                    { t: 0, s: [fromShape] },
                    { t: op, s: [toShape] },
                  ],
                },
              },
              ...(layer?.strokeColor
                ? [
                    {
                      ty: "st",
                      nm: "Stroke",
                      c: { a: 0, k: hexToLottieRgba(layer.strokeColor, layer.strokeAlpha ?? 1) },
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
                : [
                    {
                      ty: "st",
                      nm: "Stroke",
                      c: { a: 0, k: [0.25, 0.45, 0.95, 1] },
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
                      o: { a: 0, k: (layer.fillAlpha ?? 1) * 100 },
                    },
                  ]
                : layer?.fillColor
                  ? [
                      {
                        ty: "fl",
                        nm: "Fill",
                        c: { a: 0, k: hexToLottieRgba(layer.fillColor, 1) },
                        o: { a: 0, k: (layer.fillAlpha ?? 1) * 100 },
                      },
                    ]
                  : [
                      {
                        ty: "fl",
                        nm: "Fill",
                        c: { a: 0, k: [0.2, 0.35, 0.85, 0.15] },
                        o: { a: 0, k: 100 },
                      },
                    ]),
              {
                ty: "tr",
                p: { a: 0, k: [0, 0] },
                r: { a: 0, k: 0 },
                s: { a: 0, k: [1, 1] },
              },
            ],
          },
        ],
      },
    ],
  } as any;
}

function flattenLottieLayers(layers: Layer[]): Layer[] {
  const result: Layer[] = [];
  const seen = new Set<string | number>();

  const visit = (layer: Layer, parentVisible = true) => {
    if (!parentVisible) return;
    if (layer.visible === false) return;
    if (layer.type !== "clipPath" && layer.from && !seen.has(layer.id)) {
      seen.add(layer.id);
      result.push(layer);
    }
    layer.children?.forEach((child) => visit(child, true));
  };

  layers.forEach((layer) => visit(layer));
  return result;
}

export interface LottieDocumentOptions {
  /** Source timeline in milliseconds. Omit to export static layer transforms. */
  animation?: AnimationState;
  /** Retained for callers that need provenance; Lottie uses its own pixel canvas. */
  vector?: VectorMetadata;
  /** Output duration in seconds. Defaults to the source animation duration. */
  duration?: number;
}

function lottieBezier(interpolator?: string) {
  const named = interpolator ? INTERPOLATOR_CURVES[interpolator as keyof typeof INTERPOLATOR_CURVES] : undefined;
  const values = named ?? interpolator?.match(/[-+]?(?:\d*\.)?\d+/g)?.map(Number);
  if (!values || values.length < 4) return undefined;
  const [x1, y1, x2, y2] = values;
  if ([x1, y1, x2, y2].some((value) => !Number.isFinite(value))) return undefined;
  // Lottie stores outgoing then incoming cubic control points as arrays.
  return { o: { x: [x1], y: [y1] }, i: { x: [x2], y: [y2] } };
}

function blocksFor(animation: AnimationState | undefined, layerId: string | number, property: string) {
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
    k: [
      ...blocks.map((block) => ({
        t: Math.max(0, block.startTime * millisecondsToFrame),
        s: [transform(number(block.fromValue, initial))],
        e: [transform(number(block.toValue, initial))],
        ...lottieBezier(block.interpolator),
      })),
      {
        t: Math.max(0, blocks.at(-1)!.endTime * millisecondsToFrame),
        s: [transform(number(blocks.at(-1)!.toValue, initial))],
      },
    ],
  } as any;
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
    k: [
      ...blocks.map((block) => ({
        t: Math.max(0, block.startTime * millisecondsToFrame),
        s: [hexToLottieRgba(String(block.fromValue), alpha)],
        e: [hexToLottieRgba(String(block.toValue), alpha)],
        ...lottieBezier(block.interpolator),
      })),
      {
        t: Math.max(0, blocks.at(-1)!.endTime * millisecondsToFrame),
        s: [hexToLottieRgba(String(blocks.at(-1)!.toValue), alpha)],
      },
    ],
  };
}

/**
 * Exports a complete visible document, including parent groups and timeline
 * transform/style tracks. The legacy numeric third argument remains supported.
 */
export function exportLottieDocument(
  layers: Layer[],
  name: string,
  options: number | LottieDocumentOptions = 1.2,
) {
  const sourceAnimation = typeof options === "number" ? undefined : options.animation;
  const duration =
    typeof options === "number"
      ? options
      : options.duration ?? Math.max(0.001, (sourceAnimation?.duration ?? 1200) / 1000);
  const exportableLayers = flattenLottieLayers(layers);
  const emptyPath: PathData = { subPaths: [{ commands: [] }] };

  if (exportableLayers.length === 0) {
    return exportLottie(emptyPath, emptyPath, name, duration);
  }

  const base = exportLottie(
    exportableLayers[0].from,
    exportableLayers[0].to ?? exportableLayers[0].from,
    name,
    duration,
    exportableLayers[0],
  );
  const sx = base.w / 24;
  const sy = base.h / 24;
  const millisecondsToFrame = base.op / Math.max(1, sourceAnimation?.duration ?? duration * 1000);
  const indices = new Map(exportableLayers.map((layer, index) => [String(layer.id), index + 1]));

  return {
    ...base,
    nm: name,
    layers: exportableLayers.map((layer, index) => {
      const parentIndex = layer.parentId == null ? undefined : indices.get(String(layer.parentId));
      const isGroup = layer.type === "group" || layer.type === "vector";
      const single = exportLottie(layer.from, layer.to ?? layer.from, layer.name, duration, layer)
        .layers[0];
      const rootOffset = parentIndex == null ? [base.w / 2, base.h / 2] : [0, 0];
      const translateX = layer.translateX ?? 0;
      const translateY = layer.translateY ?? 0;
      const translateXBlocks = blocksFor(sourceAnimation, layer.id, "translateX");
      const translateYBlocks = blocksFor(sourceAnimation, layer.id, "translateY");
      const shapes = isGroup
        ? []
        : single.shapes.map((shape: { ty?: string; it?: Array<Record<string, unknown>> }) =>
            shape.ty !== "gr" || !shape.it
              ? shape
              : {
                  ...shape,
                  it: shape.it.map((item) => {
                    if (item.ty === "fl") {
                      return {
                        ...item,
                        c: colorAnimation(
                          blocksFor(sourceAnimation, layer.id, "fillColor"),
                          layer.fillColor ?? "#00000000",
                          layer.fillAlpha ?? 1,
                          millisecondsToFrame,
                        ),
                      };
                    }
                    if (item.ty === "st") {
                      return {
                        ...item,
                        c: colorAnimation(
                          blocksFor(sourceAnimation, layer.id, "strokeColor"),
                          layer.strokeColor ?? "#00000000",
                          layer.strokeAlpha ?? 1,
                          millisecondsToFrame,
                        ),
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
                  x: numberAnimation(translateXBlocks, rootOffset[0] + translateX * sx, millisecondsToFrame, (value) => rootOffset[0] + value * sx),
                  y: numberAnimation(translateYBlocks, rootOffset[1] + translateY * sy, millisecondsToFrame, (value) => rootOffset[1] + value * sy),
                }
              : { k: [rootOffset[0] + translateX * sx, rootOffset[1] + translateY * sy] }),
          },
          a: { a: 0, k: [(layer.pivotX ?? 0) * sx, (layer.pivotY ?? 0) * sy] },
          r: numberAnimation(blocksFor(sourceAnimation, layer.id, "rotation"), layer.rotation ?? 0, millisecondsToFrame),
          s: {
            a: 0,
            k: [(layer.scaleX ?? 1) * 100, (layer.scaleY ?? 1) * 100],
          },
          o: numberAnimation(blocksFor(sourceAnimation, layer.id, "alpha"), (layer.alpha ?? 1) * 100, millisecondsToFrame, (value) => value * 100),
        },
      };
    }),
  };
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
