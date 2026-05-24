"use client";

import React from "react";
import { FileTree, useFileTree } from "@pierre/trees/react";
import type { ContextMenuItem, ContextMenuOpenContext } from "@pierre/trees";
import { Button } from "@/components/ui/button";
import type { Layer } from "@/lib/shapeshifter/types";

interface LayerTreeProps {
  layers: Layer[];
  selectedLayerId: string | number;
  onSelectLayer: (id: string | number) => void;
  onConvertLayerType: (id: string | number, type: "path" | "clipPath") => void;
  onAddTimelineBlock: (id: string | number, propertyName: string) => void;
}

function segmentForLayer(layer: Layer) {
  return `${layer.type}-${String(layer.id).replaceAll("/", "_")}-${layer.name.replaceAll("/", "_")}`;
}

function buildLayerPaths(layers: Layer[]) {
  const byId = new Map(layers.map((layer) => [String(layer.id), layer]));
  const layerIdByPath = new Map<string, string | number>();

  const buildPath = (layer: Layer): string => {
    const parent = layer.parentId == null ? undefined : byId.get(String(layer.parentId));
    const path = parent ? `${buildPath(parent)}/${segmentForLayer(layer)}` : segmentForLayer(layer);
    layerIdByPath.set(path, layer.id);
    return path;
  };

  const paths = layers
    .filter((layer) => layer.type !== "group" || !layers.some((candidate) => String(candidate.parentId) === String(layer.id)))
    .map(buildPath);

  for (const layer of layers) {
    if (layer.type === "group") {
      buildPath(layer);
    }
  }

  return { paths, layerIdByPath };
}

function animatableProperties(layer?: Layer) {
  if (!layer) return [];
  return layer.type === "group"
    ? ["rotation", "scaleX", "scaleY", "pivotX", "pivotY", "translateX", "translateY"]
    : ["pathData", "fillColor", "fillAlpha", "strokeColor", "strokeAlpha", "strokeWidth", "trimPathStart", "trimPathEnd", "trimPathOffset"];
}

export function LayerTree({
  layers,
  selectedLayerId,
  onSelectLayer,
  onConvertLayerType,
  onAddTimelineBlock,
}: LayerTreeProps) {
  const { paths, layerIdByPath } = React.useMemo(() => buildLayerPaths(layers), [layers]);
  const selectedPath = React.useMemo(
    () => Array.from(layerIdByPath.entries()).find(([, id]) => String(id) === String(selectedLayerId))?.[0],
    [layerIdByPath, selectedLayerId],
  );

  const tree = useFileTree({
    paths,
    initialExpansion: "open",
    initialSelectedPaths: selectedPath ? [selectedPath] : [],
    search: true,
    icons: "minimal",
    density: "compact",
    onSelectionChange: (selectedPaths) => {
      const id = selectedPaths[0] ? layerIdByPath.get(selectedPaths[0]) : undefined;
      if (id != null) onSelectLayer(id);
    },
    composition: {
      contextMenu: {
        enabled: true,
        triggerMode: "both",
        buttonVisibility: "always",
      },
    },
    renderRowDecoration: ({ item }) => {
      const id = layerIdByPath.get(item.path);
      const layer = id == null ? undefined : layers.find((candidate) => String(candidate.id) === String(id));
      const count = layer?.timeline?.length ?? 0;
      return count > 0 ? { text: String(count), title: `${count} animation block(s)` } : null;
    },
  });

  React.useEffect(() => {
    tree.model.resetPaths(paths, { initialExpandedPaths: paths });
  }, [paths, tree.model]);

  React.useEffect(() => {
    if (!selectedPath) return;
    for (const path of tree.model.getSelectedPaths()) {
      if (path !== selectedPath) tree.model.getItem(path)?.deselect();
    }
    tree.model.getItem(selectedPath)?.select();
  }, [selectedPath, tree.model]);

  const renderContextMenu = (item: ContextMenuItem, context: ContextMenuOpenContext) => {
    const id = layerIdByPath.get(item.path);
    const layer = id == null ? undefined : layers.find((candidate) => String(candidate.id) === String(id));
    if (!layer) return null;

    return (
      <div className="min-w-48 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
        {layer.type === "path" && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={() => {
              onConvertLayerType(layer.id, "clipPath");
              context.close();
            }}
          >
            Convert to clip path
          </Button>
        )}
        {layer.type === "clipPath" && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={() => {
              onConvertLayerType(layer.id, "path");
              context.close();
            }}
          >
            Convert to path
          </Button>
        )}
        {animatableProperties(layer).map((propertyName) => (
          <Button
            key={propertyName}
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={() => {
              onAddTimelineBlock(layer.id, propertyName);
              context.close();
            }}
          >
            Animate {propertyName}
          </Button>
        ))}
      </div>
    );
  };

  return (
    <FileTree
      model={tree.model}
      renderContextMenu={renderContextMenu}
      className="block h-full min-h-0"
      aria-label="Layer tree"
    />
  );
}
