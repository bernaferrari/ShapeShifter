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
      ["L", "Lasso"],
      ["B", "Paint / Fill"],
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
}

export function EditorCommandPalette({
  open,
  onOpenChange,
  onOpenHelp,
  onLoadSample,
  onExport,
}: EditorCommandPaletteProps) {
  const run = (action: () => void) => {
    action();
    onOpenChange(false);
  };
  const setTool = (tool: "select" | "pen" | "direct" | "pencil" | "paint", message: string) =>
    run(() => {
      useEditorStore.getState().setToolMode(tool);
      toast.success(message);
    });

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Tools">
          <CommandItem onSelect={() => setTool("select", "Move / Select tool")}>
            <MousePointer2 className="mr-2 size-4" /> Move / Select
            <CommandShortcut>V</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => setTool("pen", "Pen tool selected")}>
            <PenTool className="mr-2 size-4" /> Pen
            <CommandShortcut>P</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => setTool("direct", "Direct tool selected")}>
            <Waypoints className="mr-2 size-4" /> Direct / Bend
            <CommandShortcut>D</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => setTool("pencil", "Lasso tool selected")}>
            <Lasso className="mr-2 size-4" /> Lasso
            <CommandShortcut>L</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => setTool("paint", "Paint tool selected")}>
            <PaintBucket className="mr-2 size-4" /> Paint / Fill
            <CommandShortcut>B</CommandShortcut>
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
            <Play className="mr-2 size-4" /> Toggle playback
            <CommandShortcut>Space</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(() => useEditorStore.getState().autoFixSelectedLayer())}>
            <Zap className="mr-2 size-4" /> Auto Fix
            <CommandShortcut>⇧F</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(() => useEditorStore.getState().reverseSelectedLayer())}>
            <RotateCw className="mr-2 size-4" /> Reverse path
            <CommandShortcut>⇧R</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(() => useEditorStore.getState().shiftSelectedLayer(1))}>
            <ArrowLeftRight className="mr-2 size-4" /> Shift points
            <CommandShortcut>⇧S</CommandShortcut>
          </CommandItem>
          <CommandItem disabled>Union selected layers (unavailable)</CommandItem>
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
        <CommandGroup heading="Recent">
          {DEMO_INFOS.slice(0, 4).map((demo, index) => (
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
