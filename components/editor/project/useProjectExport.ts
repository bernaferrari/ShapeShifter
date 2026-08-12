"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import {
  downloadAnimatedSVG,
  downloadCSSKeyframes,
  exportLottieDocument,
  exportAnimatedVectorDrawable,
  exportPDF,
  exportProjectJSON,
  exportStaticSVG,
  exportSvgSpritesheet,
  exportVectorDrawable,
} from "@/lib/shapeshifter/exporter";
import { PAGE_ROOT_ID, useEditorStore } from "@/lib/store/editorStore";

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
  return useCallback((type: string) => {
    useEditorStore.getState().syncActiveOwner({ includeAnimation: true });
    const state = useEditorStore.getState();
    const layer =
      state.layers.find((candidate) => candidate.id === state.selectedLayerId) ?? state.layers[0];
    if (!layer) {
      toast.error("Select a layer to export");
      return;
    }

    if (!isEditorExportType(type)) {
      toast.error(`Unsupported export format: ${type}`);
      return;
    }
    const exportType = type;
    const from = layer.from;
    const to = layer.to ?? from;
    const name = (layer.name || "vector").trim().replace(/\s+/g, "-").toLocaleLowerCase();
    const visibleLayers = state.layers.filter((candidate) => candidate.visible !== false);
    const documentLayers = visibleLayers.length ? visibleLayers : state.layers;

    try {
      if (exportType === "svg" || exportType === "animated") {
        downloadAnimatedSVG(from, to, name);
        toast.success("Animated SVG exported");
        return;
      }
      if (exportType === "css") {
        downloadCSSKeyframes(from, to, name);
        toast.success("CSS keyframes exported");
        return;
      }
      if (exportType === "lottie") {
        const sourceAnimation =
          state.selectedFrameId === PAGE_ROOT_ID ? state.animation : state.frames.find((frame) => frame.id === state.selectedFrameId)?.animation ?? state.animation;
        const sourceVector =
          state.selectedFrameId === PAGE_ROOT_ID ? state.vector : state.frames.find((frame) => frame.id === state.selectedFrameId)?.vector ?? state.vector;
        downloadContent(
          JSON.stringify(
            exportLottieDocument(documentLayers, sourceVector.name || name, {
              animation: sourceAnimation,
              vector: sourceVector,
              duration: sourceAnimation.duration / 1000,
            }),
            null,
            2,
          ),
          "application/json",
          `${name}.json`,
        );
        toast.success("Lottie exported");
        return;
      }
      if (exportType === "vector" || exportType === "avd" || exportType === "spritesheet") {
        const content =
          exportType === "vector"
            ? exportVectorDrawable(layer)
            : exportType === "avd"
              ? exportAnimatedVectorDrawable(layer)
              : exportSvgSpritesheet(layer);
        downloadContent(
          content,
          exportType === "spritesheet" ? "image/svg+xml" : "application/xml",
          `${name}-${exportType}.${exportType === "spritesheet" ? "svg" : "xml"}`,
        );
        toast.success(
          exportType === "vector"
            ? "Vector Drawable exported"
            : exportType === "avd"
              ? "Animated Vector Drawable exported"
              : "SVG spritesheet exported",
        );
        return;
      }
      if (exportType === "json") {
        const pageRoot = {
          layers: state.selectedFrameId === PAGE_ROOT_ID ? state.layers : state.rootLayers,
          animation: state.selectedFrameId === PAGE_ROOT_ID ? state.animation : state.rootAnimation,
          hiddenLayerIds:
            state.selectedFrameId === PAGE_ROOT_ID
              ? state.hiddenLayerIds
              : state.rootHiddenLayerIds,
        };
        downloadContent(
          JSON.stringify(
            exportProjectJSON(
              state.layers,
              state.vector,
              state.animation,
              state.hiddenLayerIds,
              state.frames,
              pageRoot,
            ),
            null,
            2,
          ),
          "application/json",
          `${state.vector.name || "shapeshifter"}.shapeshifter`,
        );
        toast.success("ShapeShifter project exported");
        return;
      }
      if (exportType === "pdf") {
        downloadContent(exportPDF(documentLayers), "application/pdf", `${name}.pdf`);
        toast.success("Vector PDF exported");
        return;
      }
      if (exportType === "static") {
        downloadContent(exportStaticSVG(documentLayers), "image/svg+xml", `${name}-static.svg`);
        toast.success("Static SVG exported");
        return;
      }
      toast.error(`Unknown export format: ${type}`);
    } catch (error) {
      toast.error("Export failed", { description: String(error) });
    }
  }, []);
}
