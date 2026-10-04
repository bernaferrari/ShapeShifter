"use client";

import React from "react";
import { ChevronDown, Pause, Play, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTheme } from "@/components/theme-provider";
import { useEditorStore } from "@/lib/store/editorStore";
import { DEMO_INFOS } from "@/lib/shapeshifter/demoProjects";
import { ExportDialog } from "./ExportDialog";
import { DocumentSaveStatus, type DocumentAutosave } from "./DocumentSaveStatus";
import { BooleanMenuItems } from "./BooleanOperations";

export interface EditorPanelVisibility {
  layers: boolean;
  inspector: boolean;
  timeline: boolean;
  rulers: boolean;
}

interface ToolbarProps {
  onExport: (type: string) => void;
  onLoadSample: (index: number) => void;
  onTogglePlay: () => void;
  onOpenSVGImport: () => void;
  onShowHelp: () => void;
  onOpenCommand: () => void;
  onOpenAgentTools?: () => void;
  onOpenRecovery?: () => void;
  onTogglePanel: (panel: keyof EditorPanelVisibility) => void;
  panels: EditorPanelVisibility;
  autosave: DocumentAutosave;
  resetAllViews: () => void;
  isPlaying: boolean;
  isActionMode: boolean;
  editingSide: "from" | "to";
  setEditingSide: (side: "from" | "to") => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * The top bar recedes: one main menu holds every document command, the title
 * says where you are, and the only persistent actions are Play and Export.
 */
export function Toolbar({
  onExport,
  onLoadSample,
  onTogglePlay,
  onOpenSVGImport,
  onShowHelp,
  onOpenCommand,
  onOpenAgentTools,
  onOpenRecovery,
  onTogglePanel,
  panels,
  autosave,
  resetAllViews,
  isPlaying,
  isActionMode,
  editingSide,
  setEditingSide,
  undo,
  redo,
  canUndo,
  canRedo,
}: ToolbarProps) {
  const vector = useEditorStore((state) => state.vector);
  const closeActionMode = useEditorStore((state) => state.closeActionMode);

  return (
    <header
      aria-label="Editor toolbar"
      className="relative grid h-11 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b bg-background px-2 text-foreground"
    >
      <div className="flex min-w-0 items-center gap-1">
        <MainMenu
          onExport={onExport}
          onLoadSample={onLoadSample}
          onOpenSVGImport={onOpenSVGImport}
          onShowHelp={onShowHelp}
          onOpenCommand={onOpenCommand}
          onOpenAgentTools={onOpenAgentTools}
          onOpenRecovery={onOpenRecovery}
          onTogglePanel={onTogglePanel}
          panels={panels}
          resetAllViews={resetAllViews}
          isActionMode={isActionMode}
          undo={undo}
          redo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
        />
        <div className="flex min-w-0 items-center gap-1.5 pl-1">
          <span className="truncate text-[13px] font-medium tracking-tight">
            {vector?.name || "Untitled"}
          </span>
          <DocumentSaveStatus autosave={autosave} />
        </div>
      </div>

      {/* Center: only appears for the dedicated From/To morph editor. */}
      <div className="flex items-center justify-center gap-2">
        {isActionMode && (
          <>
            <div
              role="radiogroup"
              aria-label="Editing side"
              className="flex items-center rounded-lg bg-muted p-0.5"
            >
              {(["from", "to"] as const).map((side) => (
                <button
                  key={side}
                  type="button"
                  role="radio"
                  aria-checked={editingSide === side}
                  onClick={() => setEditingSide(side)}
                  className={cn(
                    "h-7 rounded-md px-3 text-[12px] font-medium capitalize transition-colors",
                    editingSide === side
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {side === "from" ? "Start" : "End"}
                </button>
              ))}
            </div>
            <Button
              size="sm"
              variant="secondary"
              className="h-7 px-3 text-[12px]"
              onClick={closeActionMode}
              aria-label="Back to canvas"
            >
              Done
            </Button>
          </>
        )}
      </div>

      <div className="flex items-center justify-end gap-1.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn(
                  "size-8 text-muted-foreground hover:text-foreground",
                  isPlaying && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
                )}
                onClick={onTogglePlay}
                aria-label={isPlaying ? "Pause" : "Play"}
              />
            }
          >
            {isPlaying ? (
              <Pause className="size-4 fill-current" strokeWidth={0} />
            ) : (
              <Play className="size-4 fill-current" strokeWidth={0} />
            )}
          </TooltipTrigger>
          <TooltipContent>
            {isPlaying ? "Pause" : "Play"} <Kbd>Space</Kbd>
          </TooltipContent>
        </Tooltip>
        <ExportDialog>
          <Button size="sm" className="h-8 px-3.5 text-[12px] font-medium">
            Export
          </Button>
        </ExportDialog>
      </div>
    </header>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <span className="ml-1.5 text-muted-foreground opacity-80">{children}</span>;
}

function MainMenu({
  onExport,
  onLoadSample,
  onOpenSVGImport,
  onShowHelp,
  onOpenCommand,
  onOpenAgentTools,
  onOpenRecovery,
  onTogglePanel,
  panels,
  resetAllViews,
  isActionMode,
  undo,
  redo,
  canUndo,
  canRedo,
}: Pick<
  ToolbarProps,
  | "onExport"
  | "onLoadSample"
  | "onOpenSVGImport"
  | "onShowHelp"
  | "onOpenCommand"
  | "onOpenAgentTools"
  | "onOpenRecovery"
  | "onTogglePanel"
  | "panels"
  | "resetAllViews"
  | "isActionMode"
  | "undo"
  | "redo"
  | "canUndo"
  | "canRedo"
>) {
  const { theme, setTheme } = useTheme();
  const addLayer = useEditorStore((state) => state.addLayer);
  const reverseSelectedLayer = useEditorStore((state) => state.reverseSelectedLayer);
  const shiftSelectedLayer = useEditorStore((state) => state.shiftSelectedLayer);
  const autoFixSelectedLayer = useEditorStore((state) => state.autoFixSelectedLayer);
  const previewPrepareForMorph = useEditorStore((state) => state.previewPrepareForMorph);
  const splitSelectedCommand = useEditorStore((state) => state.splitSelectedCommand);
  const setSelectedCommandAsFirst = useEditorStore((state) => state.setSelectedCommandAsFirst);
  const deleteSelectedPoint = useEditorStore((state) => state.deleteSelectedPoint);
  const deleteSelectedSubPath = useEditorStore((state) => state.deleteSelectedSubPath);
  const extractSelectedSubPathToNewLayer = useEditorStore(
    (state) => state.extractSelectedSubPathToNewLayer,
  );
  const resetProject = useEditorStore((state) => state.resetProject);
  const isRepeating = useEditorStore((state) => state.isRepeating);
  const playbackMode = useEditorStore((state) => state.playbackMode);
  const isSlowMotion = useEditorStore((state) => state.isSlowMotion);
  const toggleRepeating = useEditorStore((state) => state.toggleRepeating);
  const toggleSlowMotion = useEditorStore((state) => state.toggleSlowMotion);

  const handleAutoFix = () => {
    if (previewPrepareForMorph()) {
      toast.message("Review the morph in the inspector, then Apply or Cancel");
      return;
    }
    if (autoFixSelectedLayer()) toast.success("Paths made compatible");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="Main menu"
            className="flex h-8 items-center gap-1 rounded-md pl-1 pr-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-popup-open:bg-muted data-popup-open:text-foreground"
          />
        }
      >
        <span className="grid size-6 place-items-center rounded-md bg-primary text-primary-foreground">
          <Sparkles className="size-3.5" />
        </span>
        <ChevronDown className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem onClick={onOpenCommand}>
          Quick actions…
          <DropdownMenuShortcut>⌘K</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>File</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56">
            <DropdownMenuItem
              onClick={() => {
                resetProject();
                toast.success("New project");
              }}
            >
              New project
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onOpenSVGImport}>
              Import SVG, XML or project…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onExport("json")}>Save project file</DropdownMenuItem>
            {onOpenRecovery && (
              <DropdownMenuItem onClick={onOpenRecovery}>Version history…</DropdownMenuItem>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Edit</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-60">
            <DropdownMenuItem onClick={undo} disabled={!canUndo}>
              Undo
              <DropdownMenuShortcut>⌘Z</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={redo} disabled={!canRedo}>
              Redo
              <DropdownMenuShortcut>⇧⌘Z</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => addLayer("path")}>New path layer</DropdownMenuItem>
            <DropdownMenuItem onClick={() => addLayer("group")}>New group</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Path</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-60">
                <DropdownMenuItem onClick={handleAutoFix}>
                  Make morph-compatible
                  <DropdownMenuShortcut>⇧F</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    reverseSelectedLayer();
                    toast.success("Reversed");
                  }}
                >
                  Reverse direction
                  <DropdownMenuShortcut>⇧R</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => shiftSelectedLayer(1)}>
                  Shift start point forward
                  <DropdownMenuShortcut>⇧S</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => shiftSelectedLayer(-1)}>
                  Shift start point back
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => extractSelectedSubPathToNewLayer?.()}
                  disabled={!extractSelectedSubPathToNewLayer}
                >
                  Extract subpath to layer
                </DropdownMenuItem>
                {isActionMode && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => splitSelectedCommand()}>
                      Split segment
                      <DropdownMenuShortcut>X</DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setSelectedCommandAsFirst()}>
                      Set as first point
                      <DropdownMenuShortcut>F</DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => deleteSelectedPoint()}>
                      Delete points
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => deleteSelectedSubPath()}>
                      Delete subpaths
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Combine</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-60">
                <BooleanMenuItems />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>View</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56">
            <DropdownMenuCheckboxItem
              checked={panels.layers}
              onCheckedChange={() => onTogglePanel("layers")}
            >
              Layers
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={panels.inspector}
              onCheckedChange={() => onTogglePanel("inspector")}
            >
              Properties
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={panels.timeline}
              onCheckedChange={() => onTogglePanel("timeline")}
            >
              Timeline
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={panels.rulers}
              onCheckedChange={() => onTogglePanel("rulers")}
            >
              Rulers
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={isRepeating} onCheckedChange={toggleRepeating}>
              Loop playback
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={playbackMode === "back-and-forth"}
              onCheckedChange={(checked) =>
                useEditorStore.getState().setPlaybackMode(checked ? "back-and-forth" : "forward")
              }
            >
              Back-and-forth playback
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={isSlowMotion} onCheckedChange={toggleSlowMotion}>
              Slow motion
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={resetAllViews}>
              Zoom to fit
              <DropdownMenuShortcut>⇧1</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Examples</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-52">
            {DEMO_INFOS.map((demo, index) => (
              <DropdownMenuItem key={demo.id} onClick={() => onLoadSample(index)}>
                {demo.title}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Theme</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-40">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="sr-only">Theme</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={theme}
                onValueChange={(value) => setTheme(value as typeof theme)}
              >
                <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onClick={onShowHelp}>
          Keyboard shortcuts
          <DropdownMenuShortcut>?</DropdownMenuShortcut>
        </DropdownMenuItem>
        {onOpenAgentTools && (
          <DropdownMenuItem onClick={onOpenAgentTools}>Agent tools…</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
