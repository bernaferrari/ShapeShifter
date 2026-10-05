import { workspaceFromDocument } from "../shapeshifter/documentModel";
import { exportStaticSVGWithDiagnostics } from "../shapeshifter/exporter";
import { exportPDFWithDiagnostics } from "../shapeshifter/export/pdf";
import { exportLottieDocumentWithDiagnostics } from "../shapeshifter/export/lottie";
import { compileAndroidArtboard } from "../shapeshifter/androidCompiler";
import { createAndroidExportZip } from "../store/exportDocument";
import { PAGE_ROOT_ID } from "../shapeshifter/scene/owners";
import type { EditorDocument } from "../shapeshifter/types";
import { AgentCommandError } from "./commands";

export const AGENT_EXPORT_FORMATS = ["json", "static", "vector", "avd", "lottie", "pdf"] as const;
export type AgentExportFormat = (typeof AGENT_EXPORT_FORMATS)[number];
export interface AgentExportRequest {
  ownerId: string;
  format: AgentExportFormat;
}
type ExportDiagnostic = {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  layerId?: string | number;
  propertyName?: string;
};

function base64(bytes: Uint8Array) {
  const chunks: string[] = [];
  for (let index = 0; index < bytes.length; index += 32768)
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + 32768)));
  return btoa(chunks.join(""));
}

/** Export one immutable capture. Reading a different owner never changes editor focus or history. */
export function exportAgentSnapshot(
  document: EditorDocument,
  revision: number,
  request: AgentExportRequest,
) {
  if (
    !request ||
    typeof request.ownerId !== "string" ||
    !AGENT_EXPORT_FORMATS.includes(request.format)
  )
    throw new AgentCommandError("INVALID_EXPORT", "Provide ownerId and a supported export format.");
  const snapshot = workspaceFromDocument(document);
  const owner =
    request.ownerId === PAGE_ROOT_ID
      ? {
          name: snapshot.rootVector.name,
          layers: snapshot.rootLayers,
          vector: snapshot.rootVector,
          animation: snapshot.rootAnimation,
          hiddenLayerIds: snapshot.rootHiddenLayerIds,
        }
      : snapshot.frames.find((frame) => frame.id === request.ownerId);
  if (!owner)
    throw new AgentCommandError("OWNER_NOT_FOUND", `Owner ${request.ownerId} does not exist.`);
  const filename = (owner.name || owner.vector.name || "export")
    .replace(/[^\w.-]+/g, "-")
    .toLowerCase();
  const viewport = {
    viewBoxWidth: owner.vector.viewportWidth ?? owner.vector.width,
    viewBoxHeight: owner.vector.viewportHeight ?? owner.vector.height,
  };
  let content: string | Uint8Array;
  let mimeType: string;
  let extension: string;
  let diagnostics: ExportDiagnostic[] = [];
  switch (request.format) {
    case "json":
      content = JSON.stringify(
        {
          format: "shapeshifter",
          activeOwnerId: request.ownerId,
          document: structuredClone(document),
        },
        null,
        2,
      );
      mimeType = "application/json";
      extension = ".shapeshifter";
      break;
    case "static": {
      const result = exportStaticSVGWithDiagnostics(owner.layers, {
        ...viewport,
        rootVector: owner.vector,
      });
      content = result.svg;
      diagnostics = result.diagnostics;
      mimeType = "image/svg+xml";
      extension = ".svg";
      break;
    }
    case "pdf": {
      const result = exportPDFWithDiagnostics(owner.layers, {
        ...viewport,
        rootAlpha: owner.vector.alpha,
      });
      content = result.pdf;
      diagnostics = result.diagnostics;
      if (owner.vector.tint)
        diagnostics.push({
          severity: "warning",
          code: "ROOT_TINT_UNSUPPORTED",
          message: "PDF omits the Android drawable tint.",
        });
      mimeType = "application/pdf";
      extension = ".pdf";
      break;
    }
    case "lottie": {
      const result = exportLottieDocumentWithDiagnostics(owner.layers, owner.name, {
        animation: owner.animation,
        vector: owner.vector,
      });
      content = JSON.stringify(result.lottie, null, 2);
      diagnostics = result.diagnostics;
      mimeType = "application/json";
      extension = ".json";
      break;
    }
    case "vector":
    case "avd": {
      const bundle = compileAndroidArtboard(owner);
      diagnostics = bundle.diagnostics;
      content =
        request.format === "vector"
          ? (bundle.files.find((file) => file.path.endsWith("_vector.xml"))?.content ?? "")
          : createAndroidExportZip(bundle);
      mimeType = request.format === "vector" ? "application/xml" : "application/zip";
      extension = request.format === "vector" ? ".xml" : ".zip";
      break;
    }
  }
  const ready = !diagnostics.some((diagnostic) => diagnostic.severity === "error");
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  return {
    documentId: document.id,
    revision,
    ownerId: request.ownerId,
    format: request.format,
    scope: request.format === "json" ? "document" : "owner",
    artwork:
      request.format === "json"
        ? "authored-document"
        : ["avd", "lottie"].includes(request.format)
          ? "timeline"
          : "base",
    ready,
    filename: `${filename}${extension}`,
    mimeType,
    encoding: typeof content === "string" ? "utf-8" : "base64",
    byteLength: ready ? bytes.byteLength : 0,
    content: ready ? (typeof content === "string" ? content : base64(content)) : null,
    diagnostics,
  };
}
