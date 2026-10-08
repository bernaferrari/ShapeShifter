import {
  compileAndroidArtboard,
  type AndroidDiagnostic,
  type AndroidExportBundle,
} from "../pathshift/androidCompiler";
import { compileAndroidArtboardAsync } from "../pathshift/offthread";
import {
  exportAnimatedSVG,
  exportCSSKeyframes,
  exportLottieDocument,
  exportStaticSVGWithDiagnostics,
  exportSvgSpritesheet,
} from "../pathshift/exporter";
import { exportPDFWithDiagnostics, type PdfExportDiagnostic } from "../pathshift/export/pdf";
import {
  exportLottieDocumentWithDiagnostics,
  type LottieExportDiagnostic,
} from "../pathshift/export/lottie";
import { saveActiveFrame, saveActiveRoot } from "./workspaceState";
import type { ExportOptions, StaticSvgDiagnostic } from "../pathshift/export/types";
import { createZip } from "../pathshift/zip";
import type { EditorDocument, Layer } from "../pathshift/types";
import { vectorFromPageMetadata } from "../pathshift/vectorSpace";
import { PAGE_ROOT_ID, useEditorStore } from "./editorStore";

export type LiveExportKind =
  | "json"
  | "lottie"
  | "avd"
  | "vector"
  | "svg"
  | "animated"
  | "css"
  | "static"
  | "pdf"
  | "spritesheet";

export type LiveExportScope = "document" | "artboard" | "selected-layer";

/** Claimed scope for each format. Morph SVG/CSS are selected-layer, never artboard. */
export const LIVE_EXPORT_SCOPE: Record<LiveExportKind, LiveExportScope> = {
  json: "document",
  lottie: "artboard",
  avd: "artboard",
  vector: "artboard",
  static: "artboard",
  pdf: "artboard",
  svg: "selected-layer",
  animated: "selected-layer",
  css: "selected-layer",
  spritesheet: "selected-layer",
};

export type LiveExportDocument = ReturnType<typeof flushLiveExportDocument>;

/** Morph-only exporters need an actual drawable path, never a group's placeholder. */
export function selectedLayerExportIssue(layer: Layer | undefined): string | null {
  if (!layer || layer.type !== "path")
    return "Select a path layer for this morph format. Use a document format to export groups.";
  const hasGeometry = (path: Layer["from"]) =>
    path.subPaths.some((contour) =>
      contour.commands.some((command) => command.type !== "M" && command.type !== "Z"),
    );
  if (!hasGeometry(layer.pathData ?? layer.from) || !hasGeometry(layer.to ?? layer.from))
    return "The selected path needs drawable geometry in both morph endpoints.";
  return null;
}

export interface LiveExportResult {
  live: LiveExportDocument;
  kind: LiveExportKind;
  scope: LiveExportScope;
  filename: string;
  mimeType: string;
  content: string | Uint8Array;
  androidDiagnostics: AndroidDiagnostic[];
  staticDiagnostics: StaticSvgDiagnostic[];
  formatDiagnostics: Array<PdfExportDiagnostic | LottieExportDiagnostic>;
}

/** Flush the live artboard projection, then return the document used by every export path. */
export function flushLiveExportDocument() {
  const state = useEditorStore.getState();
  const frames = saveActiveFrame(state);
  const root = saveActiveRoot(state);
  const selectedFrame = frames.find((frame) => frame.id === state.selectedFrameId);
  return {
    state,
    selectedFrame,
    layers: state.layers,
    vector: state.vector,
    animation: state.animation,
    hiddenLayerIds: state.hiddenLayerIds,
    frames,
    pageRoot: {
      layers: root.layers,
      vector: vectorFromPageMetadata(state.document.page, PAGE_ROOT_ID),
      animation: root.animation,
      hiddenLayerIds: root.hiddenLayerIds,
    },
  };
}

export function serializeLiveProject() {
  return serializeFlushedLiveProject(flushLiveExportDocument());
}

/** Serialize an already-flushed document without choosing a second export scope. */
export function serializeFlushedLiveProject(live: ReturnType<typeof flushLiveExportDocument>) {
  return {
    format: "pathshift" as const,
    document: structuredClone(live.state.document),
    activeOwnerId: live.state.selectedFrameId,
  };
}

/** Canonical snapshot of the authored document. */
export function getLiveDocument(): EditorDocument {
  const live = flushLiveExportDocument();
  const document = live.state.document;
  return document;
}

/** Single Android compiler entry used by the dialog, palette, and keyboard export. */
function liveAndroidInput() {
  const live = flushLiveExportDocument();
  return {
    name: live.selectedFrame?.name || live.vector.name,
    layers: live.layers,
    vector: live.vector,
    animation: live.animation,
    hiddenLayerIds: live.hiddenLayerIds,
  };
}

export function compileLiveAndroidArtboard(): AndroidExportBundle {
  return compileAndroidArtboard(liveAndroidInput());
}

export function compileLiveAndroidArtboardAsync() {
  return compileAndroidArtboardAsync(liveAndroidInput());
}

/** User-facing warning copy shared by all Android download entry points. */
export function summarizeAndroidWarnings(
  diagnostics: readonly AndroidDiagnostic[],
): { count: number; description: string } | null {
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
  if (warnings.length === 0) return null;

  return {
    count: warnings.length,
    // Keep every non-blocking fidelity warning visible instead of hiding the
    // remainder behind an archive manifest or a generic success toast.
    description: warnings.map((diagnostic) => diagnostic.message).join(" "),
  };
}

export function exportLiveLottieDocument(live = flushLiveExportDocument()) {
  return exportLottieDocument(live.layers, live.selectedFrame?.name || live.vector.name, {
    animation: live.animation,
    vector: live.vector,
    duration: live.animation.duration / 1000,
  });
}

function liveSelectedLayer(live: LiveExportDocument) {
  return (
    live.layers.find((layer) => String(layer.id) === String(live.state.selectedLayerId)) ??
    live.layers[0]
  );
}

function liveFileBase(live: LiveExportDocument) {
  const layer = liveSelectedLayer(live);
  return (live.selectedFrame?.name || layer?.name || live.vector.name || "export")
    .replace(/\s+/g, "-")
    .toLowerCase();
}

/** All entry points resolve the same document-derived defaults. Explicit overrides win. */
export function resolveExportOptions(
  live: Pick<LiveExportDocument, "layers" | "vector" | "animation" | "state">,
  options: ExportOptions = {},
): Required<
  Pick<
    ExportOptions,
    | "duration"
    | "fps"
    | "width"
    | "height"
    | "viewBoxWidth"
    | "viewBoxHeight"
    | "loop"
    | "strokeWidth"
  >
> &
  ExportOptions {
  const layer = live.layers.find(
    (layer) => String(layer.id) === String(live.state.selectedLayerId),
  );
  return {
    duration: Math.max(0.001, live.animation.duration / 1000),
    fps: 60,
    width: live.vector.width,
    height: live.vector.height,
    viewBoxWidth: live.vector.viewportWidth ?? live.vector.width,
    viewBoxHeight: live.vector.viewportHeight ?? live.vector.height,
    loop: live.state.isRepeating,
    strokeWidth: layer?.strokeWidth || 2.5,
    ...options,
  };
}

/**
 * One export service for the dialog, command hook, autosave callers, and tests.
 * Every format reads the same flushed live snapshot.
 */
export async function exportLiveDocument(
  kind: LiveExportKind,
  options: ExportOptions = {},
): Promise<LiveExportResult> {
  const live = flushLiveExportDocument();
  options = resolveExportOptions(live, options);
  const scope = LIVE_EXPORT_SCOPE[kind];
  const layer = liveSelectedLayer(live);
  if (scope === "selected-layer") {
    const issue = selectedLayerExportIssue(layer);
    if (issue) throw new Error(issue);
  }
  const baseName = liveFileBase(live);
  const empty = {
    live,
    kind,
    scope,
    androidDiagnostics: [] as AndroidDiagnostic[],
    staticDiagnostics: [] as StaticSvgDiagnostic[],
    formatDiagnostics: [] as Array<PdfExportDiagnostic | LottieExportDiagnostic>,
  };

  if (kind === "json") {
    return {
      ...empty,
      filename: `${live.vector.name || "pathshift"}.pathshift`,
      mimeType: "application/json",
      content: JSON.stringify(serializeFlushedLiveProject(live), null, 2),
    };
  }

  if (kind === "lottie") {
    const result = exportLottieDocumentWithDiagnostics(
      live.layers,
      live.selectedFrame?.name || live.vector.name,
      { animation: live.animation, vector: live.vector, duration: live.animation.duration / 1000 },
    );
    return {
      ...empty,
      filename: `${baseName}.json`,
      mimeType: "application/json",
      content: JSON.stringify(result.lottie, null, 2),
      formatDiagnostics: result.diagnostics,
    };
  }

  if (kind === "svg" || kind === "animated") {
    if (!layer) throw new Error("Select a layer to export");
    return {
      ...empty,
      filename: `${baseName}-morph.svg`,
      mimeType: "image/svg+xml",
      content: exportAnimatedSVG(
        layer.pathData ?? layer.from,
        layer.to ?? layer.from,
        layer.name,
        options,
      ),
    };
  }

  if (kind === "css") {
    if (!layer) throw new Error("Select a layer to export");
    return {
      ...empty,
      filename: `${baseName}-morph.css`,
      mimeType: "text/css",
      content: exportCSSKeyframes(
        layer.pathData ?? layer.from,
        layer.to ?? layer.from,
        layer.name,
        options.duration,
      ),
    };
  }

  if (kind === "spritesheet") {
    if (!layer) throw new Error("Select a layer to export");
    return {
      ...empty,
      filename: `${baseName}-spritesheet.svg`,
      mimeType: "image/svg+xml",
      content: exportSvgSpritesheet(layer, options),
    };
  }

  if (kind === "static") {
    const staticResult = exportStaticSVGWithDiagnostics(live.layers, {
      ...options,
      viewBoxWidth: options.viewBoxWidth ?? live.vector.viewportWidth ?? live.vector.width,
      viewBoxHeight: options.viewBoxHeight ?? live.vector.viewportHeight ?? live.vector.height,
      rootVector: live.vector,
    });
    return {
      ...empty,
      filename: `${baseName}-static.svg`,
      mimeType: "image/svg+xml",
      content: staticResult.svg,
      staticDiagnostics: staticResult.diagnostics,
    };
  }

  if (kind === "pdf") {
    const result = exportPDFWithDiagnostics(live.layers, {
      ...options,
      rootAlpha: live.vector.alpha,
      viewBoxWidth: options.viewBoxWidth ?? live.vector.viewportWidth ?? live.vector.width,
      viewBoxHeight: options.viewBoxHeight ?? live.vector.viewportHeight ?? live.vector.height,
    });
    return {
      ...empty,
      filename: `${baseName}.pdf`,
      mimeType: "application/pdf",
      content: result.pdf,
      formatDiagnostics: result.diagnostics,
    };
  }

  const bundle = await compileAndroidArtboardAsync({
    name: live.selectedFrame?.name || live.vector.name,
    layers: live.layers,
    vector: live.vector,
    animation: live.animation,
    hiddenLayerIds: live.hiddenLayerIds,
  });
  if (kind === "vector") {
    return {
      ...empty,
      filename: `${bundle.resourceName}_vector.xml`,
      mimeType: "application/xml",
      content: bundle.files.find((file) => file.path.endsWith("_vector.xml"))?.content ?? "",
      androidDiagnostics: bundle.diagnostics,
    };
  }

  return {
    ...empty,
    filename: `${bundle.resourceName}-android.zip`,
    mimeType: "application/zip",
    content: createAndroidExportZip(bundle),
    androidDiagnostics: bundle.diagnostics,
  };
}

/** A single inspectable Android bundle shape for every UI export entry point. */
export function createAndroidExportZip(bundle: AndroidExportBundle): Uint8Array {
  const report = bundle.diagnostics
    .map(
      (diagnostic) =>
        `[${diagnostic.severity.toUpperCase()}] ${diagnostic.code}: ${diagnostic.message}`,
    )
    .join("\n");
  return createZip([
    ...bundle.files,
    {
      path: "PATHSHIFT_EXPORT.txt",
      content: report || "Android export completed without diagnostics.",
    },
  ]);
}
