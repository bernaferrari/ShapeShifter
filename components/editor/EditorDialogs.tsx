"use client";

import {
  ArrowLeftRight,
  Download,
  HelpCircle,
  Lasso,
  MousePointer2,
  PaintBucket,
  PenTool,
  Play,
  RotateCw,
  Waypoints,
  Zap,
  Scissors,
  Undo2,
  Redo2,
  Upload,
  Maximize,
  PanelLeft,
  PanelRight,
  PanelBottom,
  FolderPlus,
} from "lucide-react";
import { toast } from "sonner";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DEMO_INFOS } from "@/lib/shapeshifter/demoProjects";
import { useEditorStore } from "@/lib/store/editorStore";
import type { EditorExportType } from "./project/useProjectExport";

const SHORTCUT_SECTIONS = [
  {
    title: "Playback & Timeline",
    rows: [
      ["Space", "Tap play · hold and drag to pan"],
      ["H", "Hand / pan"],
      ["Timeline blocks", "Drag to move · resize either edge"],
    ],
  },
  {
    title: "Tools",
    rows: [
      ["V", "Move / Select"],
      ["A / D", "Vector / Direct"],
      ["P", "Pen"],
      ["R / O", "Rectangle / Ellipse"],
      ["L", "Lasso"],
      ["B", "Paint / Fill"],
      ["K", "Add point"],
    ],
  },
  {
    title: "Editing",
    rows: [
      ["⇧F", "Auto-fix morph"],
      ["⇧R", "Reverse path"],
      ["⇧S", "Shift points"],
      ["⌘G / ⇧⌘G", "Group / Ungroup"],
      ["X", "Split command"],
      ["Delete / ⌫", "Remove selected points"],
      ["Arrows (+Shift)", "Nudge fine / coarse"],
      ["⌘D / Ctrl+D", "Duplicate selected layers"],
    ],
  },
  {
    title: "Navigation & Power",
    rows: [
      ["⌘K", "Command palette"],
      ["⌘Z / ⌘⇧Z", "Undo / Redo"],
      ["1 / 2", "Start / End path"],
      ["⇧1 / ⇧2", "Fit all / Fit selection"],
      ["Esc / Enter", "Clear selection / finish pen path"],
      ["⌘W", "Close Action Mode"],
      ["Alt + timeline drag", "Adjust timing in milliseconds"],
      ["Layer arrows / F2", "Navigate layers / Rename"],
    ],
  },
] as const;

export function EditorHelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2 text-sm">
          {SHORTCUT_SECTIONS.map((section) => (
            <section key={section.title} aria-labelledby={`shortcut-${section.title}`}>
              <h3
                id={`shortcut-${section.title}`}
                className="mb-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground"
              >
                {section.title}
              </h3>
              <dl className="space-y-1">
                {section.rows.map(([keys, description]) => (
                  <div key={keys} className="flex items-center justify-between gap-4">
                    <dt>
                      <kbd className="rounded bg-muted px-1.5 py-px font-mono text-xs">{keys}</kbd>
                    </dt>
                    <dd className="text-right text-muted-foreground">{description}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const EXPORT_COMMANDS: ReadonlyArray<[EditorExportType, string]> = [
  ["svg", "Export animated SVG"],
  ["static", "Export static SVG"],
  ["css", "Export CSS keyframes"],
  ["json", "Export project JSON"],
  ["lottie", "Export Lottie JSON"],
  ["vector", "Export Vector Drawable"],
  ["avd", "Export Animated Vector Drawable"],
  ["spritesheet", "Export SVG spritesheet"],
  ["pdf", "Export vector PDF"],
];

interface EditorCommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenHelp: () => void;
  onLoadSample: (index: number) => void;
  onExport: (type: EditorExportType) => void;
  onOpenImport: () => void;
  onToggleLayers: () => void;
  onToggleInspector: () => void;
  onToggleTimeline: () => void;
  onResetViews: () => void;
}

export function EditorCommandPalette({
  open,
  onOpenChange,
  onOpenHelp,
  onLoadSample,
  onExport,
  onOpenImport,
  onToggleLayers,
  onToggleInspector,
  onToggleTimeline,
  onResetViews,
}: EditorCommandPaletteProps) {
  const canUndo = useEditorStore((state) => state.canUndo);
  const canRedo = useEditorStore((state) => state.canRedo);
  const hasSelection = useEditorStore(
    (state) => state.selectionKind === "layer" && state.hasCanvasSelection,
  );
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const run = (action: () => void) => {
    action();
    onOpenChange(false);
  };
  const setTool = (tool: "select" | "pen" | "direct" | "pencil" | "paint" | "knife") =>
    run(() => useEditorStore.getState().setToolMode(tool));

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Tools">
          <CommandItem onSelect={() => setTool("select")}>
            <MousePointer2 className="mr-2 size-4" /> Move / Select
            <CommandShortcut>V</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => setTool("pen")}>
            <PenTool className="mr-2 size-4" /> Pen
            <CommandShortcut>P</CommandShortcut>
          </CommandItem>
          <CommandItem
            keywords={["direct", "anchor", "bezier", "points"]}
            onSelect={() => setTool("direct")}
          >
            <Waypoints className="mr-2 size-4" /> Vector / Edit points
            <CommandShortcut>A</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => setTool("pencil")}>
            <Lasso className="mr-2 size-4" /> Lasso
            <CommandShortcut>L</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => setTool("paint")}>
            <PaintBucket className="mr-2 size-4" /> Paint / Fill
            <CommandShortcut>B</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => setTool("knife")}>
            <Scissors className="mr-2 size-4" /> Add point
            <CommandShortcut>K</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Document">
          <CommandItem onSelect={() => run(onOpenImport)}>
            <Upload className="mr-2 size-4" /> Import SVG, XML, or project…
          </CommandItem>
          <CommandItem
            disabled={!canUndo}
            onSelect={() => run(() => useEditorStore.getState().undo())}
          >
            <Undo2 className="mr-2 size-4" /> Undo<CommandShortcut>⌘Z</CommandShortcut>
          </CommandItem>
          <CommandItem
            disabled={!canRedo}
            onSelect={() => run(() => useEditorStore.getState().redo())}
          >
            <Redo2 className="mr-2 size-4" /> Redo<CommandShortcut>⇧⌘Z</CommandShortcut>
          </CommandItem>
          <CommandItem
            disabled={!hasSelection}
            onSelect={() =>
              run(() => {
                const store = useEditorStore.getState();
                store.copyLayers(
                  store.selectedLayerIds.length ? store.selectedLayerIds : [store.selectedLayerId],
                );
                store.pasteLayers();
              })
            }
          >
            Duplicate selected layers<CommandShortcut>⌘D</CommandShortcut>
          </CommandItem>
          <CommandItem
            disabled={!hasSelection}
            onSelect={() => run(() => useEditorStore.getState().groupSelectedLayers())}
          >
            <FolderPlus className="mr-2 size-4" /> Group selected layers
            <CommandShortcut>⌘G</CommandShortcut>
          </CommandItem>
          <CommandItem
            disabled={!hasSelection}
            onSelect={() => run(() => useEditorStore.getState().ungroupSelectedLayer())}
          >
            Ungroup selected layer<CommandShortcut>⇧⌘G</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Actions">
          <CommandItem
            onSelect={() => {
              onOpenChange(false);
              onOpenHelp();
            }}
          >
            <HelpCircle className="mr-2 size-4" /> Show keyboard shortcuts
          </CommandItem>
          <CommandItem onSelect={() => run(() => useEditorStore.getState().togglePlayback())}>
            <Play className="mr-2 size-4" /> {isPlaying ? "Pause animation" : "Play animation"}
            <CommandShortcut>Space</CommandShortcut>
          </CommandItem>
          <CommandItem
            disabled={!hasSelection}
            onSelect={() =>
              run(() => {
                const store = useEditorStore.getState();
                if (store.previewPrepareForMorph())
                  toast.message("Review the morph in the inspector, then Apply or Cancel");
                else if (store.autoFixSelectedLayer()) toast.success("Paths made compatible");
              })
            }
          >
            <Zap className="mr-2 size-4" /> Prepare paths for morph
            <CommandShortcut>⇧F</CommandShortcut>
          </CommandItem>
          <CommandItem
            disabled={!hasSelection}
            onSelect={() => run(() => useEditorStore.getState().reverseSelectedLayer())}
          >
            <RotateCw className="mr-2 size-4" /> Reverse path
            <CommandShortcut>⇧R</CommandShortcut>
          </CommandItem>
          <CommandItem
            disabled={!hasSelection}
            onSelect={() => run(() => useEditorStore.getState().shiftSelectedLayer(1))}
          >
            <ArrowLeftRight className="mr-2 size-4" /> Shift points
            <CommandShortcut>⇧S</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() =>
              run(() => {
                useEditorStore.getState().addLayer("path");
                toast.success("Path layer added");
              })
            }
          >
            Add path layer
          </CommandItem>
          <CommandItem onSelect={() => run(() => useEditorStore.getState().toggleSlowMotion())}>
            Toggle slow motion
          </CommandItem>
          <CommandItem onSelect={() => run(() => useEditorStore.getState().toggleRepeating())}>
            Toggle repeat playback
          </CommandItem>
          <CommandItem onSelect={() => run(() => useEditorStore.getState().setProgress(0))}>
            Reset playback head
          </CommandItem>
          <CommandItem onSelect={() => run(() => useEditorStore.getState().clearBlockSelection())}>
            Clear timeline block selection
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="View">
          <CommandItem onSelect={() => run(() => useEditorStore.getState().fitWorldToFrames())}>
            <Maximize className="mr-2 size-4" /> Fit all frames<CommandShortcut>⇧1</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(onResetViews)}>Reset canvas views</CommandItem>
          <CommandItem onSelect={() => run(onToggleLayers)}>
            <PanelLeft className="mr-2 size-4" /> Toggle layers panel
          </CommandItem>
          <CommandItem onSelect={() => run(onToggleInspector)}>
            <PanelRight className="mr-2 size-4" /> Toggle inspector
          </CommandItem>
          <CommandItem onSelect={() => run(onToggleTimeline)}>
            <PanelBottom className="mr-2 size-4" /> Toggle timeline
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Samples">
          {DEMO_INFOS.map((demo, index) => (
            <CommandItem key={demo.id} onSelect={() => run(() => onLoadSample(index))}>
              {demo.title}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Export">
          {EXPORT_COMMANDS.map(([type, label]) => (
            <CommandItem key={type} onSelect={() => run(() => onExport(type))}>
              <Download className="mr-2 size-4" /> {label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
