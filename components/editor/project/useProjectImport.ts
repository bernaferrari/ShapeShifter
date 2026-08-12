"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { legacySnapshotFromDocumentV2, validateDocumentV2 } from "@/lib/shapeshifter/documentModel";
import { importLayersFromSvg } from "@/lib/shapeshifter/importers";
import { importVectorDrawable } from "@/lib/shapeshifter/import/androidVectorDrawable";
import { parsePath } from "@/lib/shapeshifter/pathUtils";
import { flattenOriginalProject, isOriginalShapeShifterProject } from "@/lib/shapeshifter/project";
import type {
  Command,
  DocumentV2,
  Layer,
  LayerType,
  PathData,
  Point,
} from "@/lib/shapeshifter/types";
import { useEditorStore } from "@/lib/store/editorStore";
import { isEditableTarget } from "../hooks/useEditorKeyboardShortcuts";

const SUPPORTED_FILE = /\.(svg|xml|json|shapeshifter)$/i;

interface ImportSummary {
  title: string;
  description?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDocumentV2(value: unknown): value is DocumentV2 {
  return (
    isRecord(value) &&
    value.version === 2 &&
    Array.isArray(value.frameIds) &&
    isRecord(value.frames) &&
    isRecord(value.nodes) &&
    isRecord(value.geometryVersions) &&
    isRecord(value.clips) &&
    isRecord(value.tracks) &&
    isRecord(value.keyframes)
  );
}

const PATH_COMMAND_TYPES = new Set(["M", "L", "C", "Q", "A", "Z", "H", "V", "S", "T"]);

function isPoint(value: unknown): value is Point {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y)
  );
}

function isCommand(value: unknown): value is Command {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.type === "string" &&
    PATH_COMMAND_TYPES.has(value.type) &&
    Array.isArray(value.points) &&
    value.points.every(isPoint)
  );
}

function isPathData(value: unknown): value is PathData {
  return (
    isRecord(value) &&
    Array.isArray(value.subPaths) &&
    value.subPaths.every(
      (subPath) =>
        isRecord(subPath) && Array.isArray(subPath.commands) && subPath.commands.every(isCommand),
    )
  );
}

function parsePathValue(value: unknown, fallback?: PathData): PathData {
  if (typeof value === "string") return parsePath(value);
  if (isPathData(value)) return value;
  return fallback ?? parsePath("");
}

function parseLayerType(value: unknown): LayerType {
  return value === "group" || value === "clipPath" || value === "vector" ? value : "path";
}

function parseLooseLayer(value: unknown, index: number): Layer | null {
  if (!isRecord(value)) return null;
  const candidate = value as Partial<Layer> & {
    from?: Layer["from"] | string;
    to?: Layer["to"] | string;
    pathData?: Layer["pathData"] | string;
  };
  const from = parsePathValue(candidate.from ?? candidate.pathData);
  const to = candidate.to == null ? undefined : parsePathValue(candidate.to, from);
  const children = Array.isArray(candidate.children)
    ? candidate.children.flatMap((child, childIndex) => {
        const parsed = parseLooseLayer(child, childIndex);
        return parsed ? [parsed] : [];
      })
    : undefined;
  return {
    ...candidate,
    id: candidate.id ?? `imported-layer-${Date.now()}-${index}`,
    name: candidate.name ?? `Imported layer ${index + 1}`,
    type: parseLayerType(candidate.type),
    from,
    to,
    pathData: parsePathValue(candidate.pathData, from),
    visible: candidate.visible ?? true,
    locked: candidate.locked ?? false,
    children,
  };
}

function fileNameFromUrl(value: string): string {
  try {
    return new URL(value, window.location.href).pathname.split("/").at(-1) || "imported.svg";
  } catch {
    return value.split("/").at(-1) || "imported.svg";
  }
}

export function importEditorText(fileName: string, text: string): ImportSummary {
  const lowerName = fileName.toLocaleLowerCase();
  const store = useEditorStore.getState();

  if (lowerName.endsWith(".json") || lowerName.endsWith(".shapeshifter")) {
    const parsed: unknown = JSON.parse(text);
    const documentCandidate = isRecord(parsed) ? parsed.documentV2 : undefined;
    if (isDocumentV2(documentCandidate)) {
      const issues = validateDocumentV2(documentCandidate);
      if (issues.length > 0) throw new Error(`Invalid document: ${issues[0]}`);
      const snapshot = legacySnapshotFromDocumentV2(documentCandidate);
      store.loadDocument(snapshot);
      return {
        title: `Opened ${snapshot.name}`,
        description: `${snapshot.frames.length} frame(s) · ${snapshot.rootLayers.length} page vector(s)`,
      };
    }

    if (isOriginalShapeShifterProject(parsed)) {
      const project = flattenOriginalProject(parsed);
      if (!project.layers.length) throw new Error("No path layers found in project");
      store.loadProject(project);
      return {
        title: `Opened ${project.vector.name}`,
        description: `${project.layers.length} layer(s) · ${project.animation.blocks.length} animated track(s)`,
      };
    }

    const rawLayers = isRecord(parsed) && Array.isArray(parsed.layers) ? parsed.layers : [];
    const layers = rawLayers.flatMap((layer, index) => {
      const parsedLayer = parseLooseLayer(layer, index);
      return parsedLayer ? [parsedLayer] : [];
    });
    if (!layers.length) throw new Error("No layers found in project file");
    store.setLayers(layers);
    return { title: `Opened project`, description: `${layers.length} layer(s)` };
  }

  const isVectorDrawable = lowerName.endsWith(".xml") || text.includes("<vector");
  const vectorDrawable = isVectorDrawable ? importVectorDrawable(text) : null;
  const layers = vectorDrawable?.layers ?? importLayersFromSvg(text, fileName.replace(/\.[^.]+$/, ""));
  if (!layers.length) throw new Error("No path data found in file");
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
  return {
    title: `Imported ${layers.length} layer(s)`,
    description: isVectorDrawable ? "Vector Drawable" : "SVG",
  };
}

export function useProjectImport() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const openFilePicker = useCallback(() => inputRef.current?.click(), []);

  const importFiles = useCallback(async (files: File[]) => {
    const supported = files.filter((file) => SUPPORTED_FILE.test(file.name));
    if (!supported.length) {
      toast.error("Choose an SVG, Vector Drawable XML, or ShapeShifter project");
      return;
    }
    if (supported.length > 1) toast.info(`Importing ${supported.length} files…`);
    for (const file of supported) {
      try {
        const summary = importEditorText(file.name, await file.text());
        toast.success(summary.title, { description: summary.description });
      } catch (error) {
        toast.error(`Couldn’t import ${file.name}`, { description: String(error) });
      }
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fileUrl = params.get("url") || params.get("import");
    if (!fileUrl) return;
    const request = fetch(fileUrl).then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const summary = importEditorText(fileNameFromUrl(fileUrl), await response.text());
      return summary.title;
    });
    toast.promise(request, {
      loading: "Importing linked file…",
      success: (message) => message,
      error: (error) => `Couldn’t import linked file: ${String(error)}`,
    });
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
