"use client";

import React from "react";
import { toast } from "sonner";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { useEditorStore } from "@/lib/store/editorStore";
import { BooleanMenuItems } from "./BooleanOperations";

type TriggerProps = React.ComponentProps<typeof ContextMenuTrigger>;

/** Right-click menu for the canvas and layer tree. It acts on the current selection. */
export function EditorContextMenu({
  children,
  ...triggerProps
}: { children?: React.ReactNode } & Omit<TriggerProps, "children">) {
  return (
    <ContextMenu>
      <ContextMenuTrigger {...triggerProps}>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <EditorContextMenuItems />
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function EditorContextMenuItems() {
  const selectionKind = useEditorStore((state) => state.selectionKind);
  const hasCanvasSelection = useEditorStore((state) => state.hasCanvasSelection);
  const selectedLayerId = useEditorStore((state) => state.selectedLayerId);
  const selectedLayerIds = useEditorStore((state) => state.selectedLayerIds);
  const selectedFrameId = useEditorStore((state) => state.selectedFrameId);
  const frameCount = useEditorStore((state) => state.frames.length);
  const hasClipboard = useEditorStore((state) => Boolean(state.clipboard));
  const primary = useEditorStore((state) =>
    state.layers.find((layer) => String(layer.id) === String(state.selectedLayerId)),
  );
  const store = () => useEditorStore.getState();
  const ids = selectedLayerIds.length ? selectedLayerIds : [selectedLayerId];
  const paste = hasClipboard && (
    <DropdownMenuItem onClick={() => store().pasteLayers()}>
      Paste
      <DropdownMenuShortcut>⌘V</DropdownMenuShortcut>
    </DropdownMenuItem>
  );

  if (hasCanvasSelection && selectionKind === "layer" && primary) {
    const multiple = ids.length > 1;
    const isPath = primary.type === "path" || primary.type === "clipPath";
    return (
      <>
        <DropdownMenuItem onClick={() => store().copyLayers(ids)}>
          Copy
          <DropdownMenuShortcut>⌘C</DropdownMenuShortcut>
        </DropdownMenuItem>
        {paste}
        <DropdownMenuItem
          onClick={() => {
            store().duplicateSelectedLayersOffset(2, 2);
          }}
        >
          Duplicate
          <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={() => store().deleteSelectedLayers()}>
          Delete
          <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => store().nudgeLayerZOrder(selectedLayerId, 1)}>
          Bring forward
          <DropdownMenuShortcut>]</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => store().nudgeLayerZOrder(selectedLayerId, -1)}>
          Send backward
          <DropdownMenuShortcut>[</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => store().groupSelectedLayers()}>
          Group selection
          <DropdownMenuShortcut>⌘G</DropdownMenuShortcut>
        </DropdownMenuItem>
        {primary.type === "group" && (
          <DropdownMenuItem onClick={() => store().ungroupSelectedLayer()}>
            Ungroup
            <DropdownMenuShortcut>⇧⌘G</DropdownMenuShortcut>
          </DropdownMenuItem>
        )}
        {multiple && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Combine</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-60">
              <BooleanMenuItems />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        {isPath && !multiple && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => store().setToolMode("direct")}>
              Edit points
              <DropdownMenuShortcut>A</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={primary.locked}
              onClick={() => store().beginTimelineMorphEditing()}
            >
              Edit morph shapes
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                if (store().previewPrepareForMorph())
                  toast.message("Review the morph in the properties panel, then Apply or Cancel");
                else if (store().autoFixSelectedLayer()) toast.success("Paths made compatible");
              }}
            >
              Make morph-compatible
              <DropdownMenuShortcut>⇧F</DropdownMenuShortcut>
            </DropdownMenuItem>
          </>
        )}
        {!multiple && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => store().toggleOwnedLayerVisibility(selectedFrameId, primary.id)}
            >
              {primary.visible === false ? "Show" : "Hide"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => store().toggleOwnedLayerLock(selectedFrameId, primary.id)}
            >
              {primary.locked ? "Unlock" : "Lock"}
            </DropdownMenuItem>
          </>
        )}
      </>
    );
  }

  if (hasCanvasSelection && selectionKind === "frame") {
    return (
      <>
        {paste}
        <DropdownMenuItem onClick={() => store().duplicateFrame()}>
          Duplicate frame
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={frameCount <= 1}
          onClick={() => store().deleteFrame(selectedFrameId)}
        >
          Delete frame
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => store().addLayer("path")}>New path layer</DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => store().bringFrameIntoView(selectedFrameId, { animate: true })}
        >
          Zoom to frame
          <DropdownMenuShortcut>⇧2</DropdownMenuShortcut>
        </DropdownMenuItem>
      </>
    );
  }

  return (
    <>
      {paste}
      <DropdownMenuItem onClick={() => store().addFrame()}>New frame</DropdownMenuItem>
      <DropdownMenuItem onClick={() => store().addLayer("path")}>New path layer</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => store().fitWorldToFrames()}>
        Zoom to fit
        <DropdownMenuShortcut>⇧1</DropdownMenuShortcut>
      </DropdownMenuItem>
    </>
  );
}
