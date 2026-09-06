import {
  compileAndroidArtboard,
  type AndroidDiagnostic,
  type AndroidExportBundle,
} from "../shapeshifter/androidCompiler";
import { compileAndroidArtboardAsync } from "../shapeshifter/offthread";
import {
  exportAnimatedSVG,
  exportCSSKeyframes,
  exportLottieDocument,
  exportPDF,
  exportStaticSVGWithDiagnostics,
  exportSvgSpritesheet,
} from "../shapeshifter/exporter";
import { exportProjectJSON } from "../shapeshifter/export/projectJson";
import type { ExportOptions, StaticSvgDiagnostic } from "../shapeshifter/export/types";
import { createZip } from "../shapeshifter/zip";
import type { DocumentV2 } from "../shapeshifter/types";
import { vectorFromPageMetadata } from "../shapeshifter/vectorSpace";
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

export interface LiveExportResult {
  live: LiveExportDocument;
  kind: LiveExportKind;
  scope: LiveExportScope;
  filename: string;
  mimeType: string;
  content: string | Uint8Array;
  androidDiagnostics: AndroidDiagnostic[];
  staticDiagnostics: StaticSvgDiagnostic[];
}

/** Flush the live artboard projection, then return the document used by every export path. */
export function flushLiveExportDocument() {
  useEditorStore.getState().syncActiveOwner({ includeAnimation: true });
  const state = useEditorStore.getState();
  const selectedFrame = state.frames.find((frame) => frame.id === state.selectedFrameId);
  return {
    state,
    selectedFrame,
    layers: state.layers,
    vector: state.vector,
    animation: state.animation,
    hiddenLayerIds: state.hiddenLayerIds,
    frames: state.frames,
    pageRoot: {
      layers: state.selectedFrameId === PAGE_ROOT_ID ? state.layers : state.rootLayers,
      vector: vectorFromPageMetadata(state.documentV2.page, PAGE_ROOT_ID),
      animation: state.selectedFrameId === PAGE_ROOT_ID ? state.animation : state.rootAnimation,
      hiddenLayerIds:
        state.selectedFrameId === PAGE_ROOT_ID ? state.hiddenLayerIds : state.rootHiddenLayerIds,
    },
  };
}

export function serializeLiveProject() {
  return serializeFlushedLiveProject(flushLiveExportDocument());
}

/** Serialize an already-flushed document without choosing a second export scope. */
export function serializeFlushedLiveProject(live: ReturnType<typeof flushLiveExportDocument>) {
  const project = exportProjectJSON(
    live.layers,
    live.vector,
    live.animation,
    live.hiddenLayerIds,
    live.frames,
    live.pageRoot,
  );
  // The recovery envelope is legacy-shaped, but the V2 payload must stay the
  // exact flushed graph. Rebuilding it with the active artboard vector corrupts
  // page metadata whenever page and artboard dimensions differ.
  return { ...project, documentV2: structuredClone(live.state.documentV2) };
}

/** Canonical v2 snapshot of the flushed live document. */
export function getLiveDocumentV2(): DocumentV2 {
  const live = flushLiveExportDocument();
  const documentV2 = live.state.documentV2;
  useEditorStore.setState({ documentV2 });
  return documentV2;
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

/**
 * One export service for the dialog, command hook, autosave callers, and tests.
 * Every format reads the same flushed live snapshot.
 */
export async function exportLiveDocument(
  kind: LiveExportKind,
  options: ExportOptions = {},
): Promise<LiveExportResult> {
  const live = flushLiveExportDocument();
  const scope = LIVE_EXPORT_SCOPE[kind];
  const layer = liveSelectedLayer(live);
  const baseName = liveFileBase(live);
  const empty = {
    live,
    kind,
    scope,
    androidDiagnostics: [] as AndroidDiagnostic[],
    staticDiagnostics: [] as StaticSvgDiagnostic[],
  };

  if (kind === "json") {
    return {
      ...empty,
      filename: `${live.vector.name || "shapeshifter"}.shapeshifter`,
      mimeType: "application/json",
      content: JSON.stringify(serializeFlushedLiveProject(live), null, 2),
    };
  }

  if (kind === "lottie") {
    return {
      ...empty,
      filename: `${baseName}.json`,
      mimeType: "application/json",
      content: JSON.stringify(exportLiveLottieDocument(live), null, 2),
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
    return {
      ...empty,
      filename: `${baseName}.pdf`,
      mimeType: "application/pdf",
      content: exportPDF(live.layers, {
        ...options,
        viewBoxWidth:
          options.viewBoxWidth ?? live.vector.viewportWidth ?? live.vector.width,
        viewBoxHeight:
          options.viewBoxHeight ?? live.vector.viewportHeight ?? live.vector.height,
      }),
    };
  }

  const bundle = await compileLiveAndroidArtboardAsync();
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
      path: "SHAPESHIFTER_EXPORT.txt",
      content: report || "Android export completed without diagnostics.",
    },
  ]);
}
