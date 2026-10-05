"use client";

import { Circle, Ellipsis, Frame, Hand, MousePointer2, PenTool, Plus, Square } from "lucide-react";
import { useEditorStore } from "@/lib/store/editorStore";
import { selectedPathLayer } from "@/lib/store/playheadPathEditing";
import type { ToolMode } from "@/lib/shapeshifter/toolModes";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EditorContextMenuItems } from "./EditorContextMenu";

const buttonClass =
  "flex h-11 touch-manipulation items-center justify-center gap-1.5 rounded-md px-1.5 text-[12px] font-medium focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";
const pointTools: { mode: ToolMode; label: string }[] = [
  { mode: "direct", label: "Move points" },
  { mode: "pen", label: "Pen" },
  { mode: "pencil", label: "Select points" },
  { mode: "paint", label: "Fill" },
  { mode: "knife", label: "Add point" },
];
const drawing = new Set<ToolMode>([
  "rectangle",
  "ellipse",
  "pen",
  "direct",
  "pencil",
  "paint",
  "knife",
]);
const descriptions: Partial<Record<ToolMode, string>> = {
  rectangle: "Rectangle",
  ellipse: "Ellipse",
  pen: "Pen",
  direct: "Points",
  pencil: "Select points",
  paint: "Fill",
  knife: "Add point",
};

/** A compact touch toolbar with contextual actions and an explicit way out of drawing. */
export function MobileCanvasTools() {
  const mode = useEditorStore((state) => state.toolMode);
  const hasSelection = useEditorStore((state) => state.hasCanvasSelection);
  const kind = useEditorStore((state) => state.selectionKind);
  const selectedIds = useEditorStore((state) => state.selectedLayerIds);
  const layer = useEditorStore((state) =>
    state.layers.find((item) => String(item.id) === String(state.selectedLayerId)),
  );
  const frame = useEditorStore((state) =>
    state.frames.find((item) => item.id === state.selectedFrameId),
  );
  const canEditPoints = useEditorStore((state) =>
    Boolean(selectedPathLayer(state) && !selectedPathLayer(state)!.locked),
  );
  const name =
    kind === "layer"
      ? selectedIds.length > 1
        ? `${selectedIds.length} objects`
        : layer?.name
      : frame?.name;
  const activeDrawing = drawing.has(mode);
  const choose = (next: ToolMode) => {
    const store = useEditorStore.getState();
    if (next === "rectangle" || next === "ellipse" || next === "select" || next === "hand")
      store.closeActionMode();
    store.setToolMode(next);
  };

  return (
    <div
      className={cn(
        "rounded-lg bg-card p-1 [box-shadow:var(--elevation-floating)]",
        activeDrawing ? "w-[min(320px,calc(100vw-24px))]" : "w-fit",
      )}
    >
      {activeDrawing ? (
        <div
          role="toolbar"
          aria-label="Active drawing tool"
          className="flex items-center gap-1 px-2"
        >
          <span role="status" className="min-w-0 flex-1 text-[12px] text-muted-foreground">
            {descriptions[mode]}
          </span>
          {mode !== "rectangle" && mode !== "ellipse" && canEditPoints && (
            <DropdownMenu>
              <DropdownMenuTrigger render={<button type="button" className={buttonClass} />}>
                Point tools
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="end" className="w-48">
                {pointTools.map((tool) => (
                  <DropdownMenuItem key={tool.mode} onClick={() => choose(tool.mode)}>
                    {tool.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <button
            type="button"
            aria-label="Done drawing"
            className={cn(buttonClass, "bg-primary text-primary-foreground")}
            onClick={() => choose("select")}
          >
            Done
          </button>
        </div>
      ) : (
        <div
          role="toolbar"
          aria-label="Canvas tools"
          className="grid grid-cols-4 gap-1 [&_button]:w-11"
        >
          <button
            type="button"
            aria-label="Select objects"
            aria-pressed={mode === "select"}
            className={cn(buttonClass, mode === "select" && "bg-muted text-foreground")}
            onClick={() => choose("select")}
          >
            <MousePointer2 className="size-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Move canvas"
            aria-pressed={mode === "hand"}
            className={cn(buttonClass, mode === "hand" && "bg-muted text-foreground")}
            onClick={() => choose("hand")}
          >
            <Hand className="size-5" aria-hidden="true" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<button type="button" aria-label="Add artwork" className={buttonClass} />}
            >
              <Plus className="size-5" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="w-48">
              <DropdownMenuItem onClick={() => choose("rectangle")}>
                <Square className="size-4" />
                Rectangle
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => choose("ellipse")}>
                <Circle className="size-4" />
                Ellipse
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => choose("pen")}>
                <PenTool className="size-4" />
                Pen path
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => useEditorStore.getState().addFrame()}>
                <Frame className="size-4" />
                Frame
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label={hasSelection && name ? `Actions for ${name}` : "Canvas actions"}
                  className={buttonClass}
                />
              }
            >
              <Ellipsis className="size-5" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="top"
              align="end"
              className="w-56 [&_[data-slot=dropdown-menu-shortcut]]:hidden"
            >
              <EditorContextMenuItems />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
