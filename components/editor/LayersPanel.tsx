"use client";

import React from "react";
import {
  ChevronRight,
  Crop,
  Eye,
  EyeOff,
  Folder,
  Frame,
  Lock,
  PanelLeftClose,
  Plus,
  Spline,
  Unlock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PAGE_ROOT_ID, useEditorStore } from "@/lib/store/editorStore";
import type { Layer } from "@/lib/shapeshifter/types";
import { cn } from "@/lib/utils";

function LayerIcon({ type }: { type: Layer["type"] }) {
  if (type === "group") return <Folder className="size-3.5" />;
  if (type === "clipPath") return <Crop className="size-3.5" />;
  return <Spline className="size-3.5" />;
}

export function LayersPanel({ onCollapse }: { onCollapse: () => void }) {
  const frames = useEditorStore((state) => state.frames);
  const rootLayers = useEditorStore((state) => state.rootLayers);
  const activeLayers = useEditorStore((state) => state.layers);
  const selectedFrameId = useEditorStore((state) => state.selectedFrameId);
  const selectedFrameIds = useEditorStore((state) => state.selectedFrameIds);
  const selectionKind = useEditorStore((state) => state.selectionKind);
  const selectedLayerRefs = useEditorStore((state) => state.selectedLayerRefs);
  const selectFrame = useEditorStore((state) => state.selectFrame);
  const selectFrames = useEditorStore((state) => state.selectFrames);
  const selectLayerRefs = useEditorStore((state) => state.selectLayerRefs);
  const addLayer = useEditorStore((state) => state.addLayer);
  const toggleOwnedLayerVisibility = useEditorStore((state) => state.toggleOwnedLayerVisibility);
  const toggleOwnedLayerLock = useEditorStore((state) => state.toggleOwnedLayerLock);
  const [collapsedOwners, setCollapsedOwners] = React.useState<Set<string>>(() => new Set());
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(() => new Set());

  const owners = React.useMemo(
    () => [
      ...frames.map((frame) => ({
        id: frame.id,
        name: frame.name,
        layers: frame.id === selectedFrameId ? activeLayers : frame.layers,
      })),
      ...(rootLayers.length
        ? [
            {
              id: PAGE_ROOT_ID,
              name: "Page vectors",
              layers: selectedFrameId === PAGE_ROOT_ID ? activeLayers : rootLayers,
            },
          ]
        : []),
    ],
    [activeLayers, frames, rootLayers, selectedFrameId],
  );
  const selectedKeys = React.useMemo(
    () => new Set(selectedLayerRefs.map((ref) => `${ref.ownerId}:${String(ref.layerId)}`)),
    [selectedLayerRefs],
  );

  const toggleOwner = (ownerId: string) => {
    setCollapsedOwners((previous) => {
      const next = new Set(previous);
      if (next.has(ownerId)) next.delete(ownerId);
      else next.add(ownerId);
      return next;
    });
  };
  const toggleGroup = (key: string) => {
    setCollapsedGroups((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const selectLayer = (ownerId: string, layerId: string | number, additive: boolean) => {
    const key = `${ownerId}:${String(layerId)}`;
    const next = additive
      ? selectedKeys.has(key)
        ? selectedLayerRefs.filter((ref) => `${ref.ownerId}:${String(ref.layerId)}` !== key)
        : [...selectedLayerRefs, { ownerId, layerId }]
      : [{ ownerId, layerId }];
    selectLayerRefs(next);
  };
  const mutateLayer = (
    ownerId: string,
    layerId: string | number,
    action: "visibility" | "lock",
  ) => {
    if (action === "visibility") toggleOwnedLayerVisibility(ownerId, layerId);
    else toggleOwnedLayerLock(ownerId, layerId);
  };
  const selectFrameRow = (frameId: string, additive: boolean) => {
    if (!additive) {
      selectFrame(frameId);
      return;
    }
    const next = selectedFrameIds.includes(frameId)
      ? selectedFrameIds.filter((id) => id !== frameId)
      : [...selectedFrameIds, frameId];
    selectFrames(next, next.includes(frameId) ? frameId : undefined);
  };

  const renderLayers = (ownerId: string, layers: Layer[], depth: number): React.ReactNode => {
    const byParent = new Map<string, Layer[]>();
    for (const layer of layers) {
      if (layer.parentId == null || layer.parentId === "") continue;
      const key = String(layer.parentId);
      byParent.set(key, [...(byParent.get(key) ?? []), layer]);
    }
    const nestedIds = new Set(
      Array.from(byParent.values())
        .flat()
        .map((layer) => String(layer.id)),
    );
    const roots = depth === 0 ? layers.filter((layer) => !nestedIds.has(String(layer.id))) : layers;

    const renderLayer = (layer: Layer, layerDepth: number): React.ReactNode => {
      const key = `${ownerId}:${String(layer.id)}`;
      const children = layer.children?.length
        ? layer.children
        : (byParent.get(String(layer.id)) ?? []);
      const expandable = children.length > 0;
      const expanded = !collapsedGroups.has(key);
      const selected = selectionKind === "layer" && selectedKeys.has(key);
      return (
        <React.Fragment key={key}>
          <div
            className={cn(
              "group flex h-8 items-center gap-1 px-1.5 text-[11px]",
              selected
                ? "bg-primary/15 text-foreground"
                : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
            )}
            style={{ paddingLeft: 8 + layerDepth * 12 }}
          >
            <button
              type="button"
              className="grid size-5 shrink-0 place-items-center rounded hover:bg-muted disabled:opacity-0"
              disabled={!expandable}
              onClick={() => toggleGroup(key)}
              aria-label={expanded ? `Collapse ${layer.name}` : `Expand ${layer.name}`}
            >
              <ChevronRight
                className={cn("size-3 transition-transform", expanded && "rotate-90")}
              />
            </button>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              onClick={(event) => selectLayer(ownerId, layer.id, event.shiftKey)}
            >
              <span className="shrink-0 text-muted-foreground">
                <LayerIcon type={layer.type} />
              </span>
              <span className="truncate">{layer.name || "Layer"}</span>
            </button>
            <button
              type="button"
              className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground/55 hover:bg-muted hover:text-foreground"
              onClick={() => mutateLayer(ownerId, layer.id, "lock")}
              aria-label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
            >
              {layer.locked ? <Lock className="size-3" /> : <Unlock className="size-3" />}
            </button>
            <button
              type="button"
              className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground/55 hover:bg-muted hover:text-foreground"
              onClick={() => mutateLayer(ownerId, layer.id, "visibility")}
              aria-label={layer.visible === false ? `Show ${layer.name}` : `Hide ${layer.name}`}
            >
              {layer.visible === false ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
            </button>
          </div>
          {expandable && expanded && children.map((child) => renderLayer(child, layerDepth + 1))}
        </React.Fragment>
      );
    };

    return roots.map((layer) => renderLayer(layer, depth));
  };

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-10 shrink-0 items-center border-b border-border px-2">
        <span className="flex-1 px-1 text-[11px] font-semibold">Layers</span>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button size="icon-xs" variant="ghost" aria-label="Add layer" />}
          >
            <Plus className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={() => addLayer("path")}>Path</DropdownMenuItem>
            <DropdownMenuItem onClick={() => addLayer("clipPath")}>Clip path</DropdownMenuItem>
            <DropdownMenuItem onClick={() => addLayer("group")}>Group</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="icon-xs" variant="ghost" onClick={onCollapse} aria-label="Hide layers">
          <PanelLeftClose className="size-3.5" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {owners.map((owner) => {
          const expanded = !collapsedOwners.has(owner.id);
          const frameSelected = selectionKind === "frame" && selectedFrameIds.includes(owner.id);
          return (
            <div key={owner.id}>
              <div className={cn("flex h-8 items-center px-1.5", frameSelected && "bg-primary/15")}>
                <button
                  type="button"
                  className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted"
                  onClick={() => toggleOwner(owner.id)}
                  aria-label={expanded ? `Collapse ${owner.name}` : `Expand ${owner.name}`}
                >
                  <ChevronRight
                    className={cn("size-3 transition-transform", expanded && "rotate-90")}
                  />
                </button>
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 px-1 text-left text-[11px] font-medium"
                  onClick={(event) =>
                    owner.id !== PAGE_ROOT_ID && selectFrameRow(owner.id, event.shiftKey)
                  }
                  aria-pressed={frameSelected}
                >
                  <Frame className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{owner.name}</span>
                </button>
              </div>
              {expanded && renderLayers(owner.id, owner.layers, 0)}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
