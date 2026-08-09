import { dominantColor } from "../gradients";
import type { Layer, PathData } from "../types";

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
  return [r, g, b, alpha];
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
  };
}

function flattenLottieLayers(layers: Layer[]): Layer[] {
  const result: Layer[] = [];
  const seen = new Set<string | number>();

  const visit = (layer: Layer) => {
    if (layer.visible === false) return;
    if (layer.type === "group") {
      layer.children?.forEach(visit);
      return;
    }
    if (layer.from && layer.to && !seen.has(layer.id)) {
      seen.add(layer.id);
      result.push(layer);
    }
    layer.children?.forEach(visit);
  };

  layers.forEach(visit);
  return result;
}

export function exportLottieDocument(layers: Layer[], name: string, duration = 1.2) {
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

  return {
    ...base,
    nm: name,
    layers: exportableLayers.map((layer, index) => {
      const single = exportLottie(layer.from, layer.to ?? layer.from, layer.name, duration, layer)
        .layers[0];
      return {
        ...single,
        ind: index + 1,
        nm: layer.name,
        ks: {
          ...single.ks,
          p: {
            a: 0,
            k: [
              base.w / 2 + (layer.translateX ?? 0) * sx,
              base.h / 2 + (layer.translateY ?? 0) * sy,
            ],
          },
          r: { a: 0, k: layer.rotation ?? 0 },
          s: { a: 0, k: [(layer.scaleX ?? 1) * 100, (layer.scaleY ?? 1) * 100] },
          o: { a: 0, k: (layer.alpha ?? 1) * 100 },
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
