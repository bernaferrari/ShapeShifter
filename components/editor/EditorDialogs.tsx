"use client";

import {
  ArrowLeftRight,
  Circle,
  Copy,
  Download,
  FolderMinus,
  FolderPlus,
  Frame,
  Gauge,
  Keyboard,
  Lasso,
  Maximize,
  MousePointer2,
  PaintBucket,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Pause,
  PenTool,
  Play,
  Redo2,
  Repeat,
  RotateCw,
  Ruler,
  Scissors,
  SkipBack,
  Sparkles,
  Spline,
  Square,
  Undo2,
  Upload,
  Waypoints,
  Zap,
  type LucideIcon,
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
import { useAnimationExercise } from "./animationExercise";
import { Button } from "@/components/ui/button";
import { KeyCombo } from "@/components/ui/kbd";
import { DEMO_INFOS } from "@/lib/shapeshifter/demoProjects";
import { useEditorStore } from "@/lib/store/editorStore";
import type { EditorExportType } from "./project/useProjectExport";

const SHORTCUT_SECTIONS: ReadonlyArray<{
  title: string;
  rows: ReadonlyArray<readonly [description: string, keys: string]>;
}> = [
  {
    title: "Tools",
    rows: [
      ["Move", "V"],
      ["Edit points", "Enter"],
      ["Pen", "P"],
      ["Rectangle", "R"],
      ["Ellipse", "O"],
      ["Lasso", "L"],
      ["Paint fill", "B"],
      ["Add point", "K"],
      ["Hand", "H"],
    ],
  },
  {
    title: "Playback",
    rows: [
      ["Play / pause", "Space"],
      ["Previous / next frame", ", / ."],
      ["Jump 10 frames", "⇧, / ⇧."],
      ["Precise timing while dragging", "⌥"],
    ],
  },
  {
    title: "Edit",
    rows: [
      ["Undo", "⌘Z"],
      ["Redo", "⇧⌘Z"],
      ["Duplicate", "⌘D"],
      ["Group / ungroup", "⌘G / ⇧⌘G"],
      ["Delete", "⌫"],
      ["Nudge", "← / →"],
      ["Rename layer", "F2"],
    ],
  },
  {
    title: "Paths & morph",
    rows: [
      ["Make morph-compatible", "⇧F"],
      ["Reverse direction", "⇧R"],
      ["Shift start point", "⇧S"],
      ["Split segment", "X"],
      ["Start / end shape", "1 / 2"],
      ["Leave morph editing", "⌘W"],
    ],
  },
  {
    title: "View",
    rows: [
      ["Zoom in / out", "+ / −"],
      ["Zoom to 100%", "0"],
      ["Zoom to fit", "⇧1"],
      ["Zoom to selection", "⇧2"],
    ],
  },
  {
    title: "General",
    rows: [
      ["Quick actions", "⌘K"],
      ["Keyboard shortcuts", "?"],
      ["Clear selection", "Esc"],
    ],
  },
];

export function EditorHelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-[680px]">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>Editor help</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
          <div>
            <p className="text-sm font-medium">Make an icon move</p>
            <p className="text-xs text-muted-foreground">
              An editable exercise from artwork to export.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              useAnimationExercise.getState().start();
              onOpenChange(false);
            }}
          >
            Start exercise
          </Button>
        </div>
        <div className="grid gap-x-10 gap-y-6 px-6 py-5 sm:grid-cols-2">
          {SHORTCUT_SECTIONS.map((section) => (
            <section key={section.title} aria-labelledby={`shortcut-${section.title}`}>
              <h3
                id={`shortcut-${section.title}`}
                className="mb-2 text-[12px] font-semibold text-foreground"
              >
                {section.title}
              </h3>
              <dl className="space-y-1.5">
                {section.rows.map(([description, keys]) => (
                  <div key={description} className="flex items-center justify-between gap-4">
                    <dt className="text-[13px] text-muted-foreground">{description}</dt>
                    <dd>
                      <KeyCombo keys={keys} />
                    </dd>
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
  ["avd", "Export Animated Vector Drawable"],
  ["vector", "Export Vector Drawable"],
  ["svg", "Export morph demo SVG (experimental)"],
  ["static", "Export SVG"],
  ["css", "Export morph demo CSS (experimental)"],
  ["lottie", "Export Lottie"],
  ["pdf", "Export PDF"],
  ["spritesheet", "Export morph sprite sheet (experimental)"],
  ["json", "Save project file"],
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
  onToggleRulers?: () => void;
  onResetViews: () => void;
}

interface PaletteCommand {
  label: string;
  icon?: LucideIcon;
  shortcut?: string;
  keywords?: string[];
  disabled?: boolean;
  /** Commands that open another surface handle closing themselves. */
  keepOpen?: boolean;
  action: () => void;
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
  onToggleRulers,
  onResetViews,
}: EditorCommandPaletteProps) {
  const canUndo = useEditorStore((state) => state.canUndo);
  const canRedo = useEditorStore((state) => state.canRedo);
  const hasSelection = useEditorStore(
    (state) => state.selectionKind === "layer" && state.hasCanvasSelection,
  );
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const store = () => useEditorStore.getState();
  const tool = (mode: Parameters<ReturnType<typeof store>["setToolMode"]>[0]) => () =>
    store().setToolMode(mode);

  const groups: Array<{ heading: string; commands: PaletteCommand[] }> = [
    {
      heading: "Tools",
      commands: [
        { label: "Move", icon: MousePointer2, shortcut: "V", action: tool("select") },
        {
          label: "Edit points",
          icon: Waypoints,
          shortcut: "A",
          keywords: ["direct", "vector", "anchor", "bezier"],
          action: tool("direct"),
        },
        { label: "Pen", icon: PenTool, shortcut: "P", action: tool("pen") },
        { label: "Rectangle", icon: Square, shortcut: "R", action: tool("rectangle") },
        { label: "Ellipse", icon: Circle, shortcut: "O", action: tool("ellipse") },
        { label: "Lasso", icon: Lasso, shortcut: "L", action: tool("pencil") },
        { label: "Paint fill", icon: PaintBucket, shortcut: "B", action: tool("paint") },
        { label: "Add point", icon: Scissors, shortcut: "K", action: tool("knife") },
      ],
    },
    {
      heading: "Edit",
      commands: [
        {
          label: "Undo",
          icon: Undo2,
          shortcut: "⌘Z",
          disabled: !canUndo,
          action: () => store().undo(),
        },
        {
          label: "Redo",
          icon: Redo2,
          shortcut: "⇧⌘Z",
          disabled: !canRedo,
          action: () => store().redo(),
        },
        {
          label: "Duplicate",
          icon: Copy,
          shortcut: "⌘D",
          disabled: !hasSelection,
          action: () => store().duplicateSelectedLayersOffset(2, 2),
        },
        {
          label: "Group selection",
          icon: FolderPlus,
          shortcut: "⌘G",
          disabled: !hasSelection,
          action: () => store().groupSelectedLayers(),
        },
        {
          label: "Ungroup",
          icon: FolderMinus,
          shortcut: "⇧⌘G",
          disabled: !hasSelection,
          action: () => store().ungroupSelectedLayer(),
        },
        { label: "New path layer", icon: Spline, action: () => store().addLayer("path") },
        { label: "New frame", icon: Frame, action: () => store().addFrame() },
      ],
    },
    {
      heading: "Path & morph",
      commands: [
        {
          label: "Make morph-compatible",
          icon: Zap,
          shortcut: "⇧F",
          keywords: ["prepare", "auto fix", "match"],
          disabled: !hasSelection,
          action: () => {
            if (store().previewPrepareForMorph())
              toast.message("Review the morph in the properties panel, then Apply or Cancel");
            else if (store().autoFixSelectedLayer()) toast.success("Paths made compatible");
          },
        },
        {
          label: "Reverse direction",
          icon: RotateCw,
          shortcut: "⇧R",
          disabled: !hasSelection,
          action: () => store().reverseSelectedLayer(),
        },
        {
          label: "Shift start point",
          icon: ArrowLeftRight,
          shortcut: "⇧S",
          disabled: !hasSelection,
          action: () => store().shiftSelectedLayer(1),
        },
      ],
    },
    {
      heading: "Playback",
      commands: [
        {
          label: isPlaying ? "Pause" : "Play",
          icon: isPlaying ? Pause : Play,
          shortcut: "Space",
          action: () => store().togglePlayback(),
        },
        { label: "Go to start", icon: SkipBack, action: () => store().setProgress(0) },
        { label: "Toggle loop", icon: Repeat, action: () => store().toggleRepeating() },
        { label: "Toggle slow motion", icon: Gauge, action: () => store().toggleSlowMotion() },
      ],
    },
    {
      heading: "View",
      commands: [
        { label: "Zoom to fit", icon: Maximize, shortcut: "⇧1", action: onResetViews },
        { label: "Toggle layers", icon: PanelLeft, action: onToggleLayers },
        { label: "Toggle properties", icon: PanelRight, action: onToggleInspector },
        { label: "Toggle timeline", icon: PanelBottom, action: onToggleTimeline },
        ...(onToggleRulers
          ? [{ label: "Toggle rulers", icon: Ruler, action: onToggleRulers }]
          : []),
        {
          label: "Keyboard shortcuts",
          icon: Keyboard,
          shortcut: "?",
          keepOpen: true,
          action: () => {
            onOpenChange(false);
            onOpenHelp();
          },
        },
      ],
    },
    {
      heading: "File",
      commands: [
        {
          label: "Make an icon move",
          icon: Sparkles,
          keywords: ["learn", "exercise", "onboarding"],
          action: () => useAnimationExercise.getState().start(),
        },
        { label: "Import SVG, XML or project…", icon: Upload, action: onOpenImport },
        ...EXPORT_COMMANDS.map(([type, label]) => ({
          label,
          icon: Download,
          keywords: ["export", "download"],
          action: () => onExport(type),
        })),
      ],
    },
    {
      heading: "Examples",
      commands: DEMO_INFOS.map((demo, index) => ({
        label: `Open “${demo.title}”`,
        icon: Sparkles,
        keywords: ["sample", "demo", "example"],
        action: () => onLoadSample(index),
      })),
    },
  ];

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Quick actions">
      <CommandInput placeholder="Search actions…" />
      <CommandList>
        <CommandEmpty>No matching actions</CommandEmpty>
        {groups.map((group) => (
          <CommandGroup key={group.heading} heading={group.heading}>
            {group.commands
              .filter((command) => !command.disabled)
              .map((command) => {
                const Icon = command.icon;
                return (
                  <CommandItem
                    key={command.label}
                    value={`${group.heading} ${command.label}`}
                    keywords={command.keywords}
                    disabled={command.disabled}
                    onSelect={() => {
                      command.action();
                      if (!command.keepOpen) onOpenChange(false);
                    }}
                  >
                    {Icon ? <Icon className="size-4" /> : <span className="size-4" />}
                    <span className="flex-1 truncate">{command.label}</span>
                    {command.shortcut && (
                      <CommandShortcut>
                        <KeyCombo keys={command.shortcut} />
                      </CommandShortcut>
                    )}
                  </CommandItem>
                );
              })}
          </CommandGroup>
        ))}
      </CommandList>
      <div className="flex h-9 items-center gap-4 border-t border-border px-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <KeyCombo keys="↑" /> <KeyCombo keys="↓" /> Navigate
        </span>
        <span className="flex items-center gap-1.5">
          <KeyCombo keys="↵" /> Run
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <KeyCombo keys="Esc" /> Close
        </span>
      </div>
    </CommandDialog>
  );
}
