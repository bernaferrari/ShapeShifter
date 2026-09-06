import {
  IDENTITY_AFFINE,
  layerTransformToMatrix,
  multiplyAffine,
  transformPointWithMatrix,
  type AffineMatrix,
} from "../scene/layerTransform";
import { createLayerTreeModel } from "../scene/layerHierarchy";
import { dominantColor } from "../gradients";
import { parseEditorColor } from "../playheadResolve";
import { normalizePathData } from "../pathUtils";
import type { Layer, Point } from "../types";
import type { ExportOptions } from "./types";

/**
 * Minimal professional PDF vector exporter (kus/24t PDF roundtrips).
 * Pure TS, no deps: outputs valid PDF 1.4 with path geometry + basic styles preserved.
 * Uses current pathData ?? from + groups flattened for max compatibility.
 * Error tolerant: skips bad paths.
 */
export function exportPDF(layers: Layer[], options: ExportOptions = {}): string {
  const { width = 512, height = 512, viewBoxWidth = 48, viewBoxHeight = 48 } = options;
  const vw = viewBoxWidth || 48;
  const vh = viewBoxHeight || 48;
  // The page IS the unit conversion: one points-per-unit factor derives from
  // the requested page size, and both the MediaBox and every emitted
  // coordinate use it. A single source prevents the content scale and the
  // page size from ever drifting apart (the artwork always fits the page).
  const pdfW = Math.round(width);
  const pdfH = Math.round(height);
  const scale = Math.min(pdfW / vw, pdfH / vh);
  const marginX = (pdfW - vw * scale) / 2;
  const topY = vh * scale + (pdfH - vh * scale) / 2;

  const px = (x: number) => (marginX + x * scale).toFixed(2);
  // PDF y-axis points up; flip into page space (centered letterbox margins).
  const py = (y: number) => (topY - y * scale).toFixed(2);

  const contentOps: string[] = [];

  const addPath = (layer: Layer, matrix: AffineMatrix) => {
    if (!layer.pathData && !layer.from) return;
    const pathData = layer.pathData ?? layer.from;
    if (!pathData?.subPaths?.length || layer.type === "group") return;
    // Normalize once: elliptical arcs flatten to cubic Béziers and S/T
    // shorthands expand to C/Q, so every remaining command maps onto an
    // exact PDF operator (m/l/c/h). No command kind is silently dropped.
    const normalized = normalizePathData(pathData);
    const emit = (s: string) => contentOps.push(s);
    let cur: Point | null = null;
    let started = false;

    // Bake every ancestor group transform into geometry up front so each
    // emitted operator uses final page coordinates.
    const xf = (p: Point): Point => transformPointWithMatrix(p, matrix);
    for (const subPath of normalized.subPaths) {
      for (const cmd of subPath.commands) {
        const pts = cmd.points.map(xf);
        switch (cmd.type) {
          case "M": {
            const p = pts[0];
            if (!p) break;
            emit(`${px(p.x)} ${py(p.y)} m`);
            cur = p;
            started = true;
            break;
          }
          case "L":
          case "H":
          case "V": {
            const p = pts[pts.length - 1];
            if (!p || !cur) break;
            emit(`${px(p.x)} ${py(p.y)} l`);
            cur = p;
            started = true;
            break;
          }
          case "C": {
            if (pts.length < 3 || !cur) break;
            const [c1, c2, end] = pts;
            emit(`${px(c1.x)} ${py(c1.y)} ${px(c2.x)} ${py(c2.y)} ${px(end.x)} ${py(end.y)} c`);
            cur = end;
            started = true;
            break;
          }
          case "Q": {
            if (pts.length < 2 || !cur) break;
            const [cp, end] = pts;
            // Exact quadratic → cubic elevation (2/3 rule), anchored at the
            // real current point.
            const c1 = {
              x: cur.x + (2 / 3) * (cp.x - cur.x),
              y: cur.y + (2 / 3) * (cp.y - cur.y),
            };
            const c2 = {
              x: end.x + (2 / 3) * (cp.x - end.x),
              y: end.y + (2 / 3) * (cp.y - end.y),
            };
            emit(`${px(c1.x)} ${py(c1.y)} ${px(c2.x)} ${py(c2.y)} ${px(end.x)} ${py(end.y)} c`);
            cur = end;
            started = true;
            break;
          }
          case "Z":
            if (started) emit("h");
            break;
        }
      }
    }

    // Style: fill then stroke (PDF paint order). PDF axial/radial shadings are heavy;
    // approximate a gradient with its dominant stop color.
    const fill = layer.fillGradient
      ? dominantColor(layer.fillGradient)
      : layer.fillColor && layer.fillColor !== "none"
        ? layer.fillColor
        : null;
    const stroke = layer.strokeColor || null;
    const det = Math.abs(matrix.a * matrix.d - matrix.b * matrix.c);
    const sw = Math.max(0.1, (layer.strokeWidth ?? 1) * scale * Math.sqrt(det || 1));
    if (fill) {
      // simple rgb (ignore alpha for minimal PDF). Colors arrive as CSS hex,
      // rgb() or named forms from imports; parseEditorColor resolves all of
      // them, so unknown formats fall back to black instead of NaN channels.
      const f = parseEditorColor(fill) ?? { r: 0, g: 0, b: 0, a: 0 };
      emit(`${(f.r / 255).toFixed(3)} ${(f.g / 255).toFixed(3)} ${(f.b / 255).toFixed(3)} rg`);
      emit("f");
    }
    if (stroke) {
      const s = parseEditorColor(stroke) ?? { r: 0, g: 0, b: 0, a: 0 };
      emit(`${(s.r / 255).toFixed(3)} ${(s.g / 255).toFixed(3)} ${(s.b / 255).toFixed(3)} RG`);
      emit(`${sw.toFixed(2)} w`);
      emit("S");
    }
  };

  // Depth-first traversal composing each node's Android-style transform
  // (scale/rotate/translate around its pivot) onto its ancestors' matrix, so
  // grouped artwork lands where the canvas draws it instead of at raw coords.
  // The canonical resolver handles both embedded group children and the flat
  // parentId links that imports produce, so both representations traverse
  // identically (group transforms/hiding apply either way).
  const tree = createLayerTreeModel(layers);
  const walk = (layer: Layer, matrix: AffineMatrix = IDENTITY_AFFINE) => {
    if (layer.type === "clipPath") {
      // PDF has no clip concept in this minimal exporter; warn rather than
      // silently export clipped artwork unclipped.
      console.warn(
        `[pdf] Clip path "${layer.name}" was skipped: PDF export does not support clipping.`,
      );
      return;
    }
    if (layer.visible === false) return;
    const composed = multiplyAffine(matrix, layerTransformToMatrix(layer));
    const children = tree.childrenOf(layer);
    if (children.length > 0) children.forEach((child) => walk(child, composed));
    else addPath(layer, composed);
  };
  tree.roots.forEach((layer) => walk(layer));

  const content = contentOps.join("\n  ");
  const stream = `q\n  ${content}\nQ`;

  // Hand-rolled minimal PDF (valid, viewable in any reader; no xobject bloat).
  // Objects are serialized sequentially while accumulating their real byte
  // offsets so the xref table and startxref are spec-accurate (strict parsers
  // reject fabricated offsets). Output is ASCII, so string length == bytes.
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${pdfW} ${pdfH}]/Contents 4 0 R/Resources<</ProcSet[/PDF]>>>>`,
    `<</Length ${stream.length}>>stream\n${stream}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj${body}endobj\n`;
  });

  const startxref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${startxref}\n%%EOF\n`;
  return pdf;
}
