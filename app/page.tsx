"use client";

import React, { useCallback, useMemo } from "react";
import { Play, Zap, RotateCw, ArrowLeftRight, HelpCircle, Download } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { toast } from "sonner";
import { useEditorStore } from "@/lib/store/editorStore";
import { parsePath } from "@/lib/shapeshifter/pathUtils";
import {
  downloadAnimatedSVG,
  downloadCSSKeyframes,
  downloadLottie,
  exportAnimatedVectorDrawable,
  exportProjectJSON,
  exportSvgSpritesheet,
  exportVectorDrawable,
} from "@/lib/shapeshifter/exporter";
import { flattenOriginalProject, isOriginalShapeShifterProject } from "@/lib/shapeshifter/project";
import { importLayersFromSvg, importLayersFromVectorDrawable } from "@/lib/shapeshifter/importers";
import type { Layer } from "@/lib/shapeshifter/types";
import { Toolbar } from "@/components/editor/Toolbar";
import { CanvasArea } from "@/components/editor/CanvasArea";
import { Inspector } from "@/components/editor/Inspector";
import { MaterialSymbol } from "@/components/editor/MaterialSymbol";
import { LayerTimeline } from "@/components/editor/LayerTimeline";

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

export default function ShapeShifter2026() {
  // Keyboard shortcuts for 2026 power user experience
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const store = useEditorStore.getState();

      // Undo / Redo
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          if (store.canRedo) {
            store.redo();
            toast.success("Redo");
          }
        } else {
          if (store.canUndo) {
            store.undo();
            toast.success("Undo");
          }
        }
        return;
      }

      // Playback
      if (e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        store.togglePlayback();
        return;
      }

      // Magic tools - very intuitive single keys
      if (e.key.toLowerCase() === "a" && !e.metaKey) {
        e.preventDefault();
        store.autoFixSelectedLayer();
        toast.success("Auto Fix applied");
        return;
      }
      if (e.key.toLowerCase() === "r" && !e.metaKey) {
        e.preventDefault();
        store.reverseSelectedLayer();
        toast.success("Path reversed");
        return;
      }

      if (e.key.toLowerCase() === "s" && !e.metaKey) {
        e.preventDefault();
        store.shiftSelectedLayer(1);
        toast.success("Points shifted");
        return;
      }

      // Delete
      if (e.key === "Delete" || e.key === "Backspace") {
        if (store.selection) {
          store.deleteSelectedPoint();
          toast.success("Point deleted");
        }
        return;
      }

      // Clear selection
      if (e.key === "Escape") {
        store.clearSelection?.();
        return;
      }

      // Nudge selected point with arrows (very useful)
      if (store.selection && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        const point = store.getCurrentSelectedPoint();
        if (!point) return;
        const step = e.shiftKey ? 5 : 0.5;
        let dx = 0;
        let dy = 0;
        if (e.key === "ArrowUp") dy = -step;
        if (e.key === "ArrowDown") dy = step;
        if (e.key === "ArrowLeft") dx = -step;
        if (e.key === "ArrowRight") dx = step;
        store.updateSelectedPoint({ x: point.x + dx, y: point.y + dy });
      }

      // Quick side switching
      if (e.key === "1") {
        store.setEditingSide("from");
      }
      if (e.key === "2") {
        store.setEditingSide("to");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  React.useEffect(() => {
    let frameId = 0;
    let previousTime = performance.now();

    const tick = (time: number) => {
      const store = useEditorStore.getState();
      if (!store.isPlaying) {
        previousTime = time;
        frameId = requestAnimationFrame(tick);
        return;
      }

      const elapsed = time - previousTime;
      previousTime = time;
      const duration = Math.max(1, store.animation.duration);
      const speed = store.isSlowMotion ? 0.25 : store.speed;
      const nextProgress = store.progress + (elapsed * speed) / duration;

      if (nextProgress >= 1) {
        if (store.isRepeating) {
          store.setProgress(nextProgress % 1);
        } else {
          store.setProgress(1);
          store.togglePlayback();
        }
      } else {
        store.setProgress(nextProgress);
      }

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, []);

  // Everything comes from the store (single source of truth)
  const {
    layers,
    selectedLayerId,
    editingSide,
    isPlaying,
    isActionMode,
    setEditingSide,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useEditorStore();

  const currentLayer = useMemo(
    () => layers.find((l) => l.id === selectedLayerId) || layers[0],
    [layers, selectedLayerId],
  );

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
        toast.success(`Imported ${importedLayers.length} layer(s) from ${file.name.endsWith(".xml") ? "Vector Drawable" : "SVG"}`);
      } catch (error) {
        toast.error("Failed to parse file", { description: String(error) });
      }
    };
    reader.readAsText(file);
  };

  const openSVGImport = useCallback(() => fileInputRef.current?.click(), []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && /\.(svg|xml|json|shapeshifter)$/i.test(file.name)) {
      handleImportFile(file);
    } else {
      toast.error("Please drop an SVG, Vector Drawable XML, or project file");
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
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
    const toPath = layer.to;
    const name = layer.name.replace(/\s+/g, "_");

    try {
      if (type === "svg" || type === "animated") {
        downloadAnimatedSVG(fromPath, toPath, name);
        toast.success("Animated SVG exported");
      } else if (type === "css") {
        downloadCSSKeyframes(fromPath, toPath, name);
        toast.success("CSS Keyframes exported");
      } else if (type === "lottie") {
        downloadLottie(fromPath, toPath, name);
        toast.success("Lottie exported");
      } else if (type === "vector" || type === "avd" || type === "spritesheet") {
        const content =
          type === "vector"
            ? exportVectorDrawable(layer)
            : type === "avd"
              ? exportAnimatedVectorDrawable(layer)
              : exportSvgSpritesheet(layer);
        const blob = new Blob([content], { type: type === "spritesheet" ? "image/svg+xml" : "application/xml" });
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
          exportProjectJSON(state.layers, state.vector, state.animation, state.hiddenLayerIds),
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
      } else {
        toast.info(`Export type "${type}" coming soon`);
      }
    } catch (e) {
      toast.error("Export failed", { description: String(e) });
    }
  };

  const loadSample = (index: number) => {
    const { loadSample: storeLoadSample } = useEditorStore.getState();
    storeLoadSample(index);
    toast.success("Sample loaded", { description: "Paths updated with beautiful morph preset" });
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
    <div className="flex h-dvh flex-col bg-background text-foreground" onDrop={handleDrop} onDragOver={handleDragOver}>
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

      <div className="flex min-h-0 flex-1 overflow-hidden bg-muted">
        <main className="flex min-w-0 flex-1">
          <CanvasArea
            resetFrom={resetFrom}
            resetPreview={resetPreview}
            resetTo={resetTo}
            resetAllViews={resetAllViews}
          />
        </main>

        {!isActionMode && (
          <aside className="flex w-80 shrink-0 flex-col border-l bg-sidebar shadow-sm">
            <div className="flex min-h-16 items-center gap-3 border-b bg-card px-4 py-3">
              <MaterialSymbol name="polyline" size={30} className="shrink-0 text-muted-foreground" />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[17px] font-semibold leading-6">{currentLayer?.name ?? "No layer"}</span>
                <span className="text-[13px] leading-5 text-muted-foreground">{editingSide.toUpperCase()} path</span>
              </div>
            </div>
            <Inspector />
          </aside>
        )}
      </div>

      <LayerTimeline onOpenSVGImport={openSVGImport} onExport={handleExport} onLoadSample={loadSample} />

      <input
        type="file"
        ref={fileInputRef}
        accept=".svg,.xml,.json,.shapeshifter"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleImportFile(f);
          e.target.value = "";
        }}
      />

      {/* Help / Shortcuts Modal */}
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Keyboard Shortcuts</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm py-4">
            <div className="font-mono">Space</div>
            <div>Play / Pause</div>
            <div className="font-mono">A</div>
            <div>Auto Fix</div>
            <div className="font-mono">R</div>
            <div>Reverse</div>
            <div className="font-mono">S</div>
            <div>Shift Points</div>
            <div className="font-mono">⌘Z / ⌘⇧Z</div>
            <div>Undo / Redo</div>
            <div className="font-mono">Arrows</div>
            <div>Nudge point</div>
            <div className="font-mono">1 / 2</div>
            <div>Switch From / To</div>
            <div className="font-mono">⌘K</div>
            <div>Command Palette</div>
            <div className="font-mono">Esc</div>
            <div>Clear selection</div>
            <div className="font-mono">Delete</div>
            <div>Remove point</div>
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            Pro tip: Use Auto Fix when the compatibility warning appears.
          </div>
        </DialogContent>
      </Dialog>

      {/* Command Palette - 2026 delight */}
      <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
        <CommandInput placeholder="Type a command or search..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
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
              <Play className="mr-2 h-4 w-4" /> Toggle Playback (Space)
            </CommandItem>
            <CommandItem
              onSelect={() =>
                runCommand(() => {
                  const { autoFixSelectedLayer } = useEditorStore.getState();
                  autoFixSelectedLayer();
                })
              }
            >
              <Zap className="mr-2 h-4 w-4" /> Auto Fix (A)
            </CommandItem>
            <CommandItem
              onSelect={() =>
                runCommand(() => {
                  const { reverseSelectedLayer } = useEditorStore.getState();
                  reverseSelectedLayer();
                })
              }
            >
              <RotateCw className="mr-2 h-4 w-4" /> Reverse (R)
            </CommandItem>
            <CommandItem
              onSelect={() =>
                runCommand(() => {
                  const { shiftSelectedLayer } = useEditorStore.getState();
                  shiftSelectedLayer(1);
                })
              }
            >
              <ArrowLeftRight className="mr-2 h-4 w-4" /> Shift Points
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => loadSample(2))}>
              <MaterialSymbol name="favorite" size={16} className="mr-2" /> Load Heart → Star
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Export">
            <CommandItem onSelect={() => runCommand(() => handleExport("svg"))}>
              <Download className="mr-2 h-4 w-4" /> Export Animated SVG
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => handleExport("css"))}>
              <Download className="mr-2 h-4 w-4" /> Export CSS Keyframes
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </div>
  );
}
