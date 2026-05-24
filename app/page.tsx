"use client";

import React, { useCallback, useMemo } from "react";
import { Play, Plus, Trash2, Eye, EyeOff, Zap, RotateCw, ArrowLeftRight, HelpCircle, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { toast } from "sonner";
import { useEditorStore } from "@/lib/store/editorStore";
import { parsePath, pathToString } from "@/lib/shapeshifter/pathUtils";
import { downloadAnimatedSVG, downloadCSSKeyframes, downloadLottie } from "@/lib/shapeshifter/exporter";
import { Toolbar } from "@/components/editor/Toolbar";
import { CanvasArea } from "@/components/editor/CanvasArea";
import { Inspector } from "@/components/editor/Inspector";
import { MaterialSymbol } from "@/components/editor/MaterialSymbol";

export default function ShapeShifter2026() {
  // Keyboard shortcuts for 2026 power user experience
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
        let dx = 0,
          dy = 0;
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

  // Everything comes from the store (single source of truth)
  const {
    layers,
    selectedLayerId,
    editingSide,
    isPlaying,
    setEditingSide,
    deleteLayer,
    toggleLayerVisibility,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useEditorStore();

  const currentLayer = useMemo(
    () => layers.find((l) => l.id === selectedLayerId) || layers[0],
    [layers, selectedLayerId],
  );

  // Hidden file input for modern SVG import
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleSVGFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      try {
        const ds: string[] = [];
        const regex = /d=["']([^"']+)["']/g;
        let m;
        while ((m = regex.exec(text)) !== null) ds.push(m[1]);
        if (ds.length === 0) {
          toast.error("No path data found in file");
          return;
        }
        const state = useEditorStore.getState();
        const idx = state.layers.findIndex((l) => l.id === state.selectedLayerId);
        if (idx < 0) return;
        const nl = [...state.layers];
        const lay = { ...nl[idx] };
        if (ds[0]) lay.from = parsePath(ds[0]);
        if (ds[1]) lay.to = parsePath(ds[1]);
        nl[idx] = lay;
        useEditorStore.setState({ layers: nl });
        toast.success(`Imported ${ds.length} path(s) from file`);
      } catch (error) {
        toast.error("Failed to parse SVG file", { description: String(error) });
      }
    };
    reader.readAsText(file);
  };

  const openSVGImport = useCallback(() => fileInputRef.current?.click(), []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith(".svg")) {
      handleSVGFile(file);
    } else {
      toast.error("Please drop an .svg file");
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
        toast.success("Lottie exported (high quality)");
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
    <div className="editor-app" onDrop={handleDrop} onDragOver={handleDragOver}>
      {/* === BEAUTIFUL 2026 TOOLBAR === */}
      <Toolbar
        onExport={handleExport}
        onLoadSample={loadSample}
        onTogglePlay={togglePlay}
        onResetAnim={resetAnim}
        onOpenSVGImport={openSVGImport}
        onShowHelp={() => setHelpOpen(true)}
        resetAllViews={resetAllViews}
        isPlaying={isPlaying}
        editingSide={editingSide}
        setEditingSide={setEditingSide}
        undo={undo}
        redo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
      />

      {/* === MAIN RESIZABLE EDITOR === */}
      <div className="editor-main">
        <ResizablePanelGroup orientation="horizontal" className="flex-1">
          {/* LEFT: LAYERS + TIMELINE (future split) */}
          <ResizablePanel defaultSize={22} minSize={18} className="side-panel layer-panel">
            <div className="p-3 border-b border-border flex items-center justify-between">
              <div className="font-semibold text-sm tracking-tight flex items-center gap-2">
                <MaterialSymbol name="layers" size={18} /> Layers
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  useEditorStore.getState().addLayer();
                }}
                className="h-7 w-7"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>

            <div className="scroll-area p-2 space-y-1 flex-1">
              {layers.map((layer, idx) => (
                <div
                  key={layer.id}
                  onClick={() => {
                    useEditorStore.getState().selectLayer(layer.id);
                  }}
                  className={`layer-item ${selectedLayerId === layer.id ? "selected" : ""}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{layer.name}</div>
                    <div className="text-[10px] text-muted-foreground font-mono truncate">
                      {pathToString(layer.from).slice(0, 22)}…
                    </div>
                  </div>

                  <div className="flex gap-0.5">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleLayerVisibility(layer.id);
                      }}
                    >
                      {layer.visible ? (
                        <Eye className="w-3.5 h-3.5" />
                      ) : (
                        <EyeOff className="w-3.5 h-3.5" />
                      )}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteLayer(layer.id);
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-3 border-t border-border text-[10px] text-muted-foreground">
              {layers.length} layers • Click to select
            </div>
          </ResizablePanel>

          <ResizableHandle />

          {/* CENTER: THE CANVAS — WHERE THE MAGIC HAPPENS */}
          <ResizablePanel defaultSize={56} minSize={35} className="canvas-area">
            <CanvasArea
              resetFrom={resetFrom}
              setResetFrom={setResetFrom}
              resetPreview={resetPreview}
              setResetPreview={setResetPreview}
              resetTo={resetTo}
              setResetTo={setResetTo}
              resetAllViews={resetAllViews}
            />
          </ResizablePanel>

          <ResizableHandle />

          {/* RIGHT: INSPECTOR */}
          <ResizablePanel defaultSize={22} minSize={18} className="side-panel property-panel">
            <div className="p-4 border-b border-border">
              <div className="font-semibold tracking-tight">Inspector</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {currentLayer ? `${currentLayer.name} • ${editingSide.toUpperCase()}` : "No layer"}
              </div>
            </div>
            <Inspector />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Status bar */}
      <div className="status-bar text-xs tracking-tight">
        <div>ShapeShifter 2026 — beautiful path morphing</div>
        <div className="flex-1" />
        <div className="flex gap-4 text-[10px]">
          <span>
            <kbd>Space</kbd> Play • <kbd>A</kbd> AutoFix • <kbd>R</kbd> Reverse • <kbd>S</kbd> Shift
            • <kbd>⌘Z</kbd> Undo
          </span>
          <span>
            Arrows nudge • <kbd>1/2</kbd> sides • Double-click canvas to reset view
          </span>
        </div>
        <div className="text-primary">Linear-inspired • Material Symbols ready</div>
      </div>

      <input
        type="file"
        ref={fileInputRef}
        accept=".svg"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleSVGFile(f);
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
