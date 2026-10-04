"use client";

import React from "react";
import { ClipboardPaste, Copy } from "lucide-react";
import { toast } from "sonner";
import { useEditorStore } from "@/lib/store/editorStore";
import { cn } from "@/lib/utils";

function copyMotion() {
  const store = useEditorStore.getState();
  if (store.copyTimelineBlocks())
    toast.success(
      `Copied ${store.selectedBlockIds.length} motion segment${store.selectedBlockIds.length === 1 ? "" : "s"}.`,
    );
  else toast.info("Select motion segments on one layer to copy.");
}
function pasteMotion() {
  const result = useEditorStore.getState().pasteTimelineBlocks();
  if (!result.ok) toast.error(result.message);
  else
    toast.success(
      `Pasted ${result.blockIds.length} motion segment${result.blockIds.length === 1 ? "" : "s"}.`,
    );
}

/** Timeline and motion inspector own their clipboard shortcuts; text fields keep native editing. */
export function handleTimelineClipboardShortcut(event: React.KeyboardEvent<HTMLElement>) {
  if (event.defaultPrevented || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey)
    return;
  if ((event.target as Element).closest("input, textarea, select, [contenteditable='true']"))
    return;
  const key = event.key.toLowerCase();
  if (key !== "c" && key !== "v") return;
  event.preventDefault();
  event.stopPropagation();
  if (key === "c") copyMotion();
  else pasteMotion();
}

export function TimelineClipboardControls({ compact = false }: { compact?: boolean }) {
  const selectedIds = useEditorStore((state) => state.selectedBlockIds);
  const animation = useEditorStore((state) => state.animation);
  const clipboard = useEditorStore((state) => state.timelineClipboard);
  const selectedLayers = useEditorStore((state) => state.selectedLayerIds);
  const source = animation.blocks.filter((block) => selectedIds.includes(block.id));
  const canCopy =
    source.length > 0 && new Set(source.map((block) => String(block.layerId))).size === 1;
  const controls = [
    {
      label: compact ? "Copy timeline motion" : "Copy motion",
      title: "Copy selected motion segments · Ctrl/⌘ C",
      icon: Copy,
      disabled: !canCopy,
      action: copyMotion,
    },
    {
      label: compact ? "Paste timeline motion at playhead" : "Paste motion at playhead",
      title: "Paste motion at playhead on the selected layer · Ctrl/⌘ V",
      icon: ClipboardPaste,
      disabled: !clipboard || selectedLayers.length !== 1,
      action: pasteMotion,
    },
  ];
  return (
    <div className={cn("flex items-center gap-1", !compact && "border-b border-border px-3 py-2")}>
      {controls.map(({ label, title, icon: Icon, disabled, action }) => (
        <button
          key={label}
          type="button"
          aria-label={label}
          title={title}
          disabled={disabled}
          onClick={action}
          className={cn(
            "flex h-6 shrink-0 items-center justify-center gap-1 rounded text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-35",
            compact ? "size-6" : "flex-1 bg-muted/50 px-2",
          )}
        >
          <Icon className="size-3.5" />
          {!compact && <span>{label.startsWith("Copy") ? "Copy motion" : "Paste motion"}</span>}
        </button>
      ))}
    </div>
  );
}
