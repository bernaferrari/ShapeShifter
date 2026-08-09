"use client";

import React from "react";
import {
  PanelRightClose,
  PanelRightOpen,
  PanelLeftOpen,
  ChevronUp,
  CloudUpload,
} from "lucide-react";
import { toast } from "sonner";
import { useEditorStore } from "@/lib/store/editorStore";
import { DEMO_INFOS } from "@/lib/shapeshifter/demoProjects";
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
import { useProjectImport } from "@/components/editor/project/useProjectImport";
import { useProjectExport } from "@/components/editor/project/useProjectExport";
import { EditorCommandPalette, EditorHelpDialog } from "@/components/editor/EditorDialogs";

// Below this viewport width the fixed w-80 inspector + timeline get cramped, so
// the inspector auto-collapses into a toggle (Figma-style responsive degrade).
const NARROW_BREAKPOINT = 1100;

export default function ShapeShifter2026() {
  useEditorKeyboardShortcuts();
  const playbackActive = useEditorPlayback();
  const {
    inputRef: fileInputRef,
    isDraggingFile,
    openFilePicker: openSVGImport,
    importFiles,
    dragHandlers,
  } = useProjectImport();
  const handleExport = useProjectExport();

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
  const [narrowPanel, setNarrowPanel] = React.useState<"layers" | "inspector" | null>(null);

  React.useEffect(() => {
    try {
      setInspectorCollapsed(localStorage.getItem("shapeshifter:panel:inspector") === "1");
      setLayersCollapsed(localStorage.getItem("shapeshifter:panel:layers") === "1");
      const storedTimeline = localStorage.getItem("shapeshifter:panel:timeline");
      setTimelineCollapsed(storedTimeline === "1");
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
  const inspectorHidden = isNarrow ? narrowPanel !== "inspector" : inspectorCollapsed;
  const layersHidden = isNarrow ? narrowPanel !== "layers" : layersCollapsed;

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
    <div className="relative flex h-dvh flex-col bg-background text-foreground" {...dragHandlers}>
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
              {!layersHidden && (
                <LayersPanel
                  onCollapse={isNarrow ? () => setNarrowPanel(null) : toggleLayers}
                  className={
                    isNarrow
                      ? "absolute inset-y-0 left-0 z-40 shadow-[8px_0_24px_rgba(0,0,0,0.16)]"
                      : undefined
                  }
                />
              )}
              <main className="relative flex min-w-0 flex-1 overflow-hidden">
                <CanvasArea
                  resetFrom={resetFrom}
                  resetPreview={resetPreview}
                  resetTo={resetTo}
                  resetAllViews={resetAllViews}
                />
                <div className="pointer-events-none absolute bottom-3 left-1/2 z-30 -translate-x-1/2">
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
                  isNarrow &&
                    !inspectorHidden &&
                    "absolute inset-y-0 right-0 z-40 shadow-[-8px_0_24px_rgba(0,0,0,0.16)]",
                )}
              >
                <div className="flex h-full w-72 flex-col">
                  <Inspector />
                </div>
              </aside>

              {layersHidden && (
                <button
                  type="button"
                  onClick={() => (isNarrow ? setNarrowPanel("layers") : toggleLayers())}
                  aria-label="Show layers"
                  className="absolute left-2 top-2.5 z-50 grid size-7 place-items-center rounded-md bg-card/90 text-muted-foreground [box-shadow:var(--elevation-floating)] backdrop-blur-sm transition-colors hover:text-foreground"
                >
                  <PanelLeftOpen className="size-4" />
                </button>
              )}

              <button
                type="button"
                onClick={() =>
                  isNarrow
                    ? setNarrowPanel((panel) => (panel === "inspector" ? null : "inspector"))
                    : toggleInspector()
                }
                aria-label={inspectorHidden ? "Show inspector" : "Hide inspector"}
                aria-expanded={!inspectorHidden}
                className="absolute right-2 top-2.5 z-50 grid size-7 place-items-center rounded-md bg-card/90 text-muted-foreground [box-shadow:var(--elevation-floating)] backdrop-blur-sm transition-colors hover:text-foreground"
              >
                {inspectorHidden ? (
                  <PanelRightOpen className="size-4" />
                ) : (
                  <PanelRightClose className="size-4" />
                )}
              </button>
            </div>
          </ResizablePanel>

          {!timelineCollapsed && (
            <>
              <ResizableHandle className="bg-border/80" />
              <ResizablePanel id="timeline" minSize={16} defaultSize={25}>
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
            className="absolute bottom-3 left-1/2 z-30 ml-[122px] flex h-8 items-center gap-1 rounded-md bg-card/90 px-2 text-[11px] text-muted-foreground [box-shadow:var(--elevation-floating)] backdrop-blur-sm transition-colors hover:text-foreground"
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
          if (files) void importFiles(Array.from(files));
          e.target.value = "";
        }}
      />

      <EditorHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <EditorCommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onOpenHelp={() => setHelpOpen(true)}
        onLoadSample={loadSample}
        onExport={handleExport}
      />
    </div>
  );
}
