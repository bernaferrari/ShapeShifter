import {
  IDENTITY_AFFINE,
  layerTransformToMatrix,
  multiplyAffine,
  transformPointWithMatrix,
  type AffineMatrix,
} from "../scene/layerTransform";
import { createLayerTreeModel } from "../scene/layerHierarchy";
import { dominantColor, normalizeStops } from "../gradients";
import { parseEditorColor } from "../playheadResolve";
import { normalizePathData } from "../pathUtils";
import { trimPathData } from "../path/pathTrim";
import type { Layer, PathData, Point } from "../types";
import type { ExportOptions } from "./types";

export interface PdfExportOptions extends ExportOptions {
  rootAlpha?: number;
}

export interface PdfExportDiagnostic {
  severity: "warning";
  code: string;
  layerId?: string | number;
  message: string;
}

export interface PdfExportResult {
  pdf: string;
  diagnostics: PdfExportDiagnostic[];
}

/** PDF 1.4 vector output of the base scene, with ordered clips and paint styles. */
export function exportPDF(layers: Layer[], options: PdfExportOptions = {}): string {
  return exportPDFWithDiagnostics(layers, options).pdf;
}

export function exportPDFWithDiagnostics(
  layers: Layer[],
  options: PdfExportOptions = {},
): PdfExportResult {
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
  const diagnostics: PdfExportDiagnostic[] = [];
  const alphaStates = new Map<string, { name: string; fill: number; stroke: number }>();
  const emit = (value: string) => contentOps.push(value);
  const clampAlpha = (value: number | undefined) =>
    Number.isFinite(value) ? Math.max(0, Math.min(1, value!)) : 1;
  const applyAlpha = (fill: number, stroke: number) => {
    if (fill === 1 && stroke === 1) return;
    const key = `${fill.toFixed(6)}:${stroke.toFixed(6)}`;
    let state = alphaStates.get(key);
    if (!state) {
      state = { name: `GS${alphaStates.size + 1}`, fill, stroke };
      alphaStates.set(key, state);
    }
    emit(`/${state.name} gs`);
  };

  const emitGeometry = (pathData: PathData, matrix: AffineMatrix) => {
    // Normalize once: elliptical arcs flatten to cubic Béziers and S/T
    // shorthands expand to C/Q, so every remaining command maps onto an
    // exact PDF operator (m/l/c/h). No command kind is silently dropped.
    const normalized = normalizePathData(pathData);
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
    return normalized;
  };

  const addPath = (layer: Layer, matrix: AffineMatrix, inheritedAlpha: number) => {
    const pathData = trimPathData(
      layer.pathData ?? layer.from,
      layer.trimPathStart ?? 0,
      layer.trimPathEnd ?? 1,
      layer.trimPathOffset ?? 0,
    );
    if (!pathData?.subPaths?.length || layer.type === "group") return;
    emit("q");
    emitGeometry(pathData, matrix);

    // Style: fill then stroke (PDF paint order). PDF axial/radial shadings are heavy;
    // approximate a gradient with its dominant stop color.
    const fill = layer.fillGradient
      ? dominantColor(layer.fillGradient)
      : layer.fillColor && layer.fillColor !== "none"
        ? layer.fillColor
        : null;
    if (layer.fillGradient) {
      diagnostics.push({
        severity: "warning",
        code: "GRADIENT_APPROXIMATED",
        layerId: layer.id,
        message: `PDF replaces the gradient on "${layer.name}" with a representative solid color.`,
      });
    }
    const strokeWidth = layer.strokeWidth ?? 1;
    const stroke =
      layer.strokeColor &&
      layer.strokeColor.toLowerCase() !== "none" &&
      Number.isFinite(strokeWidth) &&
      strokeWidth > 0
        ? layer.strokeColor
        : null;
    const det = Math.abs(matrix.a * matrix.d - matrix.b * matrix.c);
    const strokeScale = scale * Math.sqrt(det || 1);
    const sw = strokeWidth * strokeScale;
    const f = fill ? (parseEditorColor(fill) ?? { r: 0, g: 0, b: 0, a: 255 }) : null;
    const s = stroke ? (parseEditorColor(stroke) ?? { r: 0, g: 0, b: 0, a: 255 }) : null;
    const alpha = clampAlpha(inheritedAlpha) * clampAlpha(layer.alpha);
    const gradientStopAlpha = layer.fillGradient
      ? Math.max(
          ...normalizeStops(layer.fillGradient.stops)
            .filter((stop) => stop.color === fill)
            .map((stop) => stop.opacity ?? 1),
          0,
        )
      : 1;
    applyAlpha(
      clampAlpha(alpha * clampAlpha(layer.fillAlpha) * ((f?.a ?? 255) / 255) * gradientStopAlpha),
      clampAlpha(alpha * clampAlpha(layer.strokeAlpha) * ((s?.a ?? 255) / 255)),
    );
    if (fill) {
      emit(`${(f!.r / 255).toFixed(3)} ${(f!.g / 255).toFixed(3)} ${(f!.b / 255).toFixed(3)} rg`);
    }
    if (stroke) {
      emit(`${(s!.r / 255).toFixed(3)} ${(s!.g / 255).toFixed(3)} ${(s!.b / 255).toFixed(3)} RG`);
      emit(`${sw.toFixed(2)} w`);
      emit(`${layer.strokeLinecap === "round" ? 1 : layer.strokeLinecap === "square" ? 2 : 0} J`);
      emit(`${layer.strokeLinejoin === "round" ? 1 : layer.strokeLinejoin === "bevel" ? 2 : 0} j`);
      emit(`${Math.max(1, layer.strokeMiterLimit ?? 4)} M`);
      if (layer.strokeDasharray) {
        const values = layer.strokeDasharray
          .trim()
          .split(/[\s,]+/)
          .map(Number);
        if (
          values.every((value) => Number.isFinite(value) && value >= 0) &&
          values.some((value) => value > 0)
        )
          emit(`[${values.map((value) => (value * strokeScale).toFixed(4)).join(" ")}] 0 d`);
        else
          diagnostics.push({
            severity: "warning",
            code: "INVALID_STROKE_DASHES",
            layerId: layer.id,
            message: `PDF skipped an invalid stroke dash pattern on "${layer.name}".`,
          });
      }
      const columnX = Math.hypot(matrix.a, matrix.b);
      const columnY = Math.hypot(matrix.c, matrix.d);
      if (
        Math.abs(columnX - columnY) > 1e-6 ||
        Math.abs(matrix.a * matrix.c + matrix.b * matrix.d) > 1e-6
      )
        diagnostics.push({
          severity: "warning",
          code: "NON_UNIFORM_STROKE_APPROXIMATED",
          layerId: layer.id,
          message: `PDF approximates stroke scaling on "${layer.name}" under a non-uniform transform.`,
        });
    }
    // PDF paint operators consume the current path. A separate f then S would
    // leave S with no geometry and silently lose every fill-and-stroke outline.
    const evenOdd = layer.fillType === "evenOdd";
    emit(
      fill && stroke ? (evenOdd ? "B*" : "B") : fill ? (evenOdd ? "f*" : "f") : stroke ? "S" : "n",
    );
    emit("Q");
  };

  // Depth-first traversal composing each node's Android-style transform
  // (scale/rotate/translate around its pivot) onto its ancestors' matrix, so
  // grouped artwork lands where the canvas draws it instead of at raw coords.
  // The canonical resolver handles both embedded group children and the flat
  // parentId links that imports produce, so both representations traverse
  // identically (group transforms/hiding apply either way).
  const tree = createLayerTreeModel(layers);
  if (
    clampAlpha(options.rootAlpha) !== 1 &&
    tree.allLayers.filter(
      (layer) =>
        layer.type === "path" &&
        layer.visible !== false &&
        tree.ancestorsOf(layer.id).every((ancestor) => ancestor.visible !== false),
    ).length > 1
  )
    diagnostics.push({
      severity: "warning",
      code: "ROOT_ALPHA_APPROXIMATED",
      message:
        "PDF applies drawable alpha to each path; overlapping translucent paths may differ from Android's whole-drawable compositing.",
    });
  const walk = (
    layer: Layer,
    matrix: AffineMatrix = IDENTITY_AFFINE,
    inheritedAlpha = clampAlpha(options.rootAlpha),
  ) => {
    if (layer.visible === false) return;
    const composed = multiplyAffine(matrix, layerTransformToMatrix(layer));
    if (layer.type === "clipPath") {
      emitGeometry(layer.pathData ?? layer.from, composed);
      emit(layer.fillType === "evenOdd" ? "W* n" : "W n");
      return;
    }
    const children = tree.childrenOf(layer);
    if (children.length > 0) {
      emit("q");
      children.forEach((child) => walk(child, composed, inheritedAlpha * clampAlpha(layer.alpha)));
      emit("Q");
    } else addPath(layer, composed, inheritedAlpha);
  };
  tree.roots.forEach((layer) => walk(layer));

  const content = contentOps.join("\n  ");
  const stream = `q\n  ${content}\nQ`;
  const states = [...alphaStates.values()];
  const alphaResources = states.length
    ? `/ExtGState<<${states.map((state, index) => `/${state.name} ${index + 5} 0 R`).join(" ")}>>`
    : "";

  // Hand-rolled minimal PDF (valid, viewable in any reader; no xobject bloat).
  // Objects are serialized sequentially while accumulating their real byte
  // offsets so the xref table and startxref are spec-accurate (strict parsers
  // reject fabricated offsets). Output is ASCII, so string length == bytes.
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${pdfW} ${pdfH}]/Contents 4 0 R/Resources<</ProcSet[/PDF]${alphaResources}>>>>`,
    `<</Length ${stream.length}>>stream\n${stream}\nendstream`,
    ...states.map(
      (state) => `<</Type/ExtGState/ca ${state.fill.toFixed(6)}/CA ${state.stroke.toFixed(6)}>>`,
    ),
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const startxref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${startxref}\n%%EOF\n`;
  return { pdf, diagnostics };
}
