"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import {
  exportLiveDocument,
  LIVE_EXPORT_SCOPE,
  summarizeAndroidWarnings,
  type LiveExportKind,
} from "@/lib/store/exportDocument";

export type EditorExportType =
  | "svg"
  | "animated"
  | "static"
  | "css"
  | "lottie"
  | "vector"
  | "avd"
  | "spritesheet"
  | "json"
  | "pdf";

const EXPORT_TYPES = new Set<string>([
  "svg",
  "animated",
  "static",
  "css",
  "lottie",
  "vector",
  "avd",
  "spritesheet",
  "json",
  "pdf",
]);

function isEditorExportType(value: string): value is EditorExportType {
  return EXPORT_TYPES.has(value);
}

function downloadContent(content: BlobPart, type: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function useProjectExport() {
  return useCallback(async (type: string) => {
    if (!isEditorExportType(type)) {
      toast.error(`Unsupported export format: ${type}`);
      return;
    }
    const exportType = type as LiveExportKind;

    try {
      const exported = await exportLiveDocument(exportType);
      if (
        exported.scope === "selected-layer" &&
        LIVE_EXPORT_SCOPE[exportType] === "selected-layer" &&
        exported.live.layers.length === 0
      ) {
        toast.error("Select a layer to export");
        return;
      }
      const blocking = exported.androidDiagnostics.filter(
        (diagnostic) => diagnostic.severity === "error",
      );
      if (exportType === "avd" && blocking.length > 0) {
        toast.error("Android export needs attention", { description: blocking[0]!.message });
        return;
      }
      const payload =
        exported.content instanceof Uint8Array
          ? (exported.content.buffer.slice(
              exported.content.byteOffset,
              exported.content.byteOffset + exported.content.byteLength,
            ) as ArrayBuffer)
          : exported.content;
      downloadContent(payload, exported.mimeType, exported.filename);
      const warnings = summarizeAndroidWarnings(exported.androidDiagnostics);
      if (warnings) {
        const warningLabel = warnings.count === 1 ? "warning" : "warnings";
        toast.warning(`Exported ${exportType.toUpperCase()} with ${warnings.count} ${warningLabel}`, {
          description:
            exportType === "avd"
              ? `${warnings.description} Full details are in SHAPESHIFTER_EXPORT.txt.`
              : warnings.description,
        });
        return;
      }
      if (exported.staticDiagnostics.length) {
        toast.warning("Static SVG exported with warning", {
          description: exported.staticDiagnostics.map((diagnostic) => diagnostic.message).join(" "),
        });
        return;
      }
      toast.success(`Exported ${exportType.toUpperCase()}`, { description: exported.filename });
    } catch (error) {
      toast.error("Export failed", { description: String(error) });
    }
  }, []);
}
