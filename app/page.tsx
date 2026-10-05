"use client";

import React from "react";
import { PanelRightOpen, PanelLeftOpen, PanelBottomOpen, CloudUpload } from "lucide-react";
import { toast } from "sonner";
import { useEditorStore } from "@/lib/store/editorStore";
import { DEMO_INFOS } from "@/lib/shapeshifter/demoProjects";
import { Toolbar, type EditorPanelVisibility } from "@/components/editor/Toolbar";
import { CanvasArea } from "@/components/editor/CanvasArea";
import { Inspector } from "@/components/editor/Inspector";
import { LayerTimeline } from "@/components/editor/LayerTimeline";
import { LayersPanel } from "@/components/editor/LayersPanel";
import { BottomToolPalette } from "@/components/editor/BottomToolPalette";
import { Onboarding } from "@/components/editor/Onboarding";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import {
  isEditorShortcutBlocked,
  useEditorKeyboardShortcuts,
} from "@/components/editor/hooks/useEditorKeyboardShortcuts";
import { usePlayheadPathEditing } from "@/components/editor/hooks/usePlayheadPathEditing";
import { useEditorPlayback } from "@/components/editor/hooks/useEditorPlayback";
import { useDocumentAutosave } from "@/components/editor/hooks/useDocumentAutosave";
import { useProjectImport } from "@/components/editor/project/useProjectImport";
import { useProjectExport } from "@/components/editor/project/useProjectExport";
import { EditorCommandPalette, EditorHelpDialog } from "@/components/editor/EditorDialogs";
import { EditorContextMenu } from "@/components/editor/EditorContextMenu";
import { AgentToolsDialog } from "@/components/editor/AgentToolsDialog";
import { RecoveryHistoryDialog } from "@/components/editor/RecoveryHistoryDialog";
import { MobileWorkspace, type MobileSheet } from "@/components/editor/MobileWorkspace";
import { useCompactLayout } from "@/components/editor/hooks/useCompactLayout";
import { registerEditorAgentTools } from "@/lib/agent/browserTools";

// Below this viewport width the fixed w-80 inspector + timeline get cramped, so
// the inspector auto-collapses into a toggle (Figma-style responsive degrade).
const NARROW_BREAKPOINT = 1100;

export default function ShapeShifter2026() {
  useEditorKeyboardShortcuts();
  usePlayheadPathEditing();
  const autosave = useDocumentAutosave();
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

  const resetAllViews = () => useEditorStore.getState().fitWorldToFrames();

  // === COMMAND PALETTE STATE (moved inside for correctness) ===
  const [commandOpen, setCommandOpen] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [agentOpen, setAgentOpen] = React.useState(false);
  const [recoveryOpen, setRecoveryOpen] = React.useState(false);
  React.useEffect(() => registerEditorAgentTools(document, navigator), []);

  // === PANEL COLLAPSE / RESPONSIVE STATE ===
  // User intent (persisted). The actual inspector visibility also folds in the
  // narrow-viewport auto-collapse below, but we never overwrite the user's choice.
  const [inspectorCollapsed, setInspectorCollapsed] = React.useState(false);
  const [layersCollapsed, setLayersCollapsed] = React.useState(false);
  const [rulersVisible, setRulersVisible] = React.useState(false);
  const [isNarrow, setIsNarrow] = React.useState(false);
  const [narrowPanel, setNarrowPanel] = React.useState<"layers" | "inspector" | null>(null);
  const compact = useCompactLayout();
  const [mobileSheet, setMobileSheet] = React.useState<MobileSheet | null>(null);

  React.useEffect(() => {
    try {
      setInspectorCollapsed(localStorage.getItem("shapeshifter:panel:inspector") === "1");
      setLayersCollapsed(localStorage.getItem("shapeshifter:panel:layers") === "1");
      setRulersVisible(localStorage.getItem("shapeshifter:view:rulers") === "1");
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

  const toggleRulers = React.useCallback(() => {
    setRulersVisible((previous) => {
      const next = !previous;
      try {
        localStorage.setItem("shapeshifter:view:rulers", next ? "1" : "0");
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
  // The properties panel always stays docked; narrow windows fold the layers panel instead.
  const inspectorHidden = inspectorCollapsed;
  const layersHidden = isNarrow ? narrowPanel !== "layers" : layersCollapsed;

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditorShortcutBlocked(e)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen((open) => !open);
      } else if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setHelpOpen(true);
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

  const toggleLayersPanel = () =>
    isNarrow ? setNarrowPanel((panel) => (panel === "layers" ? null : "layers")) : toggleLayers();
  const toggleInspectorPanel = toggleInspector;
  const panels: EditorPanelVisibility = {
    layers: !layersHidden,
    inspector: !inspectorHidden,
    timeline: !timelineCollapsed,
    rulers: rulersVisible,
  };
  const togglePanel = (panel: keyof EditorPanelVisibility) => {
    if (panel === "layers") toggleLayersPanel();
    else if (panel === "inspector") toggleInspectorPanel();
    else if (panel === "timeline") toggleTimeline();
    else toggleRulers();
  };

  const canvas = (
    <EditorContextMenu
      render={
        <main
          id="editor-canvas"
          tabIndex={-1}
          aria-label="Editor canvas"
          className="relative flex min-w-0 flex-1 overflow-hidden"
        />
      }
    >
      <CanvasArea
        resetAllViews={resetAllViews}
        showRulers={rulersVisible}
        onToggleRulers={toggleRulers}
      />
      <div className="pointer-events-none absolute bottom-3 left-1/2 z-30 -translate-x-1/2">
        <div className="pointer-events-auto" onContextMenu={(event) => event.stopPropagation()}>
          <BottomToolPalette />
        </div>
      </div>
      <Onboarding />
      {timelineCollapsed && !compact && (
        <button
          type="button"
          onClick={toggleTimeline}
          aria-label="Show timeline"
          aria-expanded={false}
          className="absolute bottom-3 left-3 z-30 flex h-8 items-center gap-1.5 rounded-lg bg-card px-2.5 text-[12px] text-muted-foreground [box-shadow:var(--elevation-floating)] transition-colors hover:text-foreground"
        >
          <PanelBottomOpen className="size-3.5" />
          Timeline
        </button>
      )}
    </EditorContextMenu>
  );

  // Playback + animation state flows from Zustand

  return (
    <div className="relative flex h-dvh flex-col bg-background text-foreground" {...dragHandlers}>
      <a
        href="#editor-canvas"
        className="sr-only z-50 rounded-md bg-card px-4 py-2 focus:not-sr-only focus:absolute focus:left-2 focus:top-2"
      >
        Skip to canvas
      </a>
      {/* File Drag-and-Drop Overlay — pro Figma drop target polish (dashed target + refined elevation) */}
      {isDraggingFile && (
        <div className="pointer-events-none absolute inset-0 z-50 p-2 animate-in fade-in duration-150">
          <div className="flex h-full w-full items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-primary/[0.06] backdrop-blur-[1px]">
            <div className="flex items-center gap-3 rounded-xl bg-card px-4 py-3 [box-shadow:var(--elevation-floating)]">
              <div className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
                <CloudUpload className="size-5" />
              </div>
              <div>
                <div className="text-[13px] font-semibold">Drop to import</div>
                <div className="text-[12px] text-muted-foreground">
                  SVG, Vector Drawable XML, or ShapeShifter project
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <Toolbar
        onExport={handleExport}
        onLoadSample={loadSample}
        onTogglePlay={togglePlay}
        onOpenSVGImport={openSVGImport}
        onShowHelp={() => setHelpOpen(true)}
        onOpenCommand={() => setCommandOpen(true)}
        onOpenAgentTools={() => setAgentOpen(true)}
        onOpenRecovery={() => setRecoveryOpen(true)}
        onTogglePanel={togglePanel}
        panels={panels}
        autosave={autosave}
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

      {compact ? (
        <MobileWorkspace canvas={canvas} sheet={mobileSheet} onSheetChange={setMobileSheet} />
      ) : (
        <>
          {/* Figma Motion model: the timeline is a document-wide bottom workspace,
          not a canvas-only panel trapped between the sidebars. */}
          <div className="relative min-h-0 flex-1 overflow-hidden bg-muted">
            <ResizablePanelGroup orientation="vertical" className="min-h-0">
              <ResizablePanel
                id="workspace"
                minSize="54%"
                defaultSize={timelineCollapsed ? "100%" : "72%"}
              >
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
                  {canvas}

                  {!inspectorHidden && (
                    <aside
                      aria-label="Properties"
                      className={cn(
                        "flex h-full w-64 shrink-0 flex-col overflow-hidden border-l bg-sidebar",
                      )}
                    >
                      <Inspector />
                    </aside>
                  )}

                  {layersHidden && (
                    <button
                      type="button"
                      onClick={toggleLayersPanel}
                      aria-label="Show layers"
                      title="Show layers"
                      className="absolute left-2 top-2 z-30 grid size-8 place-items-center rounded-lg bg-card text-muted-foreground [box-shadow:var(--elevation-floating)] transition-colors hover:text-foreground"
                    >
                      <PanelLeftOpen className="size-4" />
                    </button>
                  )}

                  {inspectorHidden && (
                    <button
                      type="button"
                      onClick={toggleInspectorPanel}
                      aria-label="Show inspector"
                      title="Show properties"
                      aria-expanded={false}
                      className="absolute right-2 top-2 z-30 grid size-8 place-items-center rounded-lg bg-card text-muted-foreground [box-shadow:var(--elevation-floating)] transition-colors hover:text-foreground"
                    >
                      <PanelRightOpen className="size-4" />
                    </button>
                  )}
                </div>
              </ResizablePanel>

              {!timelineCollapsed && (
                <>
                  <ResizableHandle className="bg-border/80" />
                  <ResizablePanel id="timeline" minSize="16%" defaultSize="28%">
                    <LayerTimeline onCollapse={toggleTimeline} />
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </div>
        </>
      )}

      <input
        type="file"
        ref={fileInputRef}
        accept=".svg,.xml,.json,.shapeshifter,.zip"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files;
          if (files) void importFiles(Array.from(files));
          e.target.value = "";
        }}
      />

      <EditorHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <AgentToolsDialog open={agentOpen} onOpenChange={setAgentOpen} />
      <RecoveryHistoryDialog
        open={recoveryOpen}
        onOpenChange={setRecoveryOpen}
        onRestore={autosave.restoreCheckpoint}
      />
      <EditorCommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onOpenHelp={() => setHelpOpen(true)}
        onLoadSample={loadSample}
        onExport={handleExport}
        onOpenImport={openSVGImport}
        onToggleLayers={toggleLayersPanel}
        onToggleInspector={toggleInspectorPanel}
        onToggleTimeline={toggleTimeline}
        onToggleRulers={toggleRulers}
        onResetViews={resetAllViews}
      />
    </div>
  );
}
