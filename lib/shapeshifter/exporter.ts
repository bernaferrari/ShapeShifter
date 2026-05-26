/**
 * ShapeShifter 2026 - Exporters
 * Production-grade export functionality for morph animations.
 */

import type { AnimationState, Layer, PathData, VectorMetadata } from "./types";
import { getInterpolatedPath, pathToString } from "./pathUtils";
import { evaluateInterpolator, INTERPOLATOR_KEYSPLINES } from "./interpolators";

export interface ExportOptions {
  duration?: number; // in seconds
  fps?: number; // frames per second for baked animation
  width?: number;
  height?: number;
  viewBoxWidth?: number; // coordinate-space width (default: 24)
  viewBoxHeight?: number; // coordinate-space height (default: 24)
  loop?: boolean;
  strokeWidth?: number;
  fromColor?: string;
  toColor?: string;
  morphColor?: string;
}

/**
 * Exports a real, self-contained animated SVG.
 * Uses embedded JavaScript for smooth, reliable 60fps morphing
 * (much better compatibility than old SMIL <animate>).
 */
export function exportAnimatedSVG(
  fromPath: PathData,
  toPath: PathData,
  layerName: string = "Morph",
  options: ExportOptions = {},
): string {
  const {
    duration = 1.2,
    width = 512,
    height = 512,
    viewBoxWidth = 24,
    viewBoxHeight = 24,
    loop = true,
    strokeWidth = 2.5,
    fromColor = "#3b82f6",
    toColor = "#8b5cf6",
    morphColor = "#22c55e",
  } = options;

  const fromD = pathToString(fromPath);
  const toD = pathToString(toPath);

  // Extract numeric values from both d-strings for real per-frame interpolation
  const numRegex = /[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi;
  const fromNums = fromD.match(numRegex)?.map(Number) ?? [];
  const toNums = toD.match(numRegex)?.map(Number) ?? [];
  // Build a template by replacing numbers with placeholders
  let placeholderIdx = 0;
  const template = fromD.replace(numRegex, () => `#${placeholderIdx++}#`);

  const vbW = viewBoxWidth;
  const vbH = viewBoxHeight;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${vbW} ${vbH}">
  <defs>
    <style>
      .path { fill: none; stroke-linecap: round; stroke-linejoin: round; }
      .label { font-family: system-ui, -apple-system, sans-serif; font-size: ${(vbH / 24) * 2.2}px; fill: #64748b; }
    </style>
  </defs>

  <!-- Background -->
  <rect x="0" y="0" width="${vbW}" height="${vbH}" fill="#0f172a" rx="${vbW / 12}"/>

  <!-- From path (subtle) -->
  <path id="from" d="${fromD}" class="path"
        stroke="${fromColor}" stroke-width="${strokeWidth * 0.7}" opacity="0.35"/>

  <!-- To path (subtle) -->
  <path id="to" d="${toD}" class="path"
        stroke="${toColor}" stroke-width="${strokeWidth * 0.7}" opacity="0.35"/>

  <!-- Main morphing path -->
  <path id="morph" d="${fromD}" class="path"
        stroke="${morphColor}" stroke-width="${strokeWidth}"/>

  <script>
    (function() {
      var svg = document.currentScript.ownerSVGElement;
      var morph = svg.getElementById('morph');
      var from = [${fromNums.join(",")}];
      var to = [${toNums.join(",")}];
      var tpl = ${JSON.stringify(template)};
      var dur = ${duration};
      var loop = ${loop};
      var startTime = null;

      // Cubic-bezier easing (FAST_OUT_SLOW_IN)
      function ease(t) {
        // Attempt fast cubic-bezier(0.4, 0, 0.2, 1) via sample table
        var x1=0.4,y1=0,x2=0.2,y2=1;
        var lo=0,hi=1,mid;
        for(var i=0;i<16;i++){mid=(lo+hi)/2;var x=3*(1-mid)*(1-mid)*mid*x1+3*(1-mid)*mid*mid*x2+mid*mid*mid;if(x<t)lo=mid;else hi=mid;}
        return 3*(1-mid)*(1-mid)*mid*y1+3*(1-mid)*mid*mid*y2+mid*mid*mid;
      }

      function lerp(t) {
        var i = 0;
        return tpl.replace(/#\\d+#/g, function() {
          var v = from[i] + (to[i] - from[i]) * t;
          i++;
          return v.toFixed(3);
        });
      }

      function animate(ts) {
        if (!startTime) startTime = ts;
        var elapsed = (ts - startTime) / 1000;
        var rawT = (elapsed % dur) / dur;
        if (!loop && elapsed > dur) rawT = 1;
        var t = ease(rawT);
        morph.setAttribute('d', lerp(t));
        if (loop || elapsed < dur) requestAnimationFrame(animate);
      }

      requestAnimationFrame(animate);
      svg.addEventListener('click', function() { startTime = null; requestAnimationFrame(animate); });
    })();
  </script>
</svg>`;

  return svg;
}

/**
 * Triggers a download of the animated SVG.
 */

/**
 * Generates beautiful CSS @keyframes for the morph.
 * Can be used directly in web projects.
 */
export function exportCSSKeyframes(
  fromPath: PathData,
  toPath: PathData,
  name: string = "morph",
  duration: number = 1.2,
): string {
  const steps = 8;
  let keyframes = "";

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const d = getInterpolatedPath(fromPath, toPath, t);
    const percent = Math.round((i / steps) * 100);
    keyframes += `  ${percent}% { d: path("${d}"); }\n`;
  }

  return `
@keyframes ${name} {
${keyframes}}

.morph {
  animation: ${name} ${duration}s infinite ease-in-out;
}
`;
}

export function downloadCSSKeyframes(from: PathData, to: PathData, layerName: string) {
  const css = exportCSSKeyframes(from, to, layerName.toLowerCase().replace(/\s+/g, "-"));
  const blob = new Blob([css], { type: "text/css" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${layerName.toLowerCase().replace(/\s+/g, "-")}-keyframes.css`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadAnimatedSVG(
  fromPath: PathData,
  toPath: PathData,
  layerName: string = "Morph",
  options: ExportOptions = {},
) {
  const svgContent = exportAnimatedSVG(fromPath, toPath, layerName, options);
  const blob = new Blob([svgContent], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `${layerName.toLowerCase().replace(/\s+/g, "-")}-morph.svg`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const safeName = (value: string) => value.replace(/[^\w.]+/g, "_").replace(/^(\d)/, "_$1");

function styleAttrs(layer: Layer) {
  const attrs: string[] = [];
  const fillColor = layer.fillColor || "none";
  const strokeColor = layer.strokeColor || "";

  attrs.push(`fill="${escapeXml(fillColor)}"`);
  if ((layer.fillAlpha ?? 1) !== 1) attrs.push(`fill-opacity="${layer.fillAlpha}"`);
  if (strokeColor) attrs.push(`stroke="${escapeXml(strokeColor)}"`);
  if ((layer.strokeAlpha ?? 1) !== 1) attrs.push(`stroke-opacity="${layer.strokeAlpha}"`);
  if ((layer.strokeWidth ?? 0) > 0) attrs.push(`stroke-width="${layer.strokeWidth}"`);
  if ((layer.strokeLinecap ?? "butt") !== "butt") attrs.push(`stroke-linecap="${layer.strokeLinecap}"`);
  if ((layer.strokeLinejoin ?? "miter") !== "miter") attrs.push(`stroke-linejoin="${layer.strokeLinejoin}"`);
  if ((layer.strokeMiterLimit ?? 4) !== 4) attrs.push(`stroke-miterlimit="${layer.strokeMiterLimit}"`);
  if ((layer.fillType ?? "nonZero") === "evenOdd") attrs.push(`fill-rule="evenodd"`);
  return attrs.join(" ");
}

export function exportStaticSVG(layers: Layer[], options: ExportOptions = {}) {
  const { width = 512, height = 512, viewBoxWidth = 24, viewBoxHeight = 24 } = options;
  const paths = layers
    .filter((layer) => layer.visible !== false && layer.type !== "group")
    .map((layer) => {
      const d = pathToString(layer.from);
      if (!d) return "";
      return `  <path id="${escapeXml(safeName(layer.name))}" d="${escapeXml(d)}" ${styleAttrs(layer)} />`;
    })
    .filter(Boolean)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${viewBoxWidth} ${viewBoxHeight}">
${paths}
</svg>
`;
}

export function exportSvgSpritesheet(layer: Layer, options: ExportOptions = {}) {
  const { width = 512, height = 512, viewBoxWidth = 24, viewBoxHeight = 24, fps = 10, duration = 1.2 } = options;
  const frameCount = Math.max(2, Math.round(fps * duration));
  const frames = Array.from({ length: frameCount }, (_, index) => {
    const t = frameCount === 1 ? 0 : index / (frameCount - 1);
    const translateX = index * viewBoxWidth;
    const d = getInterpolatedPath(layer.from, layer.to, t);
    return `  <g id="${escapeXml(safeName(layer.name))}_frame_${index}" transform="translate(${translateX} 0)">
    <path d="${escapeXml(d)}" ${styleAttrs(layer)} />
  </g>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width * frameCount}" height="${height}" viewBox="0 0 ${viewBoxWidth * frameCount} ${viewBoxHeight}">
${frames}
</svg>
`;
}

export function exportVectorDrawable(layer: Layer, options: ExportOptions = {}) {
  const { width = 48, height = 48, viewBoxWidth = 24, viewBoxHeight = 24 } = options;
  const d = pathToString(layer.from);
  const fill = layer.fillColor || "@android:color/transparent";
  const stroke = layer.strokeColor || "";
  return `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="${width}dp"
    android:height="${height}dp"
    android:viewportWidth="${viewBoxWidth}"
    android:viewportHeight="${viewBoxHeight}">
  <path
      android:name="${escapeXml(safeName(layer.name))}"
      android:pathData="${escapeXml(d)}"
      android:fillColor="${escapeXml(fill)}"${stroke ? `
      android:strokeColor="${escapeXml(stroke)}"
      android:strokeWidth="${layer.strokeWidth ?? 1}"` : ""}
      android:fillAlpha="${layer.fillAlpha ?? 1}"
      android:strokeAlpha="${layer.strokeAlpha ?? 1}"
      android:strokeLineCap="${layer.strokeLinecap ?? "butt"}"
      android:strokeLineJoin="${layer.strokeLinejoin ?? "miter"}"
      android:strokeMiterLimit="${layer.strokeMiterLimit ?? 4}"
      android:fillType="${layer.fillType === "evenOdd" ? "evenOdd" : "nonZero"}"
      android:trimPathStart="${layer.trimPathStart ?? 0}"
      android:trimPathEnd="${layer.trimPathEnd ?? 1}"
      android:trimPathOffset="${layer.trimPathOffset ?? 0}" />
</vector>
`;
}

export function exportAnimatedVectorDrawable(layer: Layer, options: ExportOptions = {}) {
  const { duration = 1.2 } = options;
  const name = safeName(layer.name);
  const fromD = pathToString(layer.from);
  const toD = pathToString(layer.to);
  return `<animated-vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:drawable="@drawable/${name}_vector">
  <target
      android:name="${escapeXml(name)}"
      android:animation="@animator/${name}_morph" />
</animated-vector>

<!-- ${name}_vector.xml -->
${exportVectorDrawable(layer, options)}

<!-- animator/${name}_morph.xml -->
<objectAnimator xmlns:android="http://schemas.android.com/apk/res/android"
    android:duration="${Math.round(duration * 1000)}"
    android:propertyName="pathData"
    android:valueFrom="${escapeXml(fromD)}"
    android:valueTo="${escapeXml(toD)}"
    android:valueType="pathType"
    android:interpolator="@android:interpolator/fast_out_slow_in" />
`;
}

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
                      lc: layer.strokeLinecap === "round" ? 2 : layer.strokeLinecap === "square" ? 3 : 1,
                      lj: layer.strokeLinejoin === "round" ? 2 : layer.strokeLinejoin === "bevel" ? 3 : 1,
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
              ...(layer?.fillColor
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

export function exportProjectJSON(
  layers: Layer[],
  vector: VectorMetadata = {
    id: "vector",
    name: "ShapeShifter",
    width: 24,
    height: 24,
    alpha: 1,
  },
  animation: AnimationState = {
    id: "anim",
    name: "anim",
    duration: 1000,
    blocks: [],
  },
  hiddenLayerIds: string[] = [],
) {
  const byParent = new Map<string, Layer[]>();
  for (const layer of layers) {
    const parentKey = layer.parentId == null ? "__root__" : String(layer.parentId);
    byParent.set(parentKey, [...(byParent.get(parentKey) ?? []), layer]);
  }

  const serializeLayer = (layer: Layer): Record<string, unknown> => {
    const base = {
      id: String(layer.id),
      name: layer.name,
      type: layer.type === "clipPath" ? "clipPath" : layer.type === "group" ? "group" : "path",
    };

    if (layer.type === "group") {
      return {
        ...base,
        rotation: layer.rotation ?? 0,
        scaleX: layer.scaleX ?? 1,
        scaleY: layer.scaleY ?? 1,
        pivotX: layer.pivotX ?? 0,
        pivotY: layer.pivotY ?? 0,
        translateX: layer.translateX ?? 0,
        translateY: layer.translateY ?? 0,
        children: (byParent.get(String(layer.id)) ?? []).map(serializeLayer),
      };
    }

    return {
      ...base,
      pathData: pathToString(layer.pathData ?? layer.from),
      fillColor: layer.fillColor ?? "",
      fillAlpha: layer.fillAlpha ?? 1,
      strokeColor: layer.strokeColor ?? "",
      strokeAlpha: layer.strokeAlpha ?? 1,
      strokeWidth: layer.strokeWidth ?? 0,
      strokeLinecap: layer.strokeLinecap ?? "butt",
      strokeLinejoin: layer.strokeLinejoin ?? "miter",
      strokeMiterLimit: layer.strokeMiterLimit ?? 4,
      trimPathStart: layer.trimPathStart ?? 0,
      trimPathEnd: layer.trimPathEnd ?? 1,
      trimPathOffset: layer.trimPathOffset ?? 0,
      fillType: layer.fillType ?? "nonZero",
    };
  };

  const children = (byParent.get("__root__") ?? []).map(serializeLayer);

  return {
    version: 1,
    layers: {
      vectorLayer: {
        id: String(vector.id),
        name: vector.name,
        type: "vector",
        width: vector.width,
        height: vector.height,
        alpha: vector.alpha,
        children,
      },
      hiddenLayerIds,
    },
    timeline: {
      animation,
    },
  };
}
