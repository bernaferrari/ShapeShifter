"use client";

import React from "react";
import { toast } from "sonner";
import {
  ChevronRight,
  Crop,
  Eye,
  EyeOff,
  Folder,
  Lock,
  MoreHorizontal,
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
import { createLayerTreeModel, type LayerPlacement } from "@/lib/shapeshifter/scene/layerHierarchy";
import type { Layer, TimelineBlock } from "@/lib/shapeshifter/types";
import { cn } from "@/lib/utils";
import { LayerOwnerRow } from "./layers/LayerOwnerRow";
import { EditorContextMenu } from "./EditorContextMenu";
import { resolveOwnerDocument } from "@/lib/store/cloneSubtree";
import { layerReparentIssue } from "@/lib/store/commands/reparentLayer";

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

type DropPosition = "before" | "inside" | "after" | "owner";

interface LayerDropTarget {
  ownerId: string;
  layerId?: string | number;
  position: DropPosition;
}

import { PanelHeader } from "./PanelHeader";
import { TextSizedInput } from "./TextSizedInput";

export function LayersPanel({
  onCollapse,
  className,
}: {
  onCollapse?: () => void;
  className?: string;
}) {
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
  const reparentOwnedLayer = useEditorStore((state) => state.reparentOwnedLayer);
  const moveSelectedLayersToFrame = useEditorStore((state) => state.moveSelectedLayersToFrame);
  const moveSelectedLayersToRoot = useEditorStore((state) => state.moveSelectedLayersToRoot);
  const bringLayerIntoView = useEditorStore((state) => state.bringLayerIntoView);

  const [collapsedOwners, setCollapsedOwners] = React.useState<Set<string>>(() => new Set());
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(() => new Set());
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [renamingKey, setRenamingKey] = React.useState<string | null>(null);
  const [renameDraft, setRenameDraft] = React.useState("");
  const [draggedLayer, setDraggedLayer] = React.useState<DraggedLayer | null>(null);
  const [dropTarget, setDropTarget] = React.useState<LayerDropTarget | null>(null);
  const [focusedKey, setFocusedKey] = React.useState<string | null>(null);
  const rangeAnchorRef = React.useRef<string | null>(null);
  const renameCancelledRef = React.useRef(false);
  const typeaheadRef = React.useRef({ text: "", at: 0 });
  const treeRef = React.useRef<HTMLDivElement>(null);
  const expandTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const expandTargetRef = React.useRef<string | null>(null);

  React.useEffect(
    () => () => {
      if (expandTimerRef.current) clearTimeout(expandTimerRef.current);
    },
    [],
  );

  React.useEffect(() => {
    const tree = treeRef.current;
    if (tree && !tree.querySelector('[role="treeitem"][tabindex="0"]')) {
      setFocusedKey(tree.querySelector<HTMLElement>("[data-tree-key]")?.dataset.treeKey ?? null);
    }
  });

  const owners = React.useMemo<LayerOwner[]>(
    () => [
      ...frames.map((frame) => ({
        id: frame.id,
        name: frame.name,
        layers: frame.id === selectedFrameId ? activeLayers : frame.layers,
        dimensions: `${frame.vector.width} × ${frame.vector.height}`,
        blocks: frame.id === selectedFrameId ? activeAnimation.blocks : frame.animation.blocks,
      })),
      {
        id: PAGE_ROOT_ID,
        name: "Canvas",
        layers: selectedFrameId === PAGE_ROOT_ID ? activeLayers : rootLayers,
        blocks: selectedFrameId === PAGE_ROOT_ID ? activeAnimation.blocks : rootAnimation.blocks,
      },
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
        if (!owner) continue;
        for (const ancestor of createLayerTreeModel(owner.layers).ancestorsOf(ref.layerId)) {
          next.delete(`${ref.ownerId}:${String(ancestor.id)}`);
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
    if (!additive) bringLayerIntoView(ownerId, layerId, { animate: true, fit: false });
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
    renameCancelledRef.current = false;
    selectLayer(ownerId, layer.id, false);
    setRenamingKey(`${ownerId}:${String(layer.id)}`);
    setRenameDraft(layer.name || "Layer");
  };

  const commitRename = (ownerId: string, layer: Layer) => {
    if (renameCancelledRef.current) return;
    renameOwnedLayer(ownerId, layer.id, renameDraft);
    setRenamingKey(null);
  };

  const moveLayerToOwner = (
    layerRef: DraggedLayer,
    targetOwnerId: string,
    placement?: LayerPlacement,
    preserveSelection = false,
  ) => {
    const isSelectedSiblingSet =
      preserveSelection &&
      selectedLayerRefs.some(
        (ref) =>
          ref.ownerId === layerRef.ownerId && String(ref.layerId) === String(layerRef.layerId),
      ) &&
      selectedLayerRefs.every((ref) => ref.ownerId === layerRef.ownerId);
    if (!isSelectedSiblingSet) selectLayerRefs([layerRef]);
    const moved =
      targetOwnerId === PAGE_ROOT_ID
        ? moveSelectedLayersToRoot({ placement })
        : moveSelectedLayersToFrame(targetOwnerId, { placement });
    if (!moved)
      toast.warning("Layer not moved", {
        description:
          "The layer is locked, inherits animated groups or masks, or the destination changes its appearance. Move the containing group onto the frame to preserve the artwork.",
      });
    return moved;
  };

  const reparentLayer = (ownerId: string, layerId: string | number, placement: LayerPlacement) => {
    const state = useEditorStore.getState();
    const owner = resolveOwnerDocument(state, ownerId);
    const hidden =
      ownerId === state.selectedFrameId
        ? state.hiddenLayerIds
        : ownerId === PAGE_ROOT_ID
          ? state.rootHiddenLayerIds
          : (state.frames.find((frame) => frame.id === ownerId)?.hiddenLayerIds ?? []);
    const issue = layerReparentIssue(owner.layers, owner.animation, hidden, layerId, placement);
    if (issue) {
      toast.warning("Layer not moved", { description: issue });
      return false;
    }
    return reparentOwnedLayer(ownerId, layerId, placement);
  };

  const moveDraggedLayer = (targetOwnerId: string, placement?: LayerPlacement) => {
    if (!draggedLayer || draggedLayer.ownerId === targetOwnerId) return false;
    return moveLayerToOwner(draggedLayer, targetOwnerId, placement, true);
  };

  const clearLayerDrag = () => {
    if (expandTimerRef.current) clearTimeout(expandTimerRef.current);
    expandTimerRef.current = null;
    expandTargetRef.current = null;
    setDraggedLayer(null);
    setDropTarget(null);
  };

  const scheduleGroupExpand = (key: string) => {
    if (!collapsedGroups.has(key) || expandTargetRef.current === key) return;
    if (expandTimerRef.current) clearTimeout(expandTimerRef.current);
    expandTargetRef.current = key;
    expandTimerRef.current = setTimeout(() => {
      setCollapsedGroups((previous) => {
        const next = new Set(previous);
        next.delete(key);
        return next;
      });
      expandTimerRef.current = null;
      expandTargetRef.current = null;
    }, 450);
  };

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const renderLayers = (owner: LayerOwner): React.ReactNode => {
    const tree = createLayerTreeModel(owner.layers);
    const layerMatches = (layer: Layer): boolean =>
      !normalizedQuery ||
      (layer.name || "Layer").toLocaleLowerCase().includes(normalizedQuery) ||
      tree.childrenOf(layer).some(layerMatches);

    const renderLayer = (layer: Layer, depth: number): React.ReactNode => {
      if (!layerMatches(layer)) return null;
      const key = `${owner.id}:${String(layer.id)}`;
      const children = tree.childrenOf(layer);
      const expandable = children.length > 0;
      const canContainLayers = layer.type === "group";
      const expanded = normalizedQuery.length > 0 || !collapsedGroups.has(key);
      const selected = selectionKind === "layer" && selectedKeys.has(key);
      const renaming = renamingKey === key;
      const activeDropPosition =
        dropTarget?.ownerId === owner.id && String(dropTarget.layerId) === String(layer.id)
          ? dropTarget.position
          : null;

      return (
        <React.Fragment key={key}>
          <div
            role="treeitem"
            data-tree-key={key}
            data-owner-id={owner.id}
            data-layer-id={String(layer.id)}
            data-tree-label={layer.name || "Layer"}
            tabIndex={
              (focusedKey ??
                (selectedLayerRefs.length
                  ? `${selectedLayerRefs.at(-1)!.ownerId}:${String(selectedLayerRefs.at(-1)!.layerId)}`
                  : `owner:${owners[0]?.id}`)) === key
                ? 0
                : -1
            }
            aria-level={depth + 2}
            aria-selected={selected}
            aria-expanded={expandable ? expanded : undefined}
            draggable={!renaming}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", key);
              if (!selectedKeys.has(key))
                selectLayerRefs([{ ownerId: owner.id, layerId: layer.id }]);
              setDraggedLayer({ ownerId: owner.id, layerId: layer.id });
            }}
            onDragEnd={clearLayerDrag}
            onDragOver={(event) => {
              if (!draggedLayer) return;
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = "move";
              const bounds = event.currentTarget.getBoundingClientRect();
              const ratio = bounds.height ? (event.clientY - bounds.top) / bounds.height : 0.5;
              const position: DropPosition = canContainLayers
                ? ratio < 0.25
                  ? "before"
                  : ratio > 0.75
                    ? "after"
                    : "inside"
                : ratio < 0.5
                  ? "before"
                  : "after";
              setDropTarget({ ownerId: owner.id, layerId: layer.id, position });
              if (position === "inside" && canContainLayers) scheduleGroupExpand(key);
              else if (expandTimerRef.current) {
                clearTimeout(expandTimerRef.current);
                expandTimerRef.current = null;
                expandTargetRef.current = null;
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!draggedLayer) return;
              const position = activeDropPosition ?? (canContainLayers ? "inside" : "after");
              const parentId =
                position === "inside" ? layer.id : (tree.ancestorsOf(layer.id)[0]?.id ?? null);
              const target = {
                parentId,
                ...(position === "before" ? { beforeId: layer.id } : {}),
                ...(position === "after" ? { afterId: layer.id } : {}),
              };
              if (draggedLayer.ownerId === owner.id) {
                reparentLayer(owner.id, draggedLayer.layerId, target);
              } else {
                moveDraggedLayer(owner.id, target);
              }
              clearLayerDrag();
            }}
            className={cn(
              "group relative flex h-8 in-[.mobile-workspace]:h-11 items-center gap-1 pr-1.5 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              selected
                ? "bg-primary/14 text-foreground"
                : "text-foreground/80 hover:bg-muted/70 hover:text-foreground",
              activeDropPosition === "inside" && "bg-primary/10 ring-1 ring-inset ring-primary/70",
              activeDropPosition === "before" &&
                "before:absolute before:inset-x-2 before:top-0 before:h-0.5 before:bg-primary",
              activeDropPosition === "after" &&
                "after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-primary",
            )}
            style={{ paddingLeft: 10 + depth * 14 }}
          >
            <button
              type="button"
              className="grid size-5 shrink-0 place-items-center rounded hover:bg-muted disabled:opacity-0"
              disabled={!expandable}
              tabIndex={-1}
              data-tree-toggle=""
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
              <TextSizedInput
                autoFocus
                fit="fill"
                fontSize={12}
                lineHeight={20}
                className="-ml-0.5"
                value={renameDraft}
                onChange={(event) => setRenameDraft(event.target.value)}
                onFocus={(event) => event.currentTarget.select()}
                onBlur={() => commitRename(owner.id, layer)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    if (event.key === "Escape") {
                      renameCancelledRef.current = true;
                      setRenamingKey(null);
                    } else commitRename(owner.id, layer);
                    event.currentTarget.closest<HTMLElement>('[role="treeitem"]')?.focus();
                  }
                }}
                onClick={(event) => event.stopPropagation()}
                aria-label={`Rename ${layer.name}`}
              />
            ) : (
              <button
                type="button"
                tabIndex={-1}
                className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch text-left leading-none"
                onClick={(event) => {
                  rangeAnchorRef.current = key;
                  selectLayer(owner.id, layer.id, event.shiftKey);
                  event.currentTarget.closest<HTMLElement>('[role="treeitem"]')?.focus();
                }}
                onDoubleClick={() => beginRename(owner.id, layer)}
                onKeyDown={(event) => {
                  if (event.key === "F2") {
                    event.preventDefault();
                    beginRename(owner.id, layer);
                  }
                }}
              >
                <span className="truncate">{layer.name || "Layer"}</span>
              </button>
            )}
            <div className="flex shrink-0 items-center">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      data-tree-menu=""
                      tabIndex={selected ? 0 : -1}
                      className="grid size-6 place-items-center rounded text-muted-foreground/55 opacity-0 pointer-coarse:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
                      aria-label={`Move ${layer.name || "layer"} to another frame`}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => event.stopPropagation()}
                    />
                  }
                >
                  <MoreHorizontal className="size-3" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {owners
                    .filter((targetOwner) => targetOwner.id !== owner.id)
                    .map((targetOwner) => (
                      <DropdownMenuItem
                        key={targetOwner.id}
                        onClick={() =>
                          moveLayerToOwner({ ownerId: owner.id, layerId: layer.id }, targetOwner.id)
                        }
                      >
                        Move to {targetOwner.name}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <button
                type="button"
                tabIndex={selected ? 0 : -1}
                className={cn(
                  "grid size-6 place-items-center rounded text-muted-foreground/55 hover:bg-muted hover:text-foreground focus-visible:opacity-100",
                  layer.locked
                    ? "opacity-100"
                    : "opacity-0 pointer-coarse:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100",
                )}
                onClick={() => toggleOwnedLayerLock(owner.id, layer.id)}
                aria-label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
              >
                {layer.locked ? <Lock className="size-3" /> : <Unlock className="size-3" />}
              </button>
              <button
                type="button"
                tabIndex={selected ? 0 : -1}
                className={cn(
                  "grid size-6 place-items-center rounded text-muted-foreground/55 hover:bg-muted hover:text-foreground focus-visible:opacity-100",
                  layer.visible === false
                    ? "opacity-100"
                    : "opacity-0 pointer-coarse:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100",
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

    return tree.roots.map((layer) => renderLayer(layer, 0));
  };

  const visibleOwners = owners.filter(
    (owner) =>
      // Loose canvas layers only get a section once there are some, or while
      // a layer is being dragged out of its frame.
      (owner.id !== PAGE_ROOT_ID || owner.layers.length > 0 || draggedLayer) &&
      (!normalizedQuery ||
        owner.name.toLocaleLowerCase().includes(normalizedQuery) ||
        createLayerTreeModel(owner.layers).allLayers.some((layer) =>
          (layer.name || "Layer").toLocaleLowerCase().includes(normalizedQuery),
        )),
  );

  const handleTreeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      event.defaultPrevented ||
      event.nativeEvent.isComposing ||
      (event.target as Element).closest("input,textarea,[contenteditable=true],[role=menu]")
    )
      return;
    // Embedded buttons own activation and focus navigation. A bubbling Space
    // or Enter must not become a tree selection and cancel the native click.
    if ((event.target as Element).closest("button,[role=button],a[href]")) return;
    const current = (event.target as Element).closest<HTMLElement>('[role="treeitem"]');
    if (!current) return;
    const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]'));
    const index = rows.indexOf(current);
    const level = Number(current.getAttribute("aria-level"));
    const selectRow = (row: HTMLElement, additive = false) => {
      const owner = owners.find((candidate) => candidate.id === row.dataset.ownerId);
      if (!owner) return;
      const layer = owner.layers.find((candidate) => String(candidate.id) === row.dataset.layerId);
      if (layer) selectLayer(owner.id, layer.id, additive);
      else if (owner.id !== PAGE_ROOT_ID) selectFrameRow(owner.id, additive);
    };
    const focusRow = (row: HTMLElement | undefined, select = true) => {
      if (!row) return;
      row.focus();
      row.scrollIntoView?.({ block: "nearest" });
      if (!select) return;
      if (event.shiftKey && row.dataset.layerId) {
        const anchor = rows.findIndex(
          (candidate) => candidate.dataset.treeKey === rangeAnchorRef.current,
        );
        const end = rows.indexOf(row);
        const start = anchor < 0 ? index : anchor;
        selectLayerRefs(
          rows
            .slice(Math.min(start, end), Math.max(start, end) + 1)
            .filter((candidate) => candidate.dataset.layerId)
            .map((candidate) => ({
              ownerId: candidate.dataset.ownerId!,
              layerId: candidate.dataset.layerId!,
            })),
        );
      } else {
        rangeAnchorRef.current = row.dataset.treeKey ?? null;
        selectRow(row);
      }
    };
    switch (event.key) {
      case "ArrowDown":
        focusRow(rows[Math.min(index + 1, rows.length - 1)]);
        break;
      case "ArrowUp":
        focusRow(rows[Math.max(index - 1, 0)]);
        break;
      case "Home":
        focusRow(rows[0]);
        break;
      case "End":
        focusRow(rows.at(-1));
        break;
      case "ArrowRight":
        if (current.getAttribute("aria-expanded") === "false")
          current.querySelector<HTMLButtonElement>("[data-tree-toggle]")?.click();
        else if (Number(rows[index + 1]?.getAttribute("aria-level")) > level)
          focusRow(rows[index + 1]);
        break;
      case "ArrowLeft":
        if (current.getAttribute("aria-expanded") === "true")
          current.querySelector<HTMLButtonElement>("[data-tree-toggle]")?.click();
        else
          focusRow(
            rows
              .slice(0, index)
              .reverse()
              .find((row) => Number(row.getAttribute("aria-level")) < level),
          );
        break;
      case "Enter":
      case " ":
        rangeAnchorRef.current = current.dataset.treeKey ?? null;
        selectRow(current, event.shiftKey || event.metaKey || event.ctrlKey);
        break;
      case "F2": {
        const owner = owners.find((candidate) => candidate.id === current.dataset.ownerId);
        const layer = owner?.layers.find(
          (candidate) => String(candidate.id) === current.dataset.layerId,
        );
        if (owner && layer) beginRename(owner.id, layer);
        break;
      }
      case "F10":
        if (!event.shiftKey) return;
        current.querySelector<HTMLButtonElement>("[data-tree-menu]")?.click();
        break;
      default: {
        if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;
        const now = Date.now();
        const text =
          (now - typeaheadRef.current.at < 700 ? typeaheadRef.current.text : "") +
          event.key.toLocaleLowerCase();
        typeaheadRef.current = { text, at: now };
        focusRow(
          [...rows.slice(index + 1), ...rows.slice(0, index + 1)].find((row) =>
            row.dataset.treeLabel?.toLocaleLowerCase().startsWith(text),
          ),
        );
      }
    }
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <aside
      className={cn(
        "flex h-full w-60 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground",
        className,
      )}
    >
      <PanelHeader
        className="flex h-10 shrink-0 items-center gap-0.5 border-b border-border pl-3 pr-2"
        actions={
          <>
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
            {onCollapse && (
              <Button size="icon-xs" variant="ghost" onClick={onCollapse} aria-label="Hide layers">
                <PanelLeftClose className="size-3.5" />
              </Button>
            )}
          </>
        }
      >
        <span className="flex-1 text-[12px] font-semibold">Layers</span>
      </PanelHeader>
      {searchOpen && (
        <div className="relative border-b border-border p-2">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a layer"
            aria-label="Find a layer"
            className="h-7 pointer-coarse:h-9 w-full rounded-md border border-input bg-background pl-7 pr-2 text-[12px] outline-none placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
        </div>
      )}
      <EditorContextMenu
        render={
          <div
            className="min-h-0 flex-1 overflow-y-auto py-1"
            role="tree"
            aria-label="Layers"
            ref={treeRef}
            onKeyDown={handleTreeKeyDown}
            onFocusCapture={(event) => {
              const row = (event.target as Element).closest<HTMLElement>("[data-tree-key]");
              if (row) setFocusedKey(row.dataset.treeKey ?? null);
            }}
            onContextMenu={(event) => {
              const row = (event.target as Element).closest<HTMLElement>("[data-tree-key]");
              const ownerId = row?.dataset.ownerId;
              if (!row || !ownerId) return;
              const layerId = row.dataset.layerId;
              if (layerId != null) {
                if (!selectedKeys.has(`${ownerId}:${layerId}`)) {
                  const owner = owners.find((candidate) => candidate.id === ownerId);
                  const layer = owner?.layers.find((item) => String(item.id) === layerId);
                  if (layer) selectLayerRefs([{ ownerId, layerId: layer.id }]);
                }
              } else if (ownerId !== PAGE_ROOT_ID && !selectedFrameIds.includes(ownerId)) {
                selectFrame(ownerId);
              }
            }}
          />
        }
      >
        {visibleOwners.map((owner) => {
          const expanded = normalizedQuery.length > 0 || !collapsedOwners.has(owner.id);
          const frameSelected = selectionKind === "frame" && selectedFrameIds.includes(owner.id);
          return (
            <div key={owner.id}>
              <LayerOwnerRow
                treeKey={`owner:${owner.id}`}
                ownerId={owner.id}
                tabIndex={
                  (focusedKey ??
                    (selectedLayerRefs.length
                      ? `${selectedLayerRefs.at(-1)!.ownerId}:${String(selectedLayerRefs.at(-1)!.layerId)}`
                      : `owner:${visibleOwners[0]?.id}`)) === `owner:${owner.id}`
                    ? 0
                    : -1
                }
                name={owner.name}
                dimensions={owner.dimensions}
                expanded={expanded}
                selected={frameSelected}
                selectable={owner.id !== PAGE_ROOT_ID}
                dropActive={dropTarget?.ownerId === owner.id && dropTarget.position === "owner"}
                onToggle={() => toggleSetValue(setCollapsedOwners, owner.id)}
                onSelect={(additive) => selectFrameRow(owner.id, additive)}
                onDragOver={(event) => {
                  if (!draggedLayer) return;
                  event.preventDefault();
                  setDropTarget({ ownerId: owner.id, position: "owner" });
                  setCollapsedOwners((previous) => {
                    if (!previous.has(owner.id)) return previous;
                    const next = new Set(previous);
                    next.delete(owner.id);
                    return next;
                  });
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (!draggedLayer) return;
                  if (draggedLayer.ownerId === owner.id) {
                    reparentLayer(owner.id, draggedLayer.layerId, { parentId: null });
                  } else {
                    moveDraggedLayer(owner.id);
                  }
                  clearLayerDrag();
                }}
              />
              {expanded && renderLayers(owner)}
              {expanded && owner.layers.length === 0 && (
                <div
                  className={cn(
                    "mx-2 flex h-7 items-center rounded px-6 text-[10px] text-muted-foreground/60",
                    dropTarget?.ownerId === owner.id &&
                      "bg-primary/8 text-primary ring-1 ring-inset ring-primary/50",
                  )}
                  onDragOver={(event) => {
                    if (!draggedLayer) return;
                    event.preventDefault();
                    setDropTarget({ ownerId: owner.id, position: "owner" });
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (draggedLayer?.ownerId !== owner.id) moveDraggedLayer(owner.id);
                    clearLayerDrag();
                  }}
                >
                  {draggedLayer ? "Move here" : "Empty"}
                </div>
              )}
            </div>
          );
        })}
        {visibleOwners.length === 0 && (
          <div className="px-4 py-8 text-center text-[11px] leading-relaxed text-muted-foreground">
            No layers match “{query}”.
          </div>
        )}
      </EditorContextMenu>
    </aside>
  );
}
