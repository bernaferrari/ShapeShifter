"use client";

import React, { useCallback } from "react";
import {
  Play,
  Zap,
  RotateCw,
  ArrowLeftRight,
  HelpCircle,
  Download,
  MousePointer2,
  PenTool,
  Lasso,
  PaintBucket,
  PanelRightClose,
  PanelRightOpen,
  PanelLeftOpen,
  ChevronUp,
  Waypoints,
  CloudUpload,
  Heart,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@/components/ui/command";
import { toast } from "sonner";
import { PAGE_ROOT_ID, useEditorStore } from "@/lib/store/editorStore";
import { parsePath } from "@/lib/shapeshifter/pathUtils";
import {
  downloadAnimatedSVG,
  downloadCSSKeyframes,
  downloadLottie,
  exportAnimatedVectorDrawable,
  exportPDF,
  exportProjectJSON,
  exportStaticSVG,
  exportSvgSpritesheet,
  exportVectorDrawable,
} from "@/lib/shapeshifter/exporter";
import { flattenOriginalProject, isOriginalShapeShifterProject } from "@/lib/shapeshifter/project";
import { DEMO_INFOS } from "@/lib/shapeshifter/demoProjects";
import { importLayersFromSvg, importLayersFromVectorDrawable } from "@/lib/shapeshifter/importers";
import type { AnimationState, Layer } from "@/lib/shapeshifter/types";
import { Toolbar } from "@/components/editor/Toolbar";
import { CanvasArea } from "@/components/editor/CanvasArea";
import { Inspector } from "@/components/editor/Inspector";
import { LayerTimeline } from "@/components/editor/LayerTimeline";
import { LayersPanel } from "@/components/editor/LayersPanel";
import { BottomToolPalette } from "@/components/editor/BottomToolPalette";
import { Onboarding } from "@/components/editor/Onboarding";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import {
  isEditableTarget,
  useEditorKeyboardShortcuts,
} from "@/components/editor/hooks/useEditorKeyboardShortcuts";
import { useEditorPlayback } from "@/components/editor/hooks/useEditorPlayback";

// Below this viewport width the fixed w-80 inspector + timeline get cramped, so
// the inspector auto-collapses into a toggle (Figma-style responsive degrade).
const NARROW_BREAKPOINT = 1100;

function readPageRoot(project: unknown): {
  layers: Layer[];
  animation: AnimationState;
  hiddenLayerIds: string[];
} | null {
  if (!project || typeof project !== "object") return null;
  const candidate = (project as { pageRoot?: unknown }).pageRoot;
  if (!candidate || typeof candidate !== "object") return null;
  const raw = candidate as {
    layers?: Array<Partial<Layer> & { from?: Layer["from"] | string; to?: Layer["to"] | string }>;
    animation?: AnimationState;
    hiddenLayerIds?: string[];
  };
  if (!Array.isArray(raw.layers)) return null;
  const layers = raw.layers.map((layer, index): Layer => {
    const fromSource = layer.from ?? layer.pathData ?? "";
    const from = typeof fromSource === "string" ? parsePath(fromSource) : fromSource;
    const to = typeof layer.to === "string" ? parsePath(layer.to) : layer.to;
    return {
      ...layer,
      id: layer.id ?? `root-layer-${Date.now()}-${index}`,
      name: layer.name ?? `Page vector ${index + 1}`,
      type: layer.type ?? "path",
      from,
      to,
      pathData: from,
      visible: layer.visible ?? true,
      locked: layer.locked ?? false,
    };
  });
  return {
    layers,
    animation: raw.animation ?? {
      id: "page-root-animation",
      name: "Page motion",
      duration: 1000,
      blocks: [],
    },
    hiddenLayerIds: Array.isArray(raw.hiddenLayerIds) ? raw.hiddenLayerIds.map(String) : [],
  };
}

export default function ShapeShifter2026() {
  useEditorKeyboardShortcuts();
  const playbackActive = useEditorPlayback();

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fileUrl = params.get("url") || params.get("import");

    if (fileUrl) {
      toast.promise(
        fetch(fileUrl)
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            return res.text();
          })
          .then((text) => {
            const fileName = fileUrl.split("/").pop() || "imported_file";
            if (fileName.endsWith(".json") || fileName.endsWith(".shapeshifter")) {
              const project = JSON.parse(text);
              if (isOriginalShapeShifterProject(project)) {
                const flattened = flattenOriginalProject(project);
                useEditorStore.getState().loadProject(flattened);
                setTimelineCollapsed(false);
                // vrh/24t residual: restore frames (x/y layout) from exportProjectJSON for full freeform project roundtrip fidelity (complex multi-artboard case). Uses loaded projection content + serialized metadata. Matches exporter surface. Zero regression.
                if (
                  (project as any).frames &&
                  Array.isArray((project as any).frames) &&
                  (project as any).frames.length > 0
                ) {
                  const st = useEditorStore.getState();
                  const baseFrame = st.frames?.[0];
                  const restoredFrames = (project as any).frames.map((f: any, idx: number) => ({
                    ...baseFrame,
                    id: String(f.id || `frame-${Date.now()}-${idx}`),
                    name: String(f.name || baseFrame?.name || `Frame ${idx + 1}`),
                    x: Number(f.x ?? 0),
                    y: Number(f.y ?? 0),
                  }));
                  useEditorStore.setState({
                    frames: restoredFrames as any,
                    selectedFrameId: restoredFrames[0]?.id || st.selectedFrameId,
                  });
                }
                const pageRoot = readPageRoot(project);
                if (pageRoot) {
                  useEditorStore.setState({
                    rootLayers: pageRoot.layers,
                    rootAnimation: pageRoot.animation,
                    rootHiddenLayerIds: pageRoot.hiddenLayerIds,
                  });
                }
                return `Loaded project: ${flattened.vector.name}`;
              } else {
                const importedLayers: Layer[] = Array.isArray(project.layers)
                  ? project.layers.map((layer: Partial<Layer>, index: number) => ({
                      ...layer,
                      id: layer.id ?? Date.now() + index,
                      type: layer.type ?? "path",
                      from: typeof layer.from === "string" ? parsePath(layer.from) : layer.from,
                      to: typeof layer.to === "string" ? parsePath(layer.to) : layer.to,
                      pathData:
                        typeof layer.from === "string" ? parsePath(layer.from) : layer.pathData,
                      visible: layer.visible ?? true,
                      locked: layer.locked ?? false,
                    }))
                  : [];
                useEditorStore.getState().setLayers(importedLayers);
                return `Loaded project with ${importedLayers.length} layers`;
              }
            } else if (fileName.endsWith(".xml")) {
              const importedLayers = importLayersFromVectorDrawable(text);
              useEditorStore.getState().importLayers(importedLayers);
              return `Imported ${importedLayers.length} layers from Vector XML`;
            } else {
              const importedLayers = importLayersFromSvg(text, fileName.replace(/\.[^.]+$/, ""));
              useEditorStore.getState().importLayers(importedLayers);
              return `Imported ${importedLayers.length} layers from SVG`;
            }
          }),
        {
          loading: `Fetching file from URL...`,
          success: (msg) => msg,
          error: (err) => `Failed to load URL: ${err.message}`,
        },
      );
    }
  }, []);

  // Everything comes from the store (single source of truth)
  const editingSide = useEditorStore((state) => state.editingSide);
  const isPlaying = playbackActive;
  const isActionMode = useEditorStore((state) => state.isActionMode);
  const setEditingSide = useEditorStore((state) => state.setEditingSide);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const canUndo = useEditorStore((state) => state.canUndo);
  const canRedo = useEditorStore((state) => state.canRedo);
  const timelineCollapsed = useEditorStore((state) => state.timelineCollapsed);
  const setTimelineCollapsed = useEditorStore((state) => state.setTimelineCollapsed);

  // Hidden file input for original SVG/XML/project import
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      try {
        if (file.name.endsWith(".json") || file.name.endsWith(".shapeshifter")) {
          const project = JSON.parse(text);
          if (isOriginalShapeShifterProject(project)) {
            const flattened = flattenOriginalProject(project);
            if (!flattened.layers.length) {
              toast.error("No path layers found in original project");
              return;
            }
            useEditorStore.getState().loadProject(flattened);
            setTimelineCollapsed(false);
            // vrh/24t residual: restore frames (x/y layout) from exportProjectJSON for full freeform project roundtrip fidelity (complex multi-artboard case). Uses loaded projection content + serialized metadata. Matches exporter surface. Zero regression.
            if (
              (project as any).frames &&
              Array.isArray((project as any).frames) &&
              (project as any).frames.length > 0
            ) {
              const st = useEditorStore.getState();
              const baseFrame = st.frames?.[0];
              const restoredFrames = (project as any).frames.map((f: any, idx: number) => ({
                ...baseFrame,
                id: String(f.id || `frame-${Date.now()}-${idx}`),
                name: String(f.name || baseFrame?.name || `Frame ${idx + 1}`),
                x: Number(f.x ?? 0),
                y: Number(f.y ?? 0),
              }));
              useEditorStore.setState({
                frames: restoredFrames as any,
                selectedFrameId: restoredFrames[0]?.id || st.selectedFrameId,
              });
            }
            const pageRoot = readPageRoot(project);
            if (pageRoot) {
              useEditorStore.setState({
                rootLayers: pageRoot.layers,
                rootAnimation: pageRoot.animation,
                rootHiddenLayerIds: pageRoot.hiddenLayerIds,
              });
            }
            toast.success(`Opened ${flattened.vector.name}`, {
              description: `${flattened.layers.length} layer(s), ${flattened.animation.blocks.length} animation block(s)`,
            });
            return;
          }

          const importedLayers: Layer[] = Array.isArray(project.layers)
            ? project.layers.map((layer: Partial<Layer>, index: number) => ({
                ...layer,
                id: layer.id ?? Date.now() + index,
                type: layer.type ?? "path",
                from: typeof layer.from === "string" ? parsePath(layer.from) : layer.from,
                to: typeof layer.to === "string" ? parsePath(layer.to) : layer.to,
                pathData: typeof layer.from === "string" ? parsePath(layer.from) : layer.pathData,
                visible: layer.visible ?? true,
                locked: layer.locked ?? false,
              }))
            : [];
          if (!importedLayers.length) {
            toast.error("No layers found in project file");
            return;
          }
          useEditorStore.getState().setLayers(importedLayers);
          toast.success(`Opened project with ${importedLayers.length} layer(s)`);
          return;
        }

        const importedLayers = file.name.endsWith(".xml")
          ? importLayersFromVectorDrawable(text)
          : importLayersFromSvg(text, file.name.replace(/\.[^.]+$/, ""));

        if (importedLayers.length === 0) {
          toast.error("No path data found in file");
          return;
        }
        useEditorStore.getState().importLayers(importedLayers);
        toast.success(
          `Imported ${importedLayers.length} layer(s) from ${file.name.endsWith(".xml") ? "Vector Drawable" : "SVG"}`,
        );
      } catch (error) {
        toast.error("Failed to parse file", { description: String(error) });
      }
    };
    reader.readAsText(file);
  };

  const [isDraggingFile, setIsDraggingFile] = React.useState(false);

  const openSVGImport = useCallback(() => fileInputRef.current?.click(), []);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes("Files")) {
      setIsDraggingFile(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    if (
      e.clientX < rect.left ||
      e.clientX >= rect.right ||
      e.clientY < rect.top ||
      e.clientY >= rect.bottom
    ) {
      setIsDraggingFile(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingFile(false);
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      /\.(svg|xml|json|shapeshifter)$/i.test(f.name),
    );
    if (files.length > 0) {
      files.forEach((file) => handleImportFile(file));
      if (files.length > 1) {
        toast.info(`Importing ${files.length} files...`);
      }
    } else {
      toast.error("Please drop an SVG, Vector Drawable XML, or project file");
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes("Files")) {
      setIsDraggingFile(true);
    }
  };

  // Reset keys for each canvas pane (increment to trigger reset)
  const [resetFrom, setResetFrom] = React.useState(0);
  const [resetPreview, setResetPreview] = React.useState(0);
  const [resetTo, setResetTo] = React.useState(0);

  const resetAllViews = () => {
    setResetFrom((k) => k + 1);
    setResetPreview((k) => k + 1);
    setResetTo((k) => k + 1);
    toast.success("Views reset");
  };

  // === COMMAND PALETTE STATE (moved inside for correctness) ===
  const [commandOpen, setCommandOpen] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);

  // === PANEL COLLAPSE / RESPONSIVE STATE ===
  // User intent (persisted). The actual inspector visibility also folds in the
  // narrow-viewport auto-collapse below, but we never overwrite the user's choice.
  const [inspectorCollapsed, setInspectorCollapsed] = React.useState(false);
  const [layersCollapsed, setLayersCollapsed] = React.useState(false);
  const [isNarrow, setIsNarrow] = React.useState(false);

  React.useEffect(() => {
    try {
      setInspectorCollapsed(localStorage.getItem("shapeshifter:panel:inspector") === "1");
      setLayersCollapsed(localStorage.getItem("shapeshifter:panel:layers") === "1");
      const storedTimeline = localStorage.getItem("shapeshifter:panel:timeline");
      setTimelineCollapsed(storedTimeline == null || storedTimeline === "1");
    } catch {
      // ignore — localStorage may be unavailable
    }
  }, []);

  const toggleInspector = React.useCallback(() => {
    setInspectorCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("shapeshifter:panel:inspector", next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const toggleLayers = React.useCallback(() => {
    setLayersCollapsed((previous) => {
      const next = !previous;
      try {
        localStorage.setItem("shapeshifter:panel:layers", next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const toggleTimeline = React.useCallback(() => {
    const next = !useEditorStore.getState().timelineCollapsed;
    setTimelineCollapsed(next);
    try {
      localStorage.setItem("shapeshifter:panel:timeline", next ? "1" : "0");
    } catch {
      // ignore
    }
  }, [setTimelineCollapsed]);

  // Auto-collapse the inspector on narrow viewports so nothing clips.
  React.useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < NARROW_BREAKPOINT);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Effective visibility: collapsed by explicit toggle OR forced by narrow width.
  const inspectorHidden = inspectorCollapsed || isNarrow;
  const layersHidden = layersCollapsed || isNarrow;

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Paste SVG (and basic VD) support for pro import UX (xjw gap, matches drag/toolbar/file surfaces)
  React.useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const text = e.clipboardData?.getData("text/plain")?.trim();
      if (!text) return;
      const isSvgLike = text.startsWith("<svg") || text.includes("<svg") || text.includes("<path ");
      const isXmlLike = text.startsWith("<?xml") || text.includes("<vector");
      if (isSvgLike || isXmlLike) {
        e.preventDefault();
        try {
          const importedLayers = isXmlLike
            ? importLayersFromVectorDrawable(text)
            : importLayersFromSvg(text, "pasted");
          if (importedLayers.length === 0) {
            toast.error("No path data found in pasted content");
            return;
          }
          useEditorStore.getState().importLayers(importedLayers);
          toast.success(
            `Pasted ${importedLayers.length} layer(s) from ${isXmlLike ? "Vector Drawable" : "SVG"}`,
          );
        } catch (err) {
          toast.error("Failed to import pasted content", { description: String(err) });
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  const runCommand = (action: () => void) => {
    action();
    setCommandOpen(false);
  };

  // === MISSING HANDLERS FOR TOOLBAR & COMMAND PALETTE ===
  const handleExport = (type: string) => {
    const state = useEditorStore.getState();
    const layer = state.layers.find((l) => l.id === state.selectedLayerId) || state.layers[0];
    if (!layer) {
      toast.error("No layer to export");
      return;
    }

    const fromPath = layer.from;
    const toPath = layer.to ?? layer.from;
    const name = layer.name.replace(/\s+/g, "-").toLowerCase();

    try {
      if (type === "svg" || type === "animated") {
        downloadAnimatedSVG(fromPath, toPath, name);
        toast.success("Animated SVG exported");
      } else if (type === "css") {
        downloadCSSKeyframes(fromPath, toPath, name);
        toast.success("CSS Keyframes exported");
      } else if (type === "lottie") {
        downloadLottie(fromPath, toPath, name, layer);
        toast.success("Lottie exported");
      } else if (type === "vector" || type === "avd" || type === "spritesheet") {
        const content =
          type === "vector"
            ? exportVectorDrawable(layer)
            : type === "avd"
              ? exportAnimatedVectorDrawable(layer)
              : exportSvgSpritesheet(layer);
        const blob = new Blob([content], {
          type: type === "spritesheet" ? "image/svg+xml" : "application/xml",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${name}-${type}.${type === "spritesheet" ? "svg" : "xml"}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success(`${type.toUpperCase()} exported`);
      } else if (type === "json") {
        const payload = JSON.stringify(
          exportProjectJSON(
            state.layers,
            state.vector,
            state.animation,
            state.hiddenLayerIds,
            state.frames,
            {
              layers: state.selectedFrameId === PAGE_ROOT_ID ? state.layers : state.rootLayers,
              animation:
                state.selectedFrameId === PAGE_ROOT_ID ? state.animation : state.rootAnimation,
              hiddenLayerIds:
                state.selectedFrameId === PAGE_ROOT_ID
                  ? state.hiddenLayerIds
                  : state.rootHiddenLayerIds,
            },
          ),
          null,
          2,
        );
        const blob = new Blob([payload], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${state.vector.name || "shapeshifter"}.shapeshifter`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success("Project exported");
      } else if (type === "pdf") {
        const all = state.layers.filter((l: any) => l.visible !== false);
        const pdf = exportPDF(all.length ? all : state.layers);
        const blob = new Blob([pdf], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${name}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success("PDF exported");
      } else if (type === "static") {
        const all = state.layers.filter((l: any) => l.visible !== false);
        const svg = exportStaticSVG(all.length ? all : state.layers);
        const blob = new Blob([svg], { type: "image/svg+xml" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${name}-static.svg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success("High-fidelity static SVG exported");
      } else {
        toast.info(`Export type "${type}" (use Export dialog for full options)`);
      }
    } catch (e) {
      toast.error("Export failed", {
        description: String(e) || "Partial export may have succeeded; check downloads.",
      });
    }
  };

  const loadSample = (index: number) => {
    const { loadSample: storeLoadSample } = useEditorStore.getState();
    storeLoadSample(index);
    const demo = DEMO_INFOS[((index % DEMO_INFOS.length) + DEMO_INFOS.length) % DEMO_INFOS.length];
    toast.success("Demo loaded", { description: demo.title });
    // Force the timeline panel + tracks to be visible so the demo's animation blocks are obvious
    setTimelineCollapsed(false);
  };

  const togglePlay = () => {
    const { togglePlayback } = useEditorStore.getState();
    togglePlayback();
  };

  const resetAnim = () => {
    const { setProgress } = useEditorStore.getState();
    setProgress(0);
  };

  // Playback + animation state flows from Zustand

  return (
    <div
      className="relative flex h-dvh flex-col bg-background text-foreground"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
    >
      {/* File Drag-and-Drop Overlay — pro Figma drop target polish (dashed target + refined elevation) */}
      {isDraggingFile && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/80 backdrop-blur-md animate-in fade-in zoom-in-95 duration-200">
          <div className="flex flex-col items-center gap-6 rounded-2xl border-2 border-dashed border-primary/40 bg-card/95 p-12 shadow-2xl ring-1 ring-primary/10 max-w-md text-center">
            <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <CloudUpload size={48} className="animate-bounce" />
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-2xl font-bold tracking-tight">Drop to Import</h3>
              <p className="text-sm text-muted-foreground">
                SVG, Vector Drawable XML, or <code className="font-mono">.shapeshifter</code>{" "}
                project
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 text-[10px] font-medium text-muted-foreground border-t pt-5 w-full tracking-wide">
              <span className="rounded bg-muted px-2 py-0.5">.svg</span>
              <span className="rounded bg-muted px-2 py-0.5">.xml</span>
              <span className="rounded bg-muted px-2 py-0.5">.json / .shapeshifter</span>
            </div>
          </div>
        </div>
      )}

      <Toolbar
        onExport={handleExport}
        onLoadSample={loadSample}
        onTogglePlay={togglePlay}
        onResetAnim={resetAnim}
        onOpenSVGImport={openSVGImport}
        onShowHelp={() => setHelpOpen(true)}
        resetAllViews={resetAllViews}
        isPlaying={isPlaying}
        isActionMode={isActionMode}
        editingSide={editingSide}
        setEditingSide={setEditingSide}
        undo={undo}
        redo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
      />

      {/* Figma Motion model: the timeline is a document-wide bottom workspace,
          not a canvas-only panel trapped between the sidebars. */}
      <div className="relative min-h-0 flex-1 overflow-hidden bg-muted">
        <ResizablePanelGroup orientation="vertical" className="min-h-0">
          <ResizablePanel id="workspace" minSize={54} defaultSize={timelineCollapsed ? 100 : 72}>
            <div className="relative flex h-full min-h-0 overflow-hidden">
              {!layersHidden && <LayersPanel onCollapse={toggleLayers} />}
              <main className="relative flex min-w-0 flex-1 overflow-hidden">
                <CanvasArea
                  resetFrom={resetFrom}
                  resetPreview={resetPreview}
                  resetTo={resetTo}
                  resetAllViews={resetAllViews}
                />
                <div className="pointer-events-none absolute inset-y-0 left-3 z-30 flex items-center">
                  <div className="pointer-events-auto">
                    <BottomToolPalette />
                  </div>
                </div>
                <Onboarding />
              </main>

              <aside
                className={cn(
                  "flex h-full shrink-0 flex-col overflow-hidden border-l bg-sidebar shadow-xs",
                  inspectorHidden ? "w-0 border-l-0 opacity-0" : "w-72 opacity-100",
                )}
              >
                <div className="flex h-full w-72 flex-col">
                  <Inspector />
                </div>
              </aside>

              {layersHidden && !isNarrow && (
                <button
                  type="button"
                  onClick={toggleLayers}
                  aria-label="Show layers"
                  className="absolute left-2 top-2.5 z-30 grid size-7 place-items-center rounded-md border border-border bg-card/90 text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:text-foreground"
                >
                  <PanelLeftOpen className="size-4" />
                </button>
              )}

              {!isNarrow && (
                <button
                  type="button"
                  onClick={toggleInspector}
                  aria-label={inspectorCollapsed ? "Show inspector" : "Hide inspector"}
                  aria-expanded={!inspectorCollapsed}
                  className="absolute right-2 top-2.5 z-30 grid size-7 place-items-center rounded-md border border-border bg-card/90 text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:text-foreground"
                >
                  {inspectorCollapsed ? (
                    <PanelRightOpen className="size-4" />
                  ) : (
                    <PanelRightClose className="size-4" />
                  )}
                </button>
              )}
            </div>
          </ResizablePanel>

          {!timelineCollapsed && (
            <>
              <ResizableHandle className="bg-border/80" />
              <ResizablePanel id="timeline" minSize={18} defaultSize={30}>
                <LayerTimeline onCollapse={toggleTimeline} />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>

        {timelineCollapsed && (
          <button
            type="button"
            onClick={toggleTimeline}
            aria-label="Show timeline"
            aria-expanded={false}
            className="absolute bottom-1.5 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 rounded-md border border-border bg-card/90 px-2 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:text-foreground"
          >
            <ChevronUp className="size-3.5" />
            Timeline
          </button>
        )}
      </div>

      <input
        type="file"
        ref={fileInputRef}
        accept=".svg,.xml,.json,.shapeshifter"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files;
          if (files) {
            Array.from(files).forEach((f) => handleImportFile(f));
          }
          e.target.value = "";
        }}
      />

      {/* Help / Shortcuts Modal — Figma-grade polish: sectioned + kbd visuals for pro delight */}
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Keyboard Shortcuts</DialogTitle>
          </DialogHeader>
          <div className="py-2 text-sm space-y-4">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">
                Playback &amp; Timeline
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <kbd className="rounded bg-muted px-1.5 py-px font-mono text-xs">Space</kbd>
                  <span className="text-muted-foreground">Tap play · hold+drag pan</span>
                </div>
                <div className="flex items-center justify-between">
                  <kbd className="rounded bg-muted px-1.5 py-px font-mono text-xs">H</kbd>
                  <span className="text-muted-foreground">Hand / pan</span>
                </div>
                <div className="flex items-center justify-between">
                  <kbd className="rounded bg-muted px-1.5 py-px font-mono text-xs">
                    Timeline blocks
                  </kbd>
                  <span className="text-muted-foreground">Drag to move + edge resize</span>
                </div>
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">
                Tools
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <kbd className="rounded bg-muted px-1.5 py-px font-mono text-xs">V</kbd>
                  <span className="text-muted-foreground">Move / Select</span>
                </div>
                <div className="flex items-center justify-between">
                  <kbd className="rounded bg-muted px-1.5 py-px font-mono text-xs">A / D</kbd>
                  <span className="text-muted-foreground">Vector / Direct</span>
                </div>
                <div className="flex items-center justify-between">
                  <kbd className="rounded bg-muted px-1.5 py-px font-mono text-xs">P</kbd>
                  <span className="text-muted-foreground">Pen</span>
                </div>
                <div className="flex items-center justify-between">
                  <kbd className="rounded bg-muted px-1.5 py-px font-mono text-xs">L</kbd>
                  <span className="text-muted-foreground">Lasso</span>
                </div>
                <div className="flex items-center justify-between">
                  <kbd className="rounded bg-muted px-1.5 py-px font-mono text-xs">B</kbd>
                  <span className="text-muted-foreground">Paint / Fill</span>
                </div>
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">
                Editing
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <kbd className="rounded bg-muted px-1.5 py-px font-mono text-xs">⇧F</kbd>
                  <span className="text-muted-foreground">Auto Fix morph</span>
                </div>
                <div className="flex items-center justify-between">
                  <kbd className="rounded bg-muted px-1.5 py-px font-mono text-xs">⇧R</kbd>
                  <span className="text-muted-foreground">Reverse path</span>
                </div>
                <div className="flex items-center justify-between">
                  <kbd className="rounded bg-muted px-1.5 py-px font-mono text-xs">⇧S</kbd>
                  <span className="text-muted-foreground">Shift points</span>
                </div>
                <div className="flex items-center justify-between">
                  <kbd className="rounded bg-muted px-1.5 py-px font-mono text-xs">⌘G / ⇧⌘G</kbd>
                  <span className="text-muted-foreground">Group / Ungroup</span>
                </div>
                <div className="flex items-center justify-between">
                  <kbd className="rounded bg-muted px-1.5 py-px font-mono text-xs">X</kbd>
                  <span className="text-muted-foreground">Split command</span>
                </div>
                <div className="flex items-center justify-between">
                  <kbd className="rounded bg-muted px-1.5 py-px font-mono text-xs">Delete / ⌫</kbd>
                  <span className="text-muted-foreground">Remove point(s) (lasso multi ok)</span>
                </div>
                <div className="flex items-center justify-between">
                  <kbd className="rounded bg-muted px-1.5 py-px font-mono text-xs">
                    Arrows (+Shift)
                  </kbd>
                  <span className="text-muted-foreground">Nudge (fine/coarse)</span>
                </div>
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">
                Navigation &amp; Power
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <kbd className="rounded bg-muted px-1.5 py-px font-mono text-xs">⌘K</kbd>
                  <span className="text-muted-foreground">Command palette</span>
                </div>
                <div className="flex items-center justify-between">
                  <kbd className="rounded bg-muted px-1.5 py-px font-mono text-xs">⌘Z / ⌘⇧Z</kbd>
                  <span className="text-muted-foreground">Undo / Redo</span>
                </div>
                <div className="flex items-center justify-between">
                  <kbd className="rounded bg-muted px-1.5 py-px font-mono text-xs">1 / 2</kbd>
                  <span className="text-muted-foreground">Start / End path (morph edit)</span>
                </div>
                <div className="flex items-center justify-between">
                  <kbd className="rounded bg-muted px-1.5 py-px font-mono text-xs">⇧1 / ⇧2</kbd>
                  <span className="text-muted-foreground">Fit all / Fit selection</span>
                </div>
                <div className="flex items-center justify-between">
                  <kbd className="rounded bg-muted px-1.5 py-px font-mono text-xs">Esc / Enter</kbd>
                  <span className="text-muted-foreground">
                    Clear selection (or finish pen path)
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <kbd className="rounded bg-muted px-1.5 py-px font-mono text-xs">⌘W</kbd>
                  <span className="text-muted-foreground">Close Action Mode</span>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Command Palette - professional Cmd+K (fuzzy, all tools/actions/recent, keyboard nav, toasts) */}
      <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
        <CommandInput placeholder="Type a command or search..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Tools">
            <CommandItem
              onSelect={() =>
                runCommand(() => {
                  useEditorStore.getState().setToolMode("select");
                  toast.success("Move/Select tool");
                })
              }
            >
              <MousePointer2 className="mr-2 h-4 w-4" /> Move / Select{" "}
              <CommandShortcut>V</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() =>
                runCommand(() => {
                  useEditorStore.getState().setToolMode("pen");
                  toast.success(
                    "Pen tool — click to add, drag curves, dbl-click last or Esc/Enter to finish",
                  );
                })
              }
            >
              <PenTool className="mr-2 h-4 w-4" /> Pen <CommandShortcut>P</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() =>
                runCommand(() => {
                  useEditorStore.getState().setToolMode("direct");
                  toast.success("Direct / Bend Flex");
                })
              }
            >
              <Waypoints className="mr-2 size-4" /> Direct / Bend (Ctrl+drag){" "}
              <CommandShortcut>D</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() =>
                runCommand(() => {
                  useEditorStore.getState().setToolMode("pencil");
                  toast.success("Lasso / Pencil");
                })
              }
            >
              <Lasso className="mr-2 h-4 w-4" /> Lasso / Pencil <CommandShortcut>L</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() =>
                runCommand(() => {
                  useEditorStore.getState().setToolMode("paint");
                  toast.success("Paint / Fill");
                })
              }
            >
              <PaintBucket className="mr-2 h-4 w-4" /> Paint / Fill (bucket){" "}
              <CommandShortcut>B</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Actions">
            <CommandItem
              onSelect={() => {
                setHelpOpen(true);
                setCommandOpen(false);
              }}
            >
              <HelpCircle className="mr-2 h-4 w-4" /> Show Keyboard Shortcuts
            </CommandItem>
            <CommandItem
              onSelect={() =>
                runCommand(() => {
                  const { togglePlayback } = useEditorStore.getState();
                  togglePlayback();
                })
              }
            >
              <Play className="mr-2 h-4 w-4" /> Toggle Playback{" "}
              <CommandShortcut>Space</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() =>
                runCommand(() => {
                  const { autoFixSelectedLayer } = useEditorStore.getState();
                  autoFixSelectedLayer();
                })
              }
            >
              <Zap className="mr-2 h-4 w-4" /> Auto Fix <CommandShortcut>⇧F</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() =>
                runCommand(() => {
                  const { reverseSelectedLayer } = useEditorStore.getState();
                  reverseSelectedLayer();
                })
              }
            >
              <RotateCw className="mr-2 h-4 w-4" /> Reverse <CommandShortcut>⇧R</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() =>
                runCommand(() => {
                  const { shiftSelectedLayer } = useEditorStore.getState();
                  shiftSelectedLayer(1);
                })
              }
            >
              <ArrowLeftRight className="mr-2 h-4 w-4" /> Shift Points{" "}
              <CommandShortcut>⇧S</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() =>
                runCommand(() => {
                  const s = useEditorStore.getState();
                  s.booleanCombine?.("union");
                  toast.success("Union");
                })
              }
            >
              Union (selected + next)
            </CommandItem>
            <CommandItem
              onSelect={() =>
                runCommand(() => {
                  const s = useEditorStore.getState();
                  s.addLayer?.("path");
                  toast.success("Layer added");
                })
              }
            >
              Add Path Layer
            </CommandItem>
            <CommandItem
              onSelect={() =>
                runCommand(() => {
                  const { toggleSlowMotion } = useEditorStore.getState();
                  toggleSlowMotion();
                  toast.success("Slow motion toggled");
                })
              }
            >
              <RotateCw className="mr-2 h-4 w-4" /> Toggle Slow Motion (0.25x)
            </CommandItem>
            <CommandItem
              onSelect={() =>
                runCommand(() => {
                  const { toggleRepeating } = useEditorStore.getState();
                  toggleRepeating();
                  toast.success("Repeat toggled");
                })
              }
            >
              <Play className="mr-2 h-4 w-4" /> Toggle Repeat Playback
            </CommandItem>
            <CommandItem
              onSelect={() =>
                runCommand(() => {
                  const { setProgress } = useEditorStore.getState();
                  setProgress(0);
                  toast.success("Playback head reset");
                })
              }
            >
              <Zap className="mr-2 h-4 w-4" /> Reset Playback Head
            </CommandItem>
            <CommandItem
              onSelect={() =>
                runCommand(() => {
                  const s = useEditorStore.getState();
                  s.clearBlockSelection?.();
                  toast.success("Block selection cleared");
                })
              }
            >
              Clear Timeline Block Selection
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Recent">
            {DEMO_INFOS.slice(0, 4).map((demo, index) => (
              <CommandItem key={demo.id} onSelect={() => runCommand(() => loadSample(index))}>
                <Heart size={16} className="mr-2" /> {demo.title}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Export">
            <CommandItem onSelect={() => runCommand(() => handleExport("svg"))}>
              <Download className="mr-2 h-4 w-4" /> Export Animated SVG
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => handleExport("static"))}>
              <Download className="mr-2 h-4 w-4" /> Export High-Fidelity Static SVG
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => handleExport("css"))}>
              <Download className="mr-2 h-4 w-4" /> Export CSS Keyframes
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => handleExport("json"))}>
              <Download className="mr-2 h-4 w-4" /> Export Project JSON (frames)
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => handleExport("lottie"))}>
              <Download className="mr-2 h-4 w-4" /> Export Lottie JSON
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => handleExport("vector"))}>
              <Download className="mr-2 h-4 w-4" /> Export Vector Drawable
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => handleExport("avd"))}>
              <Download className="mr-2 h-4 w-4" /> Export Animated Vector Drawable
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => handleExport("spritesheet"))}>
              <Download className="mr-2 h-4 w-4" /> Export SVG Spritesheet
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => handleExport("pdf"))}>
              <Download className="mr-2 h-4 w-4" /> Export Vector PDF
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </div>
  );
}
