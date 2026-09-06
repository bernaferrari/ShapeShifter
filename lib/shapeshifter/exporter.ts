/**
 * ShapeShifter 2026 - Exporters
 * Export functionality for ShapeShifter's supported animation formats.
 */

import type { Layer, PathData } from "./types";
import { getInterpolatedPath, pathToString } from "./pathUtils";
import { gradientDomId, gradientToSvg, sanitizeCssColor, svgIdFragment } from "./gradients";
import type {
  ExportOptions,
  StaticSvgDiagnostic,
  StaticSvgExportOptions,
  StaticSvgExportResult,
} from "./export/types";
import { createLayerTreeModel } from "./scene/layerHierarchy";
import { layerTransformToSvg } from "./scene/layerTransform";

export { downloadLottie, exportLottie, exportLottieDocument } from "./export/lottie";
export { exportPDF } from "./export/pdf";
export { exportProjectJSON } from "./export/projectJson";
export { exportAnimatedVectorDrawable, exportVectorDrawable } from "./export/android";
export type {
  ExportOptions,
  StaticSvgDiagnostic,
  StaticSvgExportOptions,
  StaticSvgExportResult,
  StaticSvgRootMetadata,
} from "./export/types";

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

const safeName = (value: string) => {
  const normalized = value.replace(/[^\w.-]+/g, "_");
  if (!normalized) return "layer";
  const prefixed = /^[A-Za-z_]/.test(normalized) ? normalized : `_${normalized}`;
  return prefixed;
};

function staticOpacity(value: number | undefined, fallback = 1) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, Number(value))) : fallback;
}

function opacityAttribute(name: string, value: number) {
  return value === 1 ? "" : `${name}="${Number(value.toFixed(6))}"`;
}

/**
 * Android VectorDrawable defaults tintMode to src_in. SVG has no equivalent for
 * every Android Porter-Duff mode, but src_in maps directly to a tint-colored
 * rectangle masked by the scene's alpha. Other modes deliberately remain
 * unpainted and are surfaced as a diagnostic rather than silently misrendered.
 */
function staticSvgRootTint(
  rootVector: StaticSvgExportOptions["rootVector"],
  diagnostics: StaticSvgDiagnostic[],
): string | undefined {
  if (!rootVector) return undefined;
  const tint = rootVector.tint?.trim();
  if (!tint) return undefined;

  const tintMode = rootVector.tintMode?.trim().toLowerCase().replaceAll("-", "_");
  if (tintMode && tintMode !== "src_in") {
    diagnostics.push({
      severity: "warning",
      code: "ROOT_TINT_MODE_UNSUPPORTED",
      message: `Static SVG omitted root tint because Android tintMode "${rootVector.tintMode}" is not representable; only src_in is supported.`,
    });
    return undefined;
  }

  // Android resource and theme references cannot be resolved without an Android
  // resource table. Do not substitute a fallback color, which would claim a
  // visual fidelity the export does not have.
  const cssTint = sanitizeCssColor(tint, "");
  if (!cssTint) {
    diagnostics.push({
      severity: "warning",
      code: "ROOT_TINT_UNRESOLVED",
      message: `Static SVG omitted unresolved root tint "${tint}"; use a literal CSS color for static SVG export.`,
    });
    return undefined;
  }

  return cssTint;
}

function indentSvgBlock(value: string, indent: string) {
  return value
    .split("\n")
    .map((line) => `${indent}${line}`)
    .join("\n");
}

function styleAttrs(layer: Layer, inheritedAlpha = 1, gradientId?: string) {
  const attrs: string[] = [];
  const strokeColor = layer.strokeColor || "";
  const fillOpacity = staticOpacity(layer.fillAlpha) * inheritedAlpha;
  const strokeOpacity = staticOpacity(layer.strokeAlpha) * inheritedAlpha;

  if (layer.fillGradient) {
    // Gradient opacity is baked into its stops, including inherited group alpha.
    attrs.push(`fill="url(#${gradientId ?? gradientDomId(layer.id)})"`);
  } else {
    attrs.push(`fill="${escapeXml(layer.fillColor || "none")}"`);
    const fillAlpha = opacityAttribute("fill-opacity", fillOpacity);
    if (fillAlpha) attrs.push(fillAlpha);
  }
  if (strokeColor) attrs.push(`stroke="${escapeXml(strokeColor)}"`);
  const strokeAlpha = opacityAttribute("stroke-opacity", strokeOpacity);
  if (strokeAlpha) attrs.push(strokeAlpha);
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

/**
 * Export a static SVG scene with diagnostics for root VectorDrawable semantics
 * that cannot be reproduced in a portable SVG.
 */
export function exportStaticSVGWithDiagnostics(
  layers: Layer[],
  options: StaticSvgExportOptions = {},
): StaticSvgExportResult {
  const { width = 512, height = 512, viewBoxWidth = 48, viewBoxHeight = 48 } = options;
  const diagnostics: StaticSvgDiagnostic[] = [];
  const rootAlpha = staticOpacity(options.rootVector?.alpha);
  const rootTint = staticSvgRootTint(options.rootVector, diagnostics);

  const tree = createLayerTreeModel(layers);

  const usedDomIds = new Set<string>();
  const reserveDomId = (preferred: string) => {
    let candidate = preferred;
    let suffix = 2;
    while (usedDomIds.has(candidate)) candidate = `${preferred}_${suffix++}`;
    usedDomIds.add(candidate);
    return candidate;
  };
  const layerDomIds = new Map<Layer, string>();
  const clipDomIds = new Map<Layer, string>();
  const gradientDomIds = new Map<Layer, string>();
  for (const layer of tree.allLayers) {
    layerDomIds.set(layer, reserveDomId(safeName(layer.name)));
  }
  for (const layer of tree.allLayers) {
    if (layer.type === "clipPath") {
      clipDomIds.set(layer, reserveDomId(`ss-clip-${svgIdFragment(layer.id)}`));
    }
    if (layer.type !== "group" && layer.type !== "vector" && layer.fillGradient) {
      gradientDomIds.set(layer, reserveDomId(gradientDomId(layer.id)));
    }
  }

  const effectiveAlpha = new Map<Layer, number>();
  const collectEffectiveAlpha = (layer: Layer, parentAlpha: number) => {
    const alpha = parentAlpha * staticOpacity(layer.alpha);
    effectiveAlpha.set(layer, alpha);
    for (const child of tree.childrenOf(layer)) collectEffectiveAlpha(child, alpha);
  };
  for (const root of tree.roots) collectEffectiveAlpha(root, 1);

  const transformAttr = (layer: Layer) => {
    const transform = layerTransformToSvg(layer);
    return transform ? ` transform="${transform}"` : "";
  };

  const wrapWithClips = (content: string, clips: Layer[], indent: string) =>
    clips.reduceRight(
      (wrapped, clip) =>
        `${indent}<g clip-path="url(#${clipDomIds.get(clip)!})">\n${wrapped}\n${indent}</g>`,
      content,
    );

  function renderLayer(layer: Layer, indent = "  "): string {
    if (layer.visible === false || layer.type === "clipPath") return "";
    const idAttr = ` id="${layerDomIds.get(layer)!}"`;
    if (layer.type === "group" || layer.type === "vector") {
      const rendered = renderSiblings(tree.childrenOf(layer), `${indent}  `);
      if (!rendered) return "";
      return `${indent}<g${idAttr}${transformAttr(layer)}>\n${rendered}\n${indent}</g>`;
    }
    const d = pathToString(layer.pathData ?? layer.from);
    if (!d) return "";
    return `${indent}<path${idAttr} d="${escapeXml(d)}"${transformAttr(layer)} ${styleAttrs(
      layer,
      effectiveAlpha.get(layer) ?? 1,
      gradientDomIds.get(layer),
    )} />`;
  }

  function renderSiblings(siblings: Layer[], indent: string): string {
    const activeClips: Layer[] = [];
    const rendered: string[] = [];
    for (const layer of siblings) {
      if (layer.type === "clipPath") {
        if (layer.visible !== false) activeClips.push(layer);
        continue;
      }
      const content = renderLayer(layer, indent);
      if (content) rendered.push(wrapWithClips(content, activeClips, indent));
    }
    return rendered.join("\n");
  }

  const clipDefs: string[] = [];
  const gradientDefs: string[] = [];
  for (const layer of tree.allLayers) {
    if (layer.visible === false) continue;
    if (layer.type === "clipPath") {
      const d = pathToString(layer.pathData ?? layer.from);
      if (d) {
        clipDefs.push(
          `  <clipPath id="${clipDomIds.get(layer)!}"><path d="${escapeXml(d)}"${transformAttr(layer)}${
            layer.fillType === "evenOdd" ? ' clip-rule="evenodd"' : ""
          } /></clipPath>`,
        );
      }
    }
    if (layer.type !== "group" && layer.type !== "vector" && layer.fillGradient) {
      gradientDefs.push(
        `  ${gradientToSvg(
          layer.fillGradient,
          gradientDomIds.get(layer)!,
          staticOpacity(layer.fillAlpha) * (effectiveAlpha.get(layer) ?? 1),
        )}`,
      );
    }
  }

  const content = renderSiblings(tree.roots, "  ");
  // Reserve the root mask after scene IDs so an author-created layer can never
  // collide with the generated tint reference.
  const rootTintMaskId = rootTint && content ? reserveDomId("ss-root-tint-mask") : undefined;
  if (rootTintMaskId) {
    diagnostics.push({
      severity: "warning",
      code: "ROOT_TINT_MASK_NOT_REIMPORTABLE",
      message:
        "Static SVG root tint is encoded as an alpha mask and cannot be restored by ShapeShifter SVG import.",
    });
  }

  const rootTintMask = rootTintMaskId
    ? `  <mask id="${rootTintMaskId}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="${viewBoxWidth}" height="${viewBoxHeight}" mask-type="alpha">
${indentSvgBlock(content, "    ")}
  </mask>`
    : "";
  const allDefs = [...clipDefs, ...gradientDefs, ...(rootTintMask ? [rootTintMask] : [])];
  const defs = allDefs.length ? `  <defs>\n${allDefs.join("\n")}\n  </defs>\n` : "";
  const paintedContent = rootTintMaskId
    ? `  <rect x="0" y="0" width="${viewBoxWidth}" height="${viewBoxHeight}" fill="${rootTint}" mask="url(#${rootTintMaskId})" />`
    : content;
  // Keep root alpha as a compositing group, rather than baking it into each
  // path. This retains VectorDrawable's whole-scene alpha behavior where
  // overlapping translucent children must composite before alpha is applied.
  const rootContent =
    rootAlpha === 1 || !paintedContent
      ? paintedContent
      : `  <g ${opacityAttribute("opacity", rootAlpha)}>
${indentSvgBlock(paintedContent, "  ")}
  </g>`;

  return {
    svg: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${viewBoxWidth} ${viewBoxHeight}">
${defs}${rootContent}
</svg>
`,
    diagnostics,
  };
}

/** Backward-compatible static SVG content API. Use the diagnostic variant in UI flows. */
export function exportStaticSVG(layers: Layer[], options: StaticSvgExportOptions = {}) {
  return exportStaticSVGWithDiagnostics(layers, options).svg;
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
