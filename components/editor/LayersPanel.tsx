"use client";

import React from "react";
import {
  ChevronRight,
  Crop,
  Eye,
  EyeOff,
  Folder,
  Frame,
  GripVertical,
  Lock,
  PanelLeftClose,
  Plus,
  Search,
  Spline,
  Unlock,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PAGE_ROOT_ID, useEditorStore } from "@/lib/store/editorStore";
import type { Layer, TimelineBlock } from "@/lib/shapeshifter/types";
import { cn } from "@/lib/utils";

function LayerIcon({ type }: { type: Layer["type"] }) {
  if (type === "group") return <Folder className="size-3.5" />;
  if (type === "clipPath") return <Crop className="size-3.5" />;
  return <Spline className="size-3.5" />;
}

interface LayerOwner {
  id: string;
  name: string;
  layers: Layer[];
  dimensions?: string;
  blocks: TimelineBlock[];
}

interface DraggedLayer {
  ownerId: string;
  layerId: string | number;
}

export function LayersPanel({ onCollapse }: { onCollapse: () => void }) {
  const frames = useEditorStore((state) => state.frames);
  const rootLayers = useEditorStore((state) => state.rootLayers);
  const rootAnimation = useEditorStore((state) => state.rootAnimation);
  const activeLayers = useEditorStore((state) => state.layers);
  const activeAnimation = useEditorStore((state) => state.animation);
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
  const renameOwnedLayer = useEditorStore((state) => state.renameOwnedLayer);
  const reorderOwnedLayer = useEditorStore((state) => state.reorderOwnedLayer);
  const moveSelectedLayersToFrame = useEditorStore((state) => state.moveSelectedLayersToFrame);
  const moveSelectedLayersToRoot = useEditorStore((state) => state.moveSelectedLayersToRoot);

  const [collapsedOwners, setCollapsedOwners] = React.useState<Set<string>>(() => new Set());
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(() => new Set());
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [renamingKey, setRenamingKey] = React.useState<string | null>(null);
  const [renameDraft, setRenameDraft] = React.useState("");
  const [draggedLayer, setDraggedLayer] = React.useState<DraggedLayer | null>(null);
  const [dropKey, setDropKey] = React.useState<string | null>(null);

  const owners = React.useMemo<LayerOwner[]>(
    () => [
      ...frames.map((frame) => ({
        id: frame.id,
        name: frame.name,
        layers: frame.id === selectedFrameId ? activeLayers : frame.layers,
        dimensions: `${frame.vector.width} × ${frame.vector.height}`,
        blocks: frame.id === selectedFrameId ? activeAnimation.blocks : frame.animation.blocks,
      })),
      ...(rootLayers.length
        ? [
            {
              id: PAGE_ROOT_ID,
              name: "Page vectors",
              layers: selectedFrameId === PAGE_ROOT_ID ? activeLayers : rootLayers,
              blocks:
                selectedFrameId === PAGE_ROOT_ID ? activeAnimation.blocks : rootAnimation.blocks,
            },
          ]
        : []),
    ],
    [
      activeAnimation.blocks,
      activeLayers,
      frames,
      rootAnimation.blocks,
      rootLayers,
      selectedFrameId,
    ],
  );

  const selectedKeys = React.useMemo(
    () => new Set(selectedLayerRefs.map((ref) => `${ref.ownerId}:${String(ref.layerId)}`)),
    [selectedLayerRefs],
  );

  // Canvas selection should never disappear inside a collapsed layer tree.
  React.useEffect(() => {
    if (selectionKind !== "layer" || selectedLayerRefs.length === 0) return;
    setCollapsedOwners((previous) => {
      const next = new Set(previous);
      for (const ref of selectedLayerRefs) next.delete(ref.ownerId);
      return next;
    });
    setCollapsedGroups((previous) => {
      const next = new Set(previous);
      for (const ref of selectedLayerRefs) {
        const owner = owners.find((candidate) => candidate.id === ref.ownerId);
        const byId = new Map(owner?.layers.map((layer) => [String(layer.id), layer]) ?? []);
        let current = byId.get(String(ref.layerId));
        const seen = new Set<string>();
        while (current?.parentId != null && !seen.has(String(current.parentId))) {
          const parentId = String(current.parentId);
          seen.add(parentId);
          next.delete(`${ref.ownerId}:${parentId}`);
          current = byId.get(parentId);
        }
      }
      return next;
    });
  }, [owners, selectedLayerRefs, selectionKind]);

  const toggleSetValue = (
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    key: string,
  ) => {
    setter((previous) => {
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

  const beginRename = (ownerId: string, layer: Layer) => {
    selectLayer(ownerId, layer.id, false);
    setRenamingKey(`${ownerId}:${String(layer.id)}`);
    setRenameDraft(layer.name || "Layer");
  };

  const commitRename = (ownerId: string, layer: Layer) => {
    renameOwnedLayer(ownerId, layer.id, renameDraft);
    setRenamingKey(null);
  };

  const moveDraggedLayer = (targetOwnerId: string) => {
    if (!draggedLayer || draggedLayer.ownerId === targetOwnerId) return false;
    selectLayerRefs([draggedLayer]);
    return targetOwnerId === PAGE_ROOT_ID
      ? moveSelectedLayersToRoot()
      : moveSelectedLayersToFrame(targetOwnerId);
  };

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const renderLayers = (owner: LayerOwner): React.ReactNode => {
    const byParent = new Map<string, Layer[]>();
    for (const layer of owner.layers) {
      if (layer.parentId == null || layer.parentId === "") continue;
      const parentId = String(layer.parentId);
      byParent.set(parentId, [...(byParent.get(parentId) ?? []), layer]);
    }
    const nestedIds = new Set(
      Array.from(byParent.values())
        .flat()
        .map((layer) => String(layer.id)),
    );
    const roots = owner.layers.filter((layer) => !nestedIds.has(String(layer.id)));

    const childrenFor = (layer: Layer) =>
      layer.children?.length ? layer.children : (byParent.get(String(layer.id)) ?? []);
    const layerMatches = (layer: Layer): boolean =>
      !normalizedQuery ||
      (layer.name || "Layer").toLocaleLowerCase().includes(normalizedQuery) ||
      childrenFor(layer).some(layerMatches);

    const renderLayer = (layer: Layer, depth: number): React.ReactNode => {
      if (!layerMatches(layer)) return null;
      const key = `${owner.id}:${String(layer.id)}`;
      const children = childrenFor(layer);
      const expandable = children.length > 0;
      const expanded = normalizedQuery.length > 0 || !collapsedGroups.has(key);
      const selected = selectionKind === "layer" && selectedKeys.has(key);
      const animated = owner.blocks.some((block) => String(block.layerId) === String(layer.id));
      const renaming = renamingKey === key;
      const isDropTarget = dropKey === key;

      return (
        <React.Fragment key={key}>
          <div
            role="treeitem"
            aria-level={depth + 2}
            aria-selected={selected}
            aria-expanded={expandable ? expanded : undefined}
            draggable={!renaming}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", key);
              setDraggedLayer({ ownerId: owner.id, layerId: layer.id });
            }}
            onDragEnd={() => {
              setDraggedLayer(null);
              setDropKey(null);
            }}
            onDragOver={(event) => {
              if (!draggedLayer) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDropKey(key);
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!draggedLayer) return;
              if (draggedLayer.ownerId === owner.id) {
                const targetIndex = owner.layers.findIndex(
                  (candidate) => String(candidate.id) === String(layer.id),
                );
                reorderOwnedLayer(owner.id, draggedLayer.layerId, targetIndex);
              } else {
                moveDraggedLayer(owner.id);
              }
              setDraggedLayer(null);
              setDropKey(null);
            }}
            className={cn(
              "group relative flex h-8 items-center gap-1 pr-1.5 text-[11px] outline-none",
              selected
                ? "bg-primary/14 text-foreground"
                : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
              isDropTarget &&
                "after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-primary",
            )}
            style={{ paddingLeft: 6 + depth * 12 }}
          >
            <span className="grid size-4 shrink-0 place-items-center text-muted-foreground/35 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
              <GripVertical className="size-3" />
            </span>
            <button
              type="button"
              className="grid size-5 shrink-0 place-items-center rounded hover:bg-muted disabled:opacity-0"
              disabled={!expandable}
              onClick={() => toggleSetValue(setCollapsedGroups, key)}
              aria-label={expanded ? `Collapse ${layer.name}` : `Expand ${layer.name}`}
            >
              <ChevronRight
                className={cn("size-3 transition-transform duration-100", expanded && "rotate-90")}
              />
            </button>
            <span className="shrink-0 text-muted-foreground">
              <LayerIcon type={layer.type} />
            </span>
            {renaming ? (
              <input
                autoFocus
                value={renameDraft}
                onChange={(event) => setRenameDraft(event.target.value)}
                onFocus={(event) => event.currentTarget.select()}
                onBlur={() => commitRename(owner.id, layer)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitRename(owner.id, layer);
                  if (event.key === "Escape") setRenamingKey(null);
                }}
                onClick={(event) => event.stopPropagation()}
                className="h-6 min-w-0 flex-1 rounded border border-primary bg-background px-1.5 text-[12px] text-foreground outline-none ring-2 ring-primary/15"
                aria-label={`Rename ${layer.name}`}
              />
            ) : (
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch text-left"
                onClick={(event) => selectLayer(owner.id, layer.id, event.shiftKey)}
                onDoubleClick={() => beginRename(owner.id, layer)}
                onKeyDown={(event) => {
                  if (event.key === "F2") {
                    event.preventDefault();
                    beginRename(owner.id, layer);
                  }
                }}
              >
                <span className="truncate">{layer.name || "Layer"}</span>
                {animated && (
                  <span
                    className="size-1.5 shrink-0 rotate-45 rounded-[1px] bg-primary"
                    title="Contains animation"
                    aria-label="Contains animation"
                  />
                )}
              </button>
            )}
            <div className="flex shrink-0 items-center">
              <button
                type="button"
                className={cn(
                  "grid size-6 place-items-center rounded text-muted-foreground/55 hover:bg-muted hover:text-foreground focus-visible:opacity-100",
                  layer.locked
                    ? "opacity-100"
                    : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
                )}
                onClick={() => toggleOwnedLayerLock(owner.id, layer.id)}
                aria-label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
              >
                {layer.locked ? <Lock className="size-3" /> : <Unlock className="size-3" />}
              </button>
              <button
                type="button"
                className={cn(
                  "grid size-6 place-items-center rounded text-muted-foreground/55 hover:bg-muted hover:text-foreground focus-visible:opacity-100",
                  layer.visible === false
                    ? "opacity-100"
                    : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
                )}
                onClick={() => toggleOwnedLayerVisibility(owner.id, layer.id)}
                aria-label={layer.visible === false ? `Show ${layer.name}` : `Hide ${layer.name}`}
              >
                {layer.visible === false ? (
                  <EyeOff className="size-3" />
                ) : (
                  <Eye className="size-3" />
                )}
              </button>
            </div>
          </div>
          {expandable && expanded && children.map((child) => renderLayer(child, depth + 1))}
        </React.Fragment>
      );
    };

    return roots.map((layer) => renderLayer(layer, 0));
  };

  const visibleOwners = owners.filter(
    (owner) =>
      !normalizedQuery ||
      owner.name.toLocaleLowerCase().includes(normalizedQuery) ||
      owner.layers.some((layer) =>
        (layer.name || "Layer").toLocaleLowerCase().includes(normalizedQuery),
      ),
  );

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-10 shrink-0 items-center border-b border-border px-2">
        <span className="flex-1 px-1 text-[11px] font-semibold">Layers</span>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => {
            setSearchOpen((open) => !open);
            if (searchOpen) setQuery("");
          }}
          aria-label={searchOpen ? "Close layer search" : "Search layers"}
          aria-pressed={searchOpen}
        >
          {searchOpen ? <X className="size-3.5" /> : <Search className="size-3.5" />}
        </Button>
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
      {searchOpen && (
        <div className="relative border-b border-border p-2">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a layer"
            aria-label="Find a layer"
            className="h-7 w-full rounded-md border border-input bg-background pl-7 pr-2 text-[12px] outline-none placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto py-1" role="tree" aria-label="Layers">
        {visibleOwners.map((owner) => {
          const expanded = normalizedQuery.length > 0 || !collapsedOwners.has(owner.id);
          const frameSelected = selectionKind === "frame" && selectedFrameIds.includes(owner.id);
          const ownerTitle = [
            owner.dimensions,
            owner.blocks.length ? `${owner.blocks.length} animated track(s)` : "",
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <div key={owner.id}>
              <div
                role="treeitem"
                aria-level={1}
                aria-expanded={expanded}
                aria-selected={frameSelected}
                className={cn(
                  "group flex h-8 items-center px-1.5",
                  frameSelected && "bg-primary/14 text-foreground",
                  dropKey === `owner:${owner.id}` && "ring-1 ring-inset ring-primary",
                )}
                onDragOver={(event) => {
                  if (!draggedLayer) return;
                  event.preventDefault();
                  setDropKey(`owner:${owner.id}`);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (!draggedLayer) return;
                  if (draggedLayer.ownerId === owner.id) {
                    reorderOwnedLayer(owner.id, draggedLayer.layerId, owner.layers.length - 1);
                  } else {
                    moveDraggedLayer(owner.id);
                  }
                  setDraggedLayer(null);
                  setDropKey(null);
                }}
              >
                <button
                  type="button"
                  className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted"
                  onClick={() => toggleSetValue(setCollapsedOwners, owner.id)}
                  aria-label={expanded ? `Collapse ${owner.name}` : `Expand ${owner.name}`}
                >
                  <ChevronRight
                    className={cn(
                      "size-3 transition-transform duration-100",
                      expanded && "rotate-90",
                    )}
                  />
                </button>
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 px-1 text-left text-[11px] font-medium"
                  onClick={(event) =>
                    owner.id !== PAGE_ROOT_ID && selectFrameRow(owner.id, event.shiftKey)
                  }
                  aria-pressed={frameSelected}
                  title={ownerTitle || undefined}
                >
                  <Frame className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{owner.name}</span>
                  {owner.blocks.length > 0 && (
                    <span className="ml-auto flex shrink-0 items-center gap-1 font-mono text-[9px] font-normal text-muted-foreground/65">
                      <span className="size-1.5 rotate-45 rounded-[1px] bg-primary" />
                      {owner.blocks.length}
                    </span>
                  )}
                </button>
              </div>
              {expanded && renderLayers(owner)}
            </div>
          );
        })}
        {visibleOwners.length === 0 && (
          <div className="px-4 py-8 text-center text-[11px] leading-relaxed text-muted-foreground">
            No layers match “{query}”.
          </div>
        )}
      </div>
    </aside>
  );
}
