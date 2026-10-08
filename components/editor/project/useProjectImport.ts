"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { documentEditingIssues, validateEditorDocument } from "@/lib/pathshift/documentModel";
import { importLayersFromSvg } from "@/lib/pathshift/importers";
import {
  importAnimatedVectorBundle,
  isAnimatedVectorMarkup,
} from "@/lib/pathshift/import/androidAnimatedVector";
import { importVectorDrawable } from "@/lib/pathshift/import/androidVectorDrawable";
import { parseZip } from "@/lib/pathshift/zip";
import type { EditorDocument } from "@/lib/pathshift/types";
import { useEditorStore } from "@/lib/store/editorStore";
import { isEditableTarget } from "../hooks/useEditorKeyboardShortcuts";

const SUPPORTED_FILE = /\.(svg|xml|json|pathshift|zip)$/i;

interface ImportSummary {
  title: string;
  description?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function importEditorZip(fileName: string, bytes: Uint8Array): ImportSummary {
  const entries = parseZip(bytes).map((entry) => ({
    path: entry.path,
    content:
      typeof entry.content === "string" ? entry.content : new TextDecoder().decode(entry.content),
  }));
  return applyAndroidImport(
    useEditorStore.getState(),
    fileName,
    importAnimatedVectorBundle(entries),
  );
}

export function importEditorText(fileName: string, text: string): ImportSummary {
  const lowerName = fileName.toLocaleLowerCase();
  const store = useEditorStore.getState();

  if (lowerName.endsWith(".json") || lowerName.endsWith(".pathshift")) {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed) || parsed.format !== "pathshift")
      throw new Error("Open a native Pathshift project, SVG, or Android vector file.");
    const issues = validateEditorDocument(parsed.document);
    if (issues.length) throw new Error(`Invalid project: ${issues[0]}`);
    const document = parsed.document as EditorDocument;
    const editingIssues = documentEditingIssues(document);
    if (editingIssues.length) throw new Error(`Unsupported project content: ${editingIssues[0]}`);
    const ownerId = parsed.activeOwnerId;
    if (
      ownerId !== undefined &&
      (typeof ownerId !== "string" ||
        (ownerId !== "__page_root__" && !document.frameIds.includes(ownerId)))
    )
      throw new Error("Invalid project: the active artboard no longer exists.");
    store.loadDocument(document);
    if (typeof ownerId === "string") useEditorStore.getState().selectFrame(ownerId);
    return {
      title: `Opened ${document.name}`,
      description: `${document.frameIds.length} artboard(s) · ${document.rootNodeIds.length} page vector(s)`,
    };
  }

  if (isAnimatedVectorMarkup(text)) {
    const imported = importAnimatedVectorBundle([{ path: fileName, content: text }]);
    return applyAndroidImport(store, fileName, imported);
  }
  const isVectorDrawable = lowerName.endsWith(".xml") || text.includes("<vector");
  const vectorDrawable = isVectorDrawable ? importVectorDrawable(text) : null;
  const layers =
    vectorDrawable?.layers ?? importLayersFromSvg(text, fileName.replace(/\.[^.]+$/, ""));
  if (!layers.length) throw new Error("No path data found in file");
  // Geometry and Android root metadata belong to one user action. Undoing only
  // the dimensions first would leave imported paths in the previous viewport.
  store.beginHistoryGesture();
  try {
    store.importLayers(layers);
    if (vectorDrawable) {
      store.updateVector({
        name: fileName.replace(/\.[^.]+$/, "") || store.vector.name,
        width: vectorDrawable.width,
        height: vectorDrawable.height,
        viewportWidth: vectorDrawable.viewportWidth,
        viewportHeight: vectorDrawable.viewportHeight,
        widthUnit: vectorDrawable.widthUnit,
        heightUnit: vectorDrawable.heightUnit,
        alpha: vectorDrawable.alpha,
        tint: vectorDrawable.tint,
        tintMode: vectorDrawable.tintMode,
        autoMirrored: vectorDrawable.autoMirrored,
        minSdk: vectorDrawable.minSdk,
      });
    }
  } finally {
    store.endHistoryGesture();
  }
  return {
    title: `Imported ${layers.length} layer(s)`,
    description: isVectorDrawable ? "Vector Drawable" : "SVG",
  };
}

function applyAndroidImport(
  store: ReturnType<typeof useEditorStore.getState>,
  fileName: string,
  imported: ReturnType<typeof importAnimatedVectorBundle>,
): ImportSummary {
  store.loadProject({
    layers: imported.layers,
    vector: {
      id: store.vector.id,
      name: fileName.replace(/\.[^.]+$/, "") || store.vector.name,
      width: imported.width,
      height: imported.height,
      viewportWidth: imported.viewportWidth,
      viewportHeight: imported.viewportHeight,
      widthUnit: imported.widthUnit,
      heightUnit: imported.heightUnit,
      alpha: imported.alpha,
      tint: imported.tint,
      tintMode: imported.tintMode,
      autoMirrored: imported.autoMirrored,
      minSdk: imported.minSdk,
    },
    animation: imported.animation,
    hiddenLayerIds: [],
  });
  const warnings = imported.diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
  const warningDescription = warnings.length
    ? ` · ${warnings.length} timing warning${warnings.length === 1 ? "" : "s"}: ${warnings[0]!.message}`
    : "";
  return {
    title: `Imported ${imported.layers.length} layer(s)`,
    description: `${imported.animation.blocks.length} Android track(s)${warningDescription}`,
  };
}

export function useProjectImport() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const openFilePicker = useCallback(() => inputRef.current?.click(), []);

  const importFiles = useCallback(async (files: File[]) => {
    const supported = files.filter((file) => SUPPORTED_FILE.test(file.name));
    if (!supported.length) {
      toast.error("Choose an SVG, Vector Drawable, AVD ZIP, or Pathshift project");
      return;
    }
    const xmlFiles = supported.filter((file) => /\.xml$/i.test(file.name));
    const xmlTexts = await Promise.all(
      xmlFiles.map(async (file) => ({ path: file.name, content: await file.text() })),
    );
    if (xmlTexts.some((file) => isAnimatedVectorMarkup(file.content)) && xmlTexts.length > 1) {
      try {
        const summary = applyAndroidImport(
          useEditorStore.getState(),
          xmlFiles[0]!.name,
          importAnimatedVectorBundle(xmlTexts),
        );
        toast.success(summary.title, { description: summary.description });
      } catch (error) {
        toast.error("Couldn’t import Android bundle", { description: String(error) });
      }
      return;
    }
    if (supported.length > 1) toast.info(`Importing ${supported.length} files…`);
    for (const file of supported) {
      try {
        const summary = file.name.toLowerCase().endsWith(".zip")
          ? importEditorZip(file.name, new Uint8Array(await file.arrayBuffer()))
          : importEditorText(file.name, await file.text());
        toast.success(summary.title, { description: summary.description });
      } catch (error) {
        toast.error(`Couldn’t import ${file.name}`, { description: String(error) });
      }
    }
  }, []);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const text = event.clipboardData?.getData("text/plain")?.trim();
      if (!text) return;
      const isSvg = text.includes("<svg") || text.includes("<path ");
      const isVectorDrawable = text.includes("<vector");
      if (!isSvg && !isVectorDrawable) return;
      event.preventDefault();
      try {
        const summary = importEditorText(isVectorDrawable ? "pasted.xml" : "pasted.svg", text);
        toast.success(summary.title, { description: summary.description });
      } catch (error) {
        toast.error("Couldn’t import pasted content", { description: String(error) });
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  const dragHandlers = {
    onDragEnter: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      if (event.dataTransfer.types.includes("Files")) setIsDraggingFile(true);
    },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      if (event.dataTransfer.types.includes("Files")) setIsDraggingFile(true);
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      const bounds = event.currentTarget.getBoundingClientRect();
      if (
        event.clientX < bounds.left ||
        event.clientX >= bounds.right ||
        event.clientY < bounds.top ||
        event.clientY >= bounds.bottom
      ) {
        setIsDraggingFile(false);
      }
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      setIsDraggingFile(false);
      void importFiles(Array.from(event.dataTransfer.files));
    },
  };

  return { inputRef, isDraggingFile, openFilePicker, importFiles, dragHandlers };
}
