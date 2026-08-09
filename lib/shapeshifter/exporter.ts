/**
 * ShapeShifter 2026 - Exporters
 * Production-grade export functionality for morph animations.
 */

import type { Layer, PathData } from "./types";
import { getInterpolatedPath, pathToString } from "./pathUtils";
import { gradientDomId, gradientToSvg } from "./gradients";
import type { ExportOptions } from "./export/types";

export { downloadLottie, exportLottie, exportLottieDocument } from "./export/lottie";
export { exportPDF } from "./export/pdf";
export { exportProjectJSON } from "./export/projectJson";
export { exportAnimatedVectorDrawable, exportVectorDrawable } from "./export/android";
export type { ExportOptions } from "./export/types";

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
    viewBoxWidth = 48,
    viewBoxHeight = 48,
    loop = true,
    strokeWidth = 2.5,
    fromColor = "#3b82f6",
    toColor = "#8b5cf6",
    morphColor = "#22c55e",
  } = options;

  const fromD = pathToString(fromPath);
  const toD = pathToString(toPath);

  // Bake N sampled frames through the SAME getInterpolatedPath the on-canvas
  // preview uses. This guarantees the exported morph matches the preview even
  // when from/to have different command structures (the old per-number lerp
  // over the FROM skeleton silently dropped surplus target numbers and produced
  // a truncated 'to' shape). Easing is applied at playback via the frame index.
  const FRAME_COUNT = 60;
  const frames: string[] = [];
  for (let i = 0; i < FRAME_COUNT; i++) {
    const t = i / (FRAME_COUNT - 1);
    frames.push(getInterpolatedPath(fromPath, toPath, t));
  }
  const framesJson = JSON.stringify(frames);

  const vbW = viewBoxWidth;
  const vbH = viewBoxHeight;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${vbW} ${vbH}">
  <title>${escapeXml(layerName)}</title>
  <desc>MORPH</desc>
  <defs>
    <style>
      .path { fill: none; stroke-linecap: round; stroke-linejoin: round; }
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
      var frames = ${framesJson};
      const duration = ${duration};
      const loop = ${loop};
      var startTime = null;

      // Cubic-bezier easing (FAST_OUT_SLOW_IN) — matches the canvas preview.
      function ease(t) {
        var x1=0.4,y1=0,x2=0.2,y2=1;
        var lo=0,hi=1,mid;
        for(var i=0;i<16;i++){mid=(lo+hi)/2;var x=3*(1-mid)*(1-mid)*mid*x1+3*(1-mid)*mid*mid*x2+mid*mid*mid;if(x<t)lo=mid;else hi=mid;}
        return 3*(1-mid)*(1-mid)*mid*y1+3*(1-mid)*mid*mid*y2+mid*mid*mid;
      }

      function animate(ts) {
        if (!startTime) startTime = ts;
        var elapsed = (ts - startTime) / 1000;
        var rawT = (elapsed % duration) / duration;
        if (!loop && elapsed > duration) rawT = 1;
        var easedT = ease(rawT);
        var idx = Math.min(frames.length - 1, Math.max(0, Math.round(easedT * (frames.length - 1))));
        morph.setAttribute('d', frames[idx]);
        if (loop || elapsed < duration) requestAnimationFrame(animate);
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
  const strokeColor = layer.strokeColor || "";

  if (layer.fillGradient) {
    // Gradient fill references a <defs> entry; fillAlpha is baked into the stops.
    attrs.push(`fill="url(#${gradientDomId(layer.id)})"`);
  } else {
    attrs.push(`fill="${escapeXml(layer.fillColor || "none")}"`);
    if ((layer.fillAlpha ?? 1) !== 1) attrs.push(`fill-opacity="${layer.fillAlpha}"`);
  }
  if (strokeColor) attrs.push(`stroke="${escapeXml(strokeColor)}"`);
  if ((layer.strokeAlpha ?? 1) !== 1) attrs.push(`stroke-opacity="${layer.strokeAlpha}"`);
  if ((layer.strokeWidth ?? 0) > 0) attrs.push(`stroke-width="${layer.strokeWidth}"`);
  if ((layer.strokeLinecap ?? "butt") !== "butt")
    attrs.push(`stroke-linecap="${layer.strokeLinecap}"`);
  if ((layer.strokeLinejoin ?? "miter") !== "miter")
    attrs.push(`stroke-linejoin="${layer.strokeLinejoin}"`);
  if ((layer.strokeMiterLimit ?? 4) !== 4)
    attrs.push(`stroke-miterlimit="${layer.strokeMiterLimit}"`);
  if ((layer.fillType ?? "nonZero") === "evenOdd") attrs.push(`fill-rule="evenodd"`);
  // Variable stroke / dash support (kus fidelity for advanced styles post-edit)
  if (layer.strokeDasharray) attrs.push(`stroke-dasharray="${escapeXml(layer.strokeDasharray)}"`);
  return attrs.join(" ");
}

export function exportStaticSVG(layers: Layer[], options: ExportOptions = {}) {
  const { width = 512, height = 512, viewBoxWidth = 48, viewBoxHeight = 48 } = options;

  const roundCoord = (v: number) => (Number.isFinite(v) ? Number(v.toFixed(3)) : 0);

  // Build transform string from Layer transform props (for group + path fidelity, freeform-aware)
  const buildTransform = (layer: Layer): string => {
    const parts: string[] = [];
    const tx = layer.translateX ?? 0;
    const ty = layer.translateY ?? 0;
    if (tx !== 0 || ty !== 0) parts.push(`translate(${roundCoord(tx)} ${roundCoord(ty)})`);
    const sx = layer.scaleX ?? 1;
    const sy = layer.scaleY ?? 1;
    if (sx !== 1 || sy !== 1) parts.push(`scale(${roundCoord(sx)} ${roundCoord(sy)})`);
    const rot = layer.rotation ?? 0;
    if (rot !== 0) {
      const px = layer.pivotX ?? 0;
      const py = layer.pivotY ?? 0;
      parts.push(
        px || py
          ? `rotate(${roundCoord(rot)} ${roundCoord(px)} ${roundCoord(py)})`
          : `rotate(${roundCoord(rot)})`,
      );
    }
    return parts.join(" ");
  };

  // Recursive renderer for full fidelity: groups, clips, pathData (post knife/boolean/paint edits), styles, transforms
  const renderLayer = (layer: Layer, indent = "  "): string => {
    if (layer.visible === false) return "";
    const transform = buildTransform(layer);
    const transformAttr = transform ? ` transform="${transform}"` : "";
    const idAttr = ` id="${escapeXml(safeName(layer.name))}"`;

    if (layer.type === "group") {
      const children = (layer.children ?? [])
        .map((child) => renderLayer(child, indent + "  "))
        .filter(Boolean)
        .join("\n");
      if (!children) return "";
      return `${indent}<g${idAttr}${transformAttr}>\n${children}\n${indent}</g>`;
    }

    // Use pathData (current edited state from tools) ?? from for roundtrip fidelity with knife/booleans/paint/direct
    const d = pathToString(layer.pathData ?? layer.from);
    if (!d) return "";

    if (layer.type === "clipPath") {
      // Fidelity for clipPath: emit as <clipPath> in defs context (importers bake; export preserves structure)
      return `${indent}<clipPath${idAttr}>\n${indent}  <path d="${escapeXml(d)}" ${styleAttrs(layer)} />\n${indent}</clipPath>`;
    }

    // Standard path (or clip content flattened for simple consumers)
    return `${indent}<path${idAttr} d="${escapeXml(d)}"${transformAttr} ${styleAttrs(layer)} />`;
  };

  // Separate defs for clipPaths to enable proper referencing in advanced use (kus complex case support)
  const clipDefs: string[] = [];
  const collectClips = (layer: Layer) => {
    if (layer.type === "clipPath" && layer.visible !== false) {
      const d = pathToString(layer.pathData ?? layer.from);
      if (d) {
        clipDefs.push(
          `  <clipPath id="${escapeXml(safeName(layer.name))}"><path d="${escapeXml(d)}" ${styleAttrs(layer)} /></clipPath>`,
        );
      }
    }
    (layer.children ?? []).forEach(collectClips);
  };
  layers.forEach(collectClips);

  // Gradient defs (real <linearGradient>/<radialGradient> for faithful SVG output).
  const gradientDefs: string[] = [];
  const collectGradients = (layer: Layer) => {
    if (layer.type !== "group" && layer.visible !== false && layer.fillGradient) {
      gradientDefs.push(
        `  ${gradientToSvg(layer.fillGradient, gradientDomId(layer.id), layer.fillAlpha ?? 1)}`,
      );
    }
    (layer.children ?? []).forEach(collectGradients);
  };
  layers.forEach(collectGradients);

  const content = layers
    .map((l) => renderLayer(l))
    .filter(Boolean)
    .join("\n");

  const allDefs = [...clipDefs, ...gradientDefs];
  const defs = allDefs.length ? `  <defs>\n${allDefs.join("\n")}\n  </defs>\n` : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${viewBoxWidth} ${viewBoxHeight}">
${defs}${content}
</svg>
`;
}

export function exportSvgSpritesheet(layer: Layer, options: ExportOptions = {}) {
  const {
    width = 512,
    height = 512,
    viewBoxWidth = 48,
    viewBoxHeight = 48,
    fps = 10,
    duration = 1.2,
  } = options;
  const frameCount = Math.max(2, Math.round(fps * duration));
  // Use pathData ?? from for the animation base (fidelity after direct edits on current side)
  const baseFrom = layer.pathData ?? layer.from;
  const frames = Array.from({ length: frameCount }, (_, index) => {
    const t = frameCount === 1 ? 0 : index / (frameCount - 1);
    const translateX = index * viewBoxWidth;
    const d = getInterpolatedPath(baseFrom, layer.to ?? baseFrom, t);
    return `  <g id="${escapeXml(safeName(layer.name))}_frame_${index}" transform="translate(${translateX} 0)">
    <path d="${escapeXml(d)}" ${styleAttrs(layer)} />
  </g>`;
  }).join("\n");

  const defs = layer.fillGradient
    ? `  <defs>\n  ${gradientToSvg(layer.fillGradient, gradientDomId(layer.id), layer.fillAlpha ?? 1)}\n  </defs>\n`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width * frameCount}" height="${height}" viewBox="0 0 ${viewBoxWidth * frameCount} ${viewBoxHeight}">
${defs}${frames}
</svg>
`;
}
