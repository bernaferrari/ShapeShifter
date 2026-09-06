import { describe, it, expect, beforeEach, vi } from "vitest";
import { PAGE_ROOT_ID, useEditorStore } from "../editorStore";
import { computeDetailViewport } from "../../shapeshifter/camera";
import { parsePath, pathToString } from "../../shapeshifter/pathUtils";
import { commitDocumentV2 } from "../documentRuntime";
import { DEMO_INFOS } from "../../shapeshifter/demoProjects";
import type { Selection, Layer, DocumentV2 } from "../../shapeshifter/types";
import type { EditorState } from "../editorStore";
import type { LegacyDocumentSnapshot } from "../../shapeshifter/documentModel";

// Destructive Boolean commands are compiled off in production (BOOLEAN_OPERATIONS_ENABLED,
// see the androidTrust P0 suite). Mock the gate open — spreading the real module — so these
// tests can exercise the store action's operand/lock/morph invariants behind it.
vi.mock("../../shapeshifter/pathUtils", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, BOOLEAN_OPERATIONS_ENABLED: true };
});

// Helper: get a fresh store state by resetting
function freshStore() {
  const store = useEditorStore.getState();
  store.resetProject();
  return store;
}

// Re-acquire state after mutation (Zustand returns new references)
function getStore() {
  return useEditorStore.getState();
}

// Helper: make a selection for a given layer's first point
function makeSelection(layerId: string | number, side: "from" | "to" = "from"): Selection {
  return {
    layerId,
    side,
    subPathIndex: 0,
    commandIndex: 0,
    pointIndex: 0,
  };
}

// Helper: count draw commands in a layer's path (excluding M and Z)
function drawCommandCount(layer: Layer, side: "from" | "to" = "from"): number {
  const path = side === "from" ? layer.from : layer.to!;
  let count = 0;
  for (const sp of path.subPaths) {
    for (const cmd of sp.commands) {
      if (cmd.type !== "M" && cmd.type !== "Z") count++;
    }
  }
  return count;
}

function getLayerCommandIds(layers: Layer[]): string[] {
  return layers.flatMap((layer) =>
    [layer.from, layer.to!, layer.pathData]
      .filter(Boolean)
      .flatMap((path) =>
        path!.subPaths.flatMap((subPath) => subPath.commands.map((command) => command.id)),
      ),
  );
}

describe("editorStore", () => {
  // Geometry versions are parsed from id-less path strings on every commit
  // (parsePath mints fresh ULIDs), so equality is asserted modulo the
  // regenerated command ids — everything else must match exactly.
  function canonicalize(documentV2: DocumentV2): string {
    return JSON.stringify({
      ...documentV2,
      geometryVersions: Object.fromEntries(
        Object.entries(documentV2.geometryVersions).map(([id, version]) => [
          id,
          {
            ...version,
            pathData: {
              subPaths: version.pathData.subPaths.map((subPath) => ({
                commands: subPath.commands.map(({ type, points }) => ({ type, points })),
              })),
            },
          },
        ]),
      ),
    });
  }

  beforeEach(() => {
    freshStore();
  });

  describe("world camera", () => {
    it("starts fitted to the first frame instead of the old magic viewport", () => {
      const viewport = getStore().worldViewport;

      expect(viewport).not.toEqual({ x: -80, y: -80, w: 320, h: 320, scale: 1 });
      expect(viewport.x).toBeLessThanOrEqual(0);
      expect(viewport.y).toBeLessThanOrEqual(0);
      expect(viewport.x + viewport.w).toBeGreaterThanOrEqual(getStore().vector.width);
      expect(viewport.y + viewport.h).toBeGreaterThanOrEqual(getStore().vector.height);
    });

    it("does not reset the camera when artboards move", () => {
      getStore().setWorldViewport({ x: 10, y: 20, w: 300, h: 240, scale: 1.5 });
      const before = getStore().worldViewport;

      getStore().moveFrames([getStore().selectedFrameId], 25, 10);

      expect(getStore().worldViewport).toEqual(before);
    });

    it("centers a layer without changing zoom when selected from the Layers panel", () => {
      const frame = getStore().frames[0]!;
      const layer = frame.layers[0]!;
      getStore().setWorldViewport({ x: -200, y: -150, w: 400, h: 300, scale: 1 });

      getStore().bringLayerIntoView(frame.id, layer.id, { animate: false, fit: false });

      const viewport = getStore().worldViewport;
      expect(viewport.w).toBe(400);
      expect(viewport.h).toBe(300);
      expect(viewport.scale).toBe(1);
      expect(viewport.x).toBeGreaterThan(-200);
    });

    it("fits a double-clicked layer instead of framing its entire artboard", () => {
      const frame = getStore().frames[0]!;
      const layer = frame.layers[0]!;
      getStore().setWorldViewport({ x: -200, y: -150, w: 400, h: 300, scale: 1 });

      getStore().bringLayerIntoView(frame.id, layer.id, { animate: false, fit: true });

      const viewport = getStore().worldViewport;
      expect(viewport.w).toBeLessThan(400);
      expect(viewport.h).toBeLessThan(300);
      expect(viewport.scale).toBeGreaterThan(1);
      expect(viewport.scale).toBeLessThanOrEqual(12);
    });

    it("restores artboard positions through undo", () => {
      const frameId = getStore().selectedFrameId;
      const before = getStore().frames.find((frame) => frame.id === frameId)!;
      getStore().pushHistory();
      getStore().moveFrame(frameId, 25, -10);

      getStore().undo();

      const restored = getStore().frames.find((frame) => frame.id === frameId)!;
      expect(restored.x).toBe(before.x);
      expect(restored.y).toBe(before.y);
    });

    it("preserves pan and zoom across undo and redo", () => {
      getStore().setWorldViewport({ x: -37, y: 11, w: 500, h: 400, scale: 2 });
      const worldBefore = getStore().worldViewport;
      getStore().pushHistory();
      getStore().moveFrame(getStore().selectedFrameId, 25, -10);
      getStore().setDetailViewport((current) => ({
        ...current,
        x: current.x + 3,
        y: current.y - 4,
      }));
      const detailBefore = getStore().detailViewport;

      getStore().undo();

      expect(getStore().worldViewport).toEqual(worldBefore);
      expect(getStore().detailViewport).toEqual(detailBefore);

      getStore().redo();

      expect(getStore().worldViewport).toEqual(worldBefore);
      expect(getStore().detailViewport).toEqual(detailBefore);
    });

    it("keeps detail canvas zoom and viewport in one shared store camera", () => {
      const before = getStore().detailViewport;

      getStore().setZoom(2);

      expect(getStore().zoom).toBe(2);
      expect(getStore().detailViewport.scale).toBe(2);
      expect(getStore().detailViewport.w).toBeCloseTo(before.w / 2);

      const zoomed = getStore().detailViewport;
      getStore().setDetailViewport((current) => ({
        ...current,
        x: current.x + 5,
        y: current.y + 7,
      }));

      expect(getStore().detailViewport.x).toBeCloseTo(zoomed.x + 5);
      expect(getStore().detailViewport.y).toBeCloseTo(zoomed.y + 7);
    });
  });

  describe("multi-frame selection", () => {
    it("keeps the full frame selection in shared editor state", () => {
      const firstFrameId = getStore().selectedFrameId;
      getStore().addFrame();
      const secondFrameId = getStore().selectedFrameId;

      getStore().selectFrames([firstFrameId, secondFrameId], secondFrameId);

      expect(getStore().selectedFrameIds).toEqual([firstFrameId, secondFrameId]);
      expect(getStore().selectedFrameId).toBe(secondFrameId);
      expect(getStore().selectionKind).toBe("frame");
      expect(getStore().selectedLayerRefs).toEqual([]);
    });

    it("moves selected frames together and clears frame selection for a layer", () => {
      const firstFrameId = getStore().selectedFrameId;
      getStore().addFrame();
      const secondFrameId = getStore().selectedFrameId;
      const before = new Map(
        getStore().frames.map((frame) => [frame.id, { x: frame.x, y: frame.y }]),
      );
      getStore().selectFrames([firstFrameId, secondFrameId]);

      getStore().moveFrames(getStore().selectedFrameIds, 12, -7);

      for (const frameId of [firstFrameId, secondFrameId]) {
        const frame = getStore().frames.find((candidate) => candidate.id === frameId)!;
        expect(frame.x).toBe(before.get(frameId)!.x + 12);
        expect(frame.y).toBe(before.get(frameId)!.y - 7);
      }

      getStore().selectLayer(getStore().layers[0]!.id);
      expect(getStore().selectedFrameIds).toEqual([]);
      expect(getStore().selectionKind).toBe("layer");
    });

    it("fits the detail viewport when selecting a layer in another artboard", () => {
      const firstFrameId = getStore().selectedFrameId;
      getStore().addFrame();
      getStore().updateVector({
        width: 24,
        height: 12,
        viewportWidth: 120,
        viewportHeight: 60,
      });
      const secondFrame = getStore().frames.find(
        (frame) => frame.id === getStore().selectedFrameId,
      )!;

      getStore().selectFrame(firstFrameId);
      getStore().setDetailViewport({ x: -500, y: -500, w: 20, h: 20, scale: 1 });
      getStore().selectLayerRefs([{ ownerId: secondFrame.id, layerId: secondFrame.layers[0]!.id }]);

      expect(getStore().selectedFrameId).toBe(secondFrame.id);
      expect(getStore().vector).toEqual(secondFrame.vector);
      expect(getStore().detailViewport).toEqual(computeDetailViewport(secondFrame.vector));
    });

    it("restores frame selection through undo", () => {
      const firstFrameId = getStore().selectedFrameId;
      getStore().addFrame();
      const secondFrameId = getStore().selectedFrameId;
      getStore().selectFrames([firstFrameId, secondFrameId], firstFrameId);
      getStore().pushHistory();
      getStore().deselectAll();

      getStore().undo();

      expect(getStore().selectedFrameIds).toEqual([firstFrameId, secondFrameId]);
      expect(getStore().selectedFrameId).toBe(firstFrameId);
      expect(getStore().selectionKind).toBe("frame");
    });
  });

  describe("frame history", () => {
    it("undoes frame creation and duplication", () => {
      const originalCount = getStore().frames.length;

      getStore().addFrame();
      expect(getStore().frames).toHaveLength(originalCount + 1);
      getStore().undo();
      expect(getStore().frames).toHaveLength(originalCount);

      getStore().duplicateFrame();
      expect(getStore().frames).toHaveLength(originalCount + 1);
      getStore().undo();
      expect(getStore().frames).toHaveLength(originalCount);
    });

    it("undoes frame rename and deletion", () => {
      const original = getStore().frames[0];
      getStore().renameFrame(original.id, "Renamed frame");
      expect(getStore().frames[0].name).toBe("Renamed frame");
      getStore().undo();
      expect(getStore().frames[0].name).toBe(original.name);

      getStore().addFrame();
      const addedId = getStore().selectedFrameId;
      const count = getStore().frames.length;
      getStore().deleteFrame(addedId);
      expect(getStore().frames).toHaveLength(count - 1);
      getStore().undo();
      expect(getStore().frames.some((frame) => frame.id === addedId)).toBe(true);
    });

    it("does not create a history entry for a no-op rename", () => {
      const frame = getStore().frames[0];
      const historyLength = getStore().history.length;
      getStore().renameFrame(frame.id, frame.name);
      expect(getStore().history).toHaveLength(historyLength);
    });

    it("preserves the active document when deleting a different frame", () => {
      const activeFrameId = getStore().selectedFrameId;
      const deletedFrameId = getStore().frames.find((frame) => frame.id !== activeFrameId)!.id;
      const selectedLayerId = getStore().layers[0]!.id;
      getStore().selectLayer(selectedLayerId);

      getStore().deleteFrame(deletedFrameId);

      expect(getStore().selectedFrameId).toBe(activeFrameId);
      expect(getStore().selectedLayerId).toBe(selectedLayerId);
      expect(getStore().selectionKind).toBe("layer");
      expect(getStore().selectedLayerRefs).toEqual([
        { ownerId: activeFrameId, layerId: selectedLayerId },
      ]);
    });

    it("promotes selection to the fallback frame when deleting the active frame", () => {
      const deletedFrameId = getStore().selectedFrameId;
      getStore().selectLayer(getStore().layers[0]!.id);

      getStore().deleteFrame(deletedFrameId);

      expect(getStore().selectedFrameId).not.toBe(deletedFrameId);
      expect(getStore().selectionKind).toBe("frame");
      expect(getStore().hasCanvasSelection).toBe(true);
      expect(getStore().selectedFrameIds).toEqual([getStore().selectedFrameId]);
      expect(getStore().selectedLayerRefs).toEqual([]);
    });
  });

  describe("cross-frame layer reparenting", () => {
    it("persists the live active-owner projection through a store command", () => {
      const frame = getStore().frames[0];
      const layer = getStore().layers[0];
      useEditorStore.setState({
        layers: getStore().layers.map((candidate) =>
          candidate.id === layer.id ? { ...candidate, translateX: 17 } : candidate,
        ),
      });

      getStore().syncActiveOwner();

      expect(
        getStore()
          .frames.find((candidate) => candidate.id === frame.id)!
          .layers.find((candidate) => candidate.id === layer.id)!.translateX,
      ).toBe(17);
    });

    it("moves a document-wide selection across owners as one group", () => {
      const first = getStore().frames[0];
      const second = getStore().frames[1];
      const firstLayer = first.layers[0];
      const secondLayer = second.layers[0];
      const firstX = firstLayer.translateX ?? 0;
      const secondX = secondLayer.translateX ?? 0;

      getStore().selectLayerRefs([
        { ownerId: first.id, layerId: firstLayer.id },
        { ownerId: second.id, layerId: secondLayer.id },
      ]);
      getStore().translateSelectedLayer(7, -2);

      const state = getStore();
      expect(
        state.frames
          .find((frame) => frame.id === first.id)!
          .layers.find((layer) => layer.id === firstLayer.id)!.translateX,
      ).toBe(firstX + 7);
      expect(
        state.frames
          .find((frame) => frame.id === second.id)!
          .layers.find((layer) => layer.id === secondLayer.id)!.translateX,
      ).toBe(secondX + 7);
      expect(state.selectedLayerRefs).toEqual([
        { ownerId: first.id, layerId: firstLayer.id },
        { ownerId: second.id, layerId: secondLayer.id },
      ]);

      getStore().undo();
      expect(
        getStore()
          .frames.find((frame) => frame.id === first.id)!
          .layers.find((layer) => layer.id === firstLayer.id)!.translateX ?? 0,
      ).toBe(firstX);
    });

    it("Alt-duplicates every member of a cross-owner selection", () => {
      const first = getStore().frames[0];
      const second = getStore().frames[1];
      getStore().selectLayerRefs([
        { ownerId: first.id, layerId: first.layers[0].id },
        { ownerId: second.id, layerId: second.layers[0].id },
      ]);

      getStore().duplicateSelectedLayersOffset(3, 4);

      expect(getStore().selectedLayerRefs).toHaveLength(2);
      expect(new Set(getStore().selectedLayerRefs.map((ref) => ref.ownerId))).toEqual(
        new Set([first.id, second.id]),
      );
      expect(getStore().frames.find((frame) => frame.id === first.id)!.layers).toHaveLength(
        first.layers.length + 1,
      );
      expect(getStore().frames.find((frame) => frame.id === second.id)!.layers).toHaveLength(
        second.layers.length + 1,
      );
    });

    it("Alt-duplicated layers keep their animation tracks with remapped ids", () => {
      const layer = getStore().layers[0]!;
      const extraBlock = {
        id: "dup-alpha",
        layerId: layer.id,
        propertyName: "alpha",
        type: "number" as const,
        fromValue: 0,
        toValue: 1,
        startTime: 0,
        endTime: 400,
      };
      useEditorStore.setState((state) => ({
        animation: { ...state.animation, blocks: [...state.animation.blocks, extraBlock] },
        layers: state.layers.map((candidate) =>
          candidate.id === layer.id ? { ...candidate, timeline: [extraBlock] } : candidate,
        ),
      }));
      const blocksBefore = getStore().animation.blocks;

      getStore().duplicateSelectedLayersOffset(2, 3);

      const cloneId = getStore().selectedLayerIds[0];
      expect(cloneId).toBeDefined();
      const newBlocks = getStore().animation.blocks.slice(blocksBefore.length);
      // Every carried track targets the clone, never the original layer.
      const expectedCount = blocksBefore.filter(
        (block) => String(block.layerId) === String(layer.id),
      ).length;
      expect(newBlocks).toHaveLength(expectedCount);
      expect(newBlocks.length).toBeGreaterThan(0);
      expect(newBlocks.every((block) => String(block.layerId) === String(cloneId))).toBe(true);
      const beforeIds = new Set(blocksBefore.map((block) => block.id));
      expect(newBlocks.every((block) => !beforeIds.has(block.id))).toBe(true);
      // The clone's per-layer timeline mirrors its own remapped blocks.
      const clone = getStore().layers.find(
        (candidate) => String(candidate.id) === String(cloneId),
      )!;
      expect(clone.timeline!.map((block) => block.id).sort()).toEqual(
        newBlocks.map((block) => block.id).sort(),
      );
      // Original layer keeps its own track.
      const original = getStore().layers.find((candidate) => candidate.id === layer.id)!;
      expect(original.timeline!.map((block) => block.id)).toContain(extraBlock.id);
      expect(beforeIds.has(extraBlock.id)).toBe(true);
      expect(
        getStore().animation.blocks.filter((block) => block.id === extraBlock.id),
      ).toHaveLength(1);
    });

    it("Alt-duplicating a group carries descendant animation tracks without stale ids", () => {
      const first = getStore().layers[0]!;
      const second = getStore().layers[1]!;
      getStore().selectLayers([first.id, second.id]);
      getStore().groupSelectedLayers();
      const groupId = getStore().selectedLayerId;
      const childBlock = {
        id: "group-child-rot",
        layerId: second.id,
        propertyName: "rotation",
        type: "number" as const,
        fromValue: 0,
        toValue: 90,
        startTime: 0,
        endTime: 500,
      };
      useEditorStore.setState((state) => ({
        animation: { ...state.animation, blocks: [...state.animation.blocks, childBlock] },
        layers: state.layers.map((candidate) =>
          candidate.id === second.id ? { ...candidate, timeline: [childBlock] } : candidate,
        ),
      }));
      const blocksBefore = getStore().animation.blocks;

      getStore().duplicateSelectedLayersOffset(0, 0);

      const subtreeIds = new Set([groupId, first.id, second.id].map(String));
      const expectedCount = blocksBefore.filter((block) =>
        subtreeIds.has(String(block.layerId)),
      ).length;
      const newBlocks = getStore().animation.blocks.slice(blocksBefore.length);
      expect(newBlocks).toHaveLength(expectedCount);
      // No clone track points at an original layer id.
      expect(newBlocks.every((block) => !subtreeIds.has(String(block.layerId)))).toBe(true);
      const clonedGroup = getStore().layers.find(
        (candidate) => candidate.type === "group" && !subtreeIds.has(String(candidate.id)),
      )!;
      expect(clonedGroup).toBeDefined();
      const clonedChild = getStore().layers.find(
        (candidate) => String(candidate.parentId) === String(clonedGroup.id),
      )!;
      expect(clonedChild).toBeDefined();
      const childBlocks = newBlocks.filter(
        (block) => String(block.layerId) === String(clonedChild.id),
      );
      expect(childBlocks).toHaveLength(1);
      expect(clonedChild.timeline!.map((block) => block.id)).toEqual([childBlocks[0]!.id]);
    });

    it("records position motion tracks for every selected owner", () => {
      const first = getStore().frames[0];
      const second = getStore().frames[1];
      const firstLayer = first.layers[0];
      const secondLayer = second.layers[0];
      getStore().selectLayerRefs([
        { ownerId: first.id, layerId: firstLayer.id },
        { ownerId: second.id, layerId: secondLayer.id },
      ]);
      getStore().translateSelectedLayer(4, 3, { recordHistory: false });

      getStore().recordLayerTranslationAtPlayhead();

      const state = getStore();
      for (const [ownerId, layerId] of [
        [first.id, firstLayer.id],
        [second.id, secondLayer.id],
      ] as const) {
        const frame = state.frames.find((candidate) => candidate.id === ownerId)!;
        expect(
          frame.animation.blocks.some(
            (block) =>
              String(block.layerId) === String(layerId) && block.propertyName === "translateX",
          ),
        ).toBe(true);
      }
    });

    it("moves selected layers to the destination frame without changing world position", () => {
      const source = getStore().frames[0];
      const target = getStore().frames[1];
      const layer = getStore().layers[0];
      getStore().selectLayer(layer.id);
      getStore().translateSelectedLayer(43, -7, { recordHistory: false });

      const beforeWorld = {
        x: source.x + (getStore().layers[0].translateX ?? 0),
        y: source.y + (getStore().layers[0].translateY ?? 0),
      };
      expect(getStore().moveSelectedLayersToFrame(target.id)).toBe(true);

      const state = getStore();
      const sourceAfter = state.frames.find((frame) => frame.id === source.id)!;
      const targetAfter = state.frames.find((frame) => frame.id === target.id)!;
      const moved = targetAfter.layers.find((candidate) => candidate.id === layer.id)!;
      expect(sourceAfter.layers.some((candidate) => candidate.id === layer.id)).toBe(false);
      expect(targetAfter.x + (moved.translateX ?? 0)).toBeCloseTo(beforeWorld.x);
      expect(targetAfter.y + (moved.translateY ?? 0)).toBeCloseTo(beforeWorld.y);
      expect(state.selectedFrameId).toBe(target.id);
      expect(state.selectedLayerId).toBe(layer.id);
      expect(state.selectionKind).toBe("layer");
    });

    it("moves a same-frame multi-selection as one cross-frame transaction", () => {
      const source = getStore().frames[0];
      const target = getStore().frames[1];
      const movingIds = getStore()
        .layers.slice(0, 2)
        .map((layer) => layer.id);
      expect(movingIds).toHaveLength(2);
      getStore().selectLayers(movingIds);

      expect(getStore().moveSelectedLayersToFrame(target.id)).toBe(true);

      const state = getStore();
      const sourceAfter = state.frames.find((frame) => frame.id === source.id)!;
      const targetAfter = state.frames.find((frame) => frame.id === target.id)!;
      expect(sourceAfter.layers.filter((layer) => movingIds.includes(layer.id))).toHaveLength(0);
      expect(targetAfter.layers.filter((layer) => movingIds.includes(layer.id))).toHaveLength(2);
      expect(state.selectedLayerIds).toEqual(movingIds);
      expect(state.selectedLayerRefs).toEqual(
        movingIds.map((layerId) => ({ ownerId: target.id, layerId })),
      );

      getStore().undo();
      expect(
        getStore().frames[0].layers.filter((layer) => movingIds.includes(layer.id)),
      ).toHaveLength(2);
      expect(
        getStore().frames[1].layers.filter((layer) => movingIds.includes(layer.id)),
      ).toHaveLength(0);
    });

    it("keeps locked descendants attached when their unlocked group changes frames", () => {
      const source = getStore().frames[0];
      const target = getStore().frames[1];
      const child = getStore().layers[0]!;
      getStore().selectLayer(child.id);
      getStore().groupSelectedLayers();
      const groupId = getStore().selectedLayerId;
      getStore().toggleLayerLock(child.id);

      expect(getStore().moveSelectedLayersToFrame(target.id)).toBe(true);

      const state = getStore();
      const sourceAfter = state.frames.find((frame) => frame.id === source.id)!;
      const targetAfter = state.frames.find((frame) => frame.id === target.id)!;
      expect(sourceAfter.layers.some((layer) => String(layer.id) === String(child.id))).toBe(false);
      expect(targetAfter.layers).toContainEqual(
        expect.objectContaining({ id: child.id, parentId: groupId, locked: true }),
      );
      expect(targetAfter.layers).toContainEqual(expect.objectContaining({ id: groupId }));
    });

    it("does not move a locked selection root", () => {
      const source = getStore().frames[0];
      const target = getStore().frames[1];
      const layer = getStore().layers[0]!;
      getStore().selectLayer(layer.id);
      getStore().toggleLayerLock(layer.id);

      expect(getStore().moveSelectedLayersToFrame(target.id)).toBe(false);
      expect(getStore().selectedFrameId).toBe(source.id);
      expect(getStore().frames.find((frame) => frame.id === source.id)!.layers).toContainEqual(
        expect.objectContaining({ id: layer.id, locked: true }),
      );
    });

    it("places a cross-frame move atomically at the requested hierarchy position", () => {
      const source = getStore().frames[0];
      const target = getStore().frames[1];
      const moving = getStore().layers[0];
      const beforeId = target.layers[0]!.id;
      getStore().selectLayer(moving.id);

      expect(
        getStore().moveSelectedLayersToFrame(target.id, {
          placement: { parentId: null, beforeId },
        }),
      ).toBe(true);

      const targetAfter = getStore().frames.find((frame) => frame.id === target.id)!;
      expect(targetAfter.layers.findIndex((layer) => layer.id === moving.id)).toBeLessThan(
        targetAfter.layers.findIndex((layer) => layer.id === beforeId),
      );
      getStore().undo();
      expect(getStore().selectedFrameId).toBe(source.id);
      expect(getStore().frames[0].layers).toContainEqual(
        expect.objectContaining({ id: moving.id }),
      );
      expect(getStore().frames[1].layers).not.toContainEqual(
        expect.objectContaining({ id: moving.id }),
      );
    });

    it("moves the layer animation tracks and rebases position values", () => {
      const source = getStore().frames[0];
      const target = getStore().frames[1];
      const layer = getStore().layers[0];
      const xOffset = source.x - target.x;
      useEditorStore.setState((state) => ({
        animation: {
          ...state.animation,
          blocks: [
            ...state.animation.blocks,
            {
              id: "move-x",
              layerId: layer.id,
              propertyName: "translateX",
              fromValue: 2,
              toValue: 12,
              startTime: 0,
              endTime: 1200,
              type: "number" as const,
            },
          ],
        },
      }));
      getStore().selectLayer(layer.id);

      expect(getStore().moveSelectedLayersToFrame(target.id)).toBe(true);

      const sourceAfter = getStore().frames.find((frame) => frame.id === source.id)!;
      const targetAfter = getStore().frames.find((frame) => frame.id === target.id)!;
      expect(sourceAfter.animation.blocks.some((block) => block.id === "move-x")).toBe(false);
      const movedBlock = targetAfter.animation.blocks.find((block) => block.id === "move-x")!;
      expect(movedBlock.fromValue).toBe(2 + xOffset);
      expect(movedBlock.toValue).toBe(12 + xOffset);
      expect(targetAfter.animation.duration).toBeGreaterThanOrEqual(1200);
    });

    it("undo restores frame ownership and the active document projection", () => {
      const source = getStore().frames[0];
      const target = getStore().frames[1];
      const layer = getStore().layers[0];
      getStore().selectLayer(layer.id);

      getStore().moveSelectedLayersToFrame(target.id);
      getStore().undo();

      const state = getStore();
      expect(state.selectedFrameId).toBe(source.id);
      expect(state.frames.find((frame) => frame.id === source.id)?.layers).toContainEqual(
        expect.objectContaining({ id: layer.id }),
      );
      expect(state.frames.find((frame) => frame.id === target.id)?.layers).not.toContainEqual(
        expect.objectContaining({ id: layer.id }),
      );
      expect(state.layers).toContainEqual(expect.objectContaining({ id: layer.id }));
    });

    it("moves a frame child onto the page root without changing world position", () => {
      const source = getStore().frames[0];
      const layer = getStore().layers[0];
      getStore().selectLayer(layer.id);
      getStore().translateSelectedLayer(7, 9, { recordHistory: false });
      const expectedWorld = {
        x: source.x + 7,
        y: source.y + 9,
      };

      expect(getStore().moveSelectedLayersToRoot()).toBe(true);

      const state = getStore();
      const rootLayer = state.rootLayers.find((candidate) => candidate.id === layer.id)!;
      expect(state.selectedFrameId).toBe(PAGE_ROOT_ID);
      expect(rootLayer.translateX).toBeCloseTo(expectedWorld.x);
      expect(rootLayer.translateY).toBeCloseTo(expectedWorld.y);
      expect(state.frames[0].layers.some((candidate) => candidate.id === layer.id)).toBe(false);
      expect(state.layers).toContainEqual(expect.objectContaining({ id: layer.id }));
    });

    it("moves a page-root vector into a frame and preserves world position", () => {
      const source = getStore().frames[0];
      const target = getStore().frames[1];
      const layer = getStore().layers[0];
      getStore().selectLayer(layer.id);
      getStore().translateSelectedLayer(31, -4, { recordHistory: false });
      const worldBefore = { x: source.x + 31, y: source.y - 4 };
      getStore().moveSelectedLayersToRoot({ recordHistory: false });

      expect(getStore().moveSelectedLayersToFrame(target.id)).toBe(true);

      const moved = getStore()
        .frames.find((frame) => frame.id === target.id)!
        .layers.find((candidate) => candidate.id === layer.id)!;
      expect(target.x + (moved.translateX ?? 0)).toBeCloseTo(worldBefore.x);
      expect(target.y + (moved.translateY ?? 0)).toBeCloseTo(worldBefore.y);
      expect(getStore().rootLayers.some((candidate) => candidate.id === layer.id)).toBe(false);
    });

    it("undo restores a vector extracted to the page root", () => {
      const source = getStore().frames[0];
      const layer = getStore().layers[0];
      getStore().selectLayer(layer.id);

      getStore().moveSelectedLayersToRoot();
      getStore().undo();

      expect(getStore().selectedFrameId).toBe(source.id);
      expect(getStore().rootLayers).toHaveLength(0);
      expect(getStore().frames[0].layers).toContainEqual(expect.objectContaining({ id: layer.id }));
    });
  });

  describe("documentV2 freshness", () => {
    /**
     * Track-block geometry versions are parsed from id-less path strings on every
     * commit (parsePath mints fresh ULIDs), so equality is asserted modulo the
     * regenerated command ids — everything else must match exactly.
     */
    function canonicalize(documentV2: DocumentV2): string {
      return JSON.stringify({
        ...documentV2,
        geometryVersions: Object.fromEntries(
          Object.entries(documentV2.geometryVersions).map(([id, version]) => [
            id,
            {
              ...version,
              pathData: {
                subPaths: version.pathData.subPaths.map((subPath) => ({
                  commands: subPath.commands.map(({ type, points }) => ({ type, points })),
                })),
              },
            },
          ]),
        ),
      });
    }
    it("commits live projection into documentV2 after burst writes settle, even mid-gesture without history", async () => {
      const layer = getStore().layers[0];
      const beforeHistory = getStore().history.length;

      // In-flight gesture write: no history entry, plain projection update.
      useEditorStore.setState({
        layers: getStore().layers.map((candidate) =>
          candidate.id === layer.id
            ? { ...candidate, translateX: (candidate.translateX ?? 0) + 9 }
            : candidate,
        ),
      });

      // The coalesced rebuild lands at the microtask boundary — before any
      // React render or subsequent input event.
      await Promise.resolve();

      expect(getStore().history).toHaveLength(beforeHistory);
      const node =
        getStore().documentV2.nodes[
          `node:${encodeURIComponent(getStore().selectedFrameId)}:${encodeURIComponent(String(layer.id))}`
        ]!;
      expect(node.transform.translateX).toBe(9);
    });

    it("keeps documentV2 equal to a fresh commit of the flushed workspace after pushHistory", async () => {
      useEditorStore.setState({
        layers: getStore().layers.map((candidate) => ({
          ...candidate,
          name: `${candidate.name}!`,
        })),
      });

      await Promise.resolve();

      getStore().pushHistory();

      const state = getStore();
      expect(canonicalize(state.documentV2)).toBe(canonicalize(commitDocumentV2(state)));
    });

    it("commits geometry through a magic-tool write", async () => {
      const layer = getStore().layers[0];
      getStore().selectLayer(layer.id);
      const node = () => {
        const state = getStore();
        const nodeId = `node:${encodeURIComponent(state.selectedFrameId)}:${encodeURIComponent(
          String(layer.id),
        )}`;
        return state.documentV2.geometryVersions[
          state.documentV2.nodes[nodeId]!.geometryVersionId!
        ]!.sourceHash;
      };
      const before = node();

      getStore().reverseSelectedLayer();
      await Promise.resolve();

      expect(node()).not.toBe(before);
    });

    it("coalesces burst writes into one documentV2 rebuild at the microtask boundary", async () => {
      const layer = getStore().layers[0];
      const before = getStore().documentV2;
      let commitCount = 0;
      const unsubscribe = useEditorStore.subscribe((state, prevState) => {
        if (state.documentV2 !== prevState.documentV2) commitCount++;
      });

      for (let tick = 1; tick <= 5; tick++) {
        useEditorStore.setState({
          layers: getStore().layers.map((candidate) =>
            candidate.id === layer.id
              ? { ...candidate, translateX: (candidate.translateX ?? 0) + 1 }
              : candidate,
          ),
        });
      }

      // The rebuild is deferred: nothing has landed synchronously.
      expect(commitCount).toBe(0);
      await Promise.resolve();
      await Promise.resolve();

      expect(commitCount).toBe(1);
      expect(getStore().documentV2).not.toBe(before);
      const node =
        getStore().documentV2.nodes[
          `node:${encodeURIComponent(getStore().selectedFrameId)}:${encodeURIComponent(String(layer.id))}`
        ]!;
      expect(node.transform.translateX).toBe(5);
      unsubscribe();
    });

    it("forwards zustand's replace argument instead of silently merging", () => {
      const baseline = useEditorStore.getState();
      try {
        // A one-key replacement: with correct forwarding every other key vanishes;
        // the old merge shim kept them, lying about the API.
        useEditorStore.setState({ selectedLayerId: 999 } as unknown as EditorState, true);
        expect(getStore().selectedLayerId).toBe(999);
        expect(getStore().layers).toBeUndefined();
      } finally {
        useEditorStore.setState(baseline, true);
      }
      expect(getStore().layers).toEqual(baseline.layers);
    });

    it("a patch carrying documentV2 supersedes a pending coalesced commit", async () => {
      const layer = getStore().layers[0];
      const replacement = structuredClone(getStore().documentV2);
      let commitCount = 0;
      const unsubscribe = useEditorStore.subscribe((state, prevState) => {
        if (state.documentV2 !== prevState.documentV2) commitCount++;
      });

      useEditorStore.setState({
        layers: getStore().layers.map((candidate) =>
          candidate.id === layer.id
            ? { ...candidate, translateX: (candidate.translateX ?? 0) + 3 }
            : candidate,
        ),
      });
      useEditorStore.setState({ documentV2: replacement });

      await Promise.resolve();
      await Promise.resolve();

      expect(commitCount).toBe(1);
      expect(getStore().documentV2).toBe(replacement);
      unsubscribe();
    });
  });

  // ─── Layer CRUD ──────────────────────────────────────────────────────
  describe("layer CRUD", () => {
    it("reparents a layer into and out of a group at an exact hierarchy position", () => {
      const ownerId = getStore().selectedFrameId;
      const [first, second] = getStore().layers;
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      getStore().selectLayer(first.id);
      getStore().groupSelectedLayers();
      const groupId = getStore().selectedLayerId;

      expect(getStore().reparentOwnedLayer(ownerId, second.id, { parentId: groupId })).toBe(true);
      expect(
        getStore().layers.find((layer) => String(layer.id) === String(second.id))?.parentId,
      ).toBe(groupId);

      expect(
        getStore().reparentOwnedLayer(ownerId, second.id, {
          parentId: null,
          afterId: groupId,
        }),
      ).toBe(true);
      const groupIndex = getStore().layers.findIndex(
        (layer) => String(layer.id) === String(groupId),
      );
      const firstChildIndex = getStore().layers.findIndex(
        (layer) => String(layer.id) === String(first.id),
      );
      const secondIndex = getStore().layers.findIndex(
        (layer) => String(layer.id) === String(second.id),
      );
      expect(secondIndex).toBeGreaterThan(groupIndex);
      expect(secondIndex).toBeGreaterThan(firstChildIndex);
      expect(getStore().layers[secondIndex]?.parentId ?? null).toBeNull();
    });

    it("refuses to move a group inside its own descendant", () => {
      const ownerId = getStore().selectedFrameId;
      const first = getStore().layers[0]!;
      getStore().selectLayer(first.id);
      getStore().groupSelectedLayers();
      const groupId = getStore().selectedLayerId;

      expect(getStore().reparentOwnedLayer(ownerId, groupId, { parentId: first.id })).toBe(false);
      expect(
        getStore().layers.find((layer) => String(layer.id) === String(groupId))?.parentId ?? null,
      ).toBeNull();
    });

    it("renames and reorders a layer in a non-active frame without changing the active owner", () => {
      const activeFrameId = getStore().selectedFrameId;
      const targetFrame = getStore().frames.find((frame) => frame.id !== activeFrameId)!;
      const firstId = targetFrame.layers[0]!.id;

      getStore().renameOwnedLayer(targetFrame.id, firstId, "Renamed remotely");
      getStore().reorderOwnedLayer(targetFrame.id, firstId, targetFrame.layers.length - 1);

      const updated = getStore().frames.find((frame) => frame.id === targetFrame.id)!;
      expect(updated.layers.find((layer) => layer.id === firstId)?.name).toBe("Renamed remotely");
      expect(updated.layers.at(-1)?.id).toBe(firstId);
      expect(getStore().selectedFrameId).toBe(activeFrameId);
      expect(getStore().canUndo).toBe(true);
    });

    describe("addLayer", () => {
      it("adds a new path layer to the end of layers", () => {
        const before = getStore().layers.length;
        getStore().addLayer("path");
        expect(getStore().layers.length).toBe(before + 1);
        const added = getStore().layers[getStore().layers.length - 1];
        expect(added.name).toContain("Path layer");
        expect(added.type).toBe("path");
        expect(added.visible).toBe(true);
        expect(added.locked).toBe(false);
      });

      it("selects the newly added layer", () => {
        getStore().addLayer("path");
        const added = getStore().layers[getStore().layers.length - 1];
        expect(getStore().selectedLayerId).toBe(added.id);
      });

      it("adds a clipPath layer with correct defaults", () => {
        getStore().addLayer("clipPath");
        const added = getStore().layers[getStore().layers.length - 1];
        expect(added.type).toBe("clipPath");
        expect(added.name).toContain("Clip path");
      });

      it("defaults to 'path' type when no argument", () => {
        getStore().addLayer();
        const added = getStore().layers[getStore().layers.length - 1];
        expect(added.type).toBe("path");
      });

      it("pushes history on add", () => {
        getStore().addLayer();
        expect(getStore().canUndo).toBe(true);
      });

      it("clears selection on add", () => {
        getStore().selectPoint(makeSelection(0));
        expect(getStore().selection).not.toBeNull();
        getStore().addLayer();
        expect(getStore().selection).toBeNull();
      });
    });

    describe("deleteLayer", () => {
      /** Default project has 1 layer per frame — seed a second layer for delete tests. */
      function ensureTwoLayers() {
        if (getStore().layers.length < 2) getStore().addLayer("path");
      }

      it("deletes a layer by id", () => {
        ensureTwoLayers();
        const initialCount = getStore().layers.length;
        const targetId = getStore().layers[1].id;
        getStore().deleteLayer(targetId);
        expect(getStore().layers.length).toBe(initialCount - 1);
        expect(getStore().layers.find((l) => l.id === targetId)).toBeUndefined();
      });

      it("selects first remaining layer if deleted was selected", () => {
        ensureTwoLayers();
        const targetId = getStore().layers[1].id;
        getStore().selectLayer(targetId);
        getStore().deleteLayer(targetId);
        expect(getStore().selectedLayerId).toBe(getStore().layers[0].id);
      });

      it("does NOT delete if only 1 layer remains", () => {
        while (getStore().layers.length > 1) {
          getStore().deleteLayer(getStore().layers[getStore().layers.length - 1].id);
        }
        expect(getStore().layers.length).toBe(1);
        getStore().deleteLayer(getStore().layers[0].id);
        expect(getStore().layers.length).toBe(1);
      });

      it("pushes history on delete", () => {
        ensureTwoLayers();
        getStore().deleteLayer(getStore().layers[1].id);
        expect(getStore().canUndo).toBe(true);
      });

      it("clears selection on delete", () => {
        ensureTwoLayers();
        getStore().selectPoint(makeSelection(getStore().layers[0].id));
        getStore().deleteLayer(getStore().layers[1].id);
        expect(getStore().selection).toBeNull();
      });

      it("removes animation tracks owned by the deleted layer", () => {
        ensureTwoLayers();
        const targetId = getStore().layers[1].id;
        getStore().addTimelineBlock(targetId, "rotation");
        expect(getStore().animation.blocks.some((block) => block.layerId === targetId)).toBe(true);

        getStore().deleteLayer(targetId);

        expect(getStore().animation.blocks.some((block) => block.layerId === targetId)).toBe(false);
      });
    });

    describe("toggleLayerVisibility", () => {
      it("toggles visibility of a layer", () => {
        const target = getStore().layers[0];
        const before = target.visible;
        getStore().toggleLayerVisibility(target.id);
        const after = getStore().layers.find((l) => l.id === target.id)!.visible;
        expect(after).toBe(!before);
      });

      it("pushes history on visibility toggle", () => {
        getStore().toggleLayerVisibility(getStore().layers[0].id);
        expect(getStore().canUndo).toBe(true);
      });
    });

    describe("toggleLayerExpanded", () => {
      it("toggles expanded state", () => {
        const target = getStore().layers[0];
        // expanded starts as undefined; store logic: expanded = (expanded === false)
        // undefined === false → false, so first toggle sets expanded=false
        getStore().toggleLayerExpanded(target.id);
        expect(getStore().layers.find((l) => l.id === target.id)!.expanded).toBe(false);
        getStore().toggleLayerExpanded(target.id);
        expect(getStore().layers.find((l) => l.id === target.id)!.expanded).toBe(true);
      });
    });

    describe("convertLayerType", () => {
      it("converts layer type to clipPath", () => {
        const target = getStore().layers[0];
        getStore().convertLayerType(target.id, "clipPath");
        expect(getStore().layers.find((l) => l.id === target.id)!.type).toBe("clipPath");
      });

      it("pushes history on convert", () => {
        getStore().convertLayerType(getStore().layers[0].id, "clipPath");
        expect(getStore().canUndo).toBe(true);
      });
    });
  });

  // ─── Selection ───────────────────────────────────────────────────────
  describe("selection", () => {
    describe("selectLayer", () => {
      it("changes selectedLayerId", () => {
        getStore().addLayer("path");
        const targetId = getStore().layers[1].id;
        getStore().selectLayer(targetId);
        expect(getStore().selectedLayerId).toBe(targetId);
      });

      it("clears point selection", () => {
        getStore().addLayer("path");
        getStore().selectPoint(makeSelection(getStore().layers[0].id));
        expect(getStore().selection).not.toBeNull();
        getStore().selectLayer(getStore().layers[1].id);
        expect(getStore().selection).toBeNull();
        expect(getStore().selectedPoints).toEqual([]);
      });
    });

    describe("selectPoint", () => {
      it("sets selection with a valid selection", () => {
        const sel = makeSelection(0);
        getStore().selectPoint(sel);
        expect(getStore().selection).toEqual(sel);
      });

      it("clears selection when null is passed", () => {
        getStore().selectPoint(makeSelection(0));
        getStore().selectPoint(null);
        expect(getStore().selection).toBeNull();
        expect(getStore().selectedPoints).toEqual([]);
      });

      it("sets selectedPoints to single-item array by default", () => {
        const sel = makeSelection(0);
        getStore().selectPoint(sel);
        expect(getStore().selectedPoints).toHaveLength(1);
      });

      it("adds to multi-selection when addToMulti=true", () => {
        const sel1 = makeSelection(0);
        const sel2: Selection = { ...makeSelection(0), commandIndex: 1, pointIndex: 0 };
        getStore().selectPoint(sel1);
        getStore().selectPoint(sel2, true);
        expect(getStore().selectedPoints.length).toBeGreaterThanOrEqual(2);
      });

      it("removes from multi-selection if same point added again with addToMulti", () => {
        const sel = makeSelection(0);
        getStore().selectPoint(sel);
        getStore().selectPoint(sel, true);
        expect(getStore().selectedPoints).toHaveLength(1);
      });

      it("keeps primary selection when toggling off other points", () => {
        const sel1 = makeSelection(0);
        const sel2: Selection = { ...makeSelection(0), commandIndex: 1, pointIndex: 0 };
        getStore().selectPoint(sel1);
        getStore().selectPoint(sel2, true);
        getStore().selectPoint(sel2, true);
        expect(getStore().selectedPoints).toHaveLength(1);
        expect(getStore().selectedPoints[0]).toEqual(sel1);
      });
    });

    describe("selectMultiplePoints", () => {
      it("sets multiple selected points", () => {
        const sels = [makeSelection(0), { ...makeSelection(0), commandIndex: 1 }];
        getStore().selectMultiplePoints(sels);
        expect(getStore().selectedPoints).toHaveLength(2);
        expect(getStore().selection).toEqual(sels[0]);
      });

      it("sets selection to first point or null if empty", () => {
        getStore().selectMultiplePoints([]);
        expect(getStore().selection).toBeNull();
      });
    });

    describe("clearSelection", () => {
      it("clears both selection and selectedPoints", () => {
        getStore().selectPoint(makeSelection(0));
        getStore().clearSelection();
        expect(getStore().selection).toBeNull();
        expect(getStore().selectedPoints).toEqual([]);
      });
    });

    describe("getCurrentSelectedPoint", () => {
      it("returns the selected point coordinates", () => {
        const layer = getStore().layers[0];
        const sel: Selection = {
          layerId: layer.id,
          side: "from",
          subPathIndex: 0,
          commandIndex: 0,
          pointIndex: 0,
        };
        getStore().selectPoint(sel);
        const pt = getStore().getCurrentSelectedPoint();
        expect(pt).not.toBeNull();
        expect(pt!.x).toBeDefined();
        expect(pt!.y).toBeDefined();
      });

      it("returns null when no selection", () => {
        getStore().clearSelection();
        expect(getStore().getCurrentSelectedPoint()).toBeNull();
      });

      it("returns null when layer not found", () => {
        const sel: Selection = {
          layerId: 99999,
          side: "from",
          subPathIndex: 0,
          commandIndex: 0,
          pointIndex: 0,
        };
        getStore().selectPoint(sel);
        expect(getStore().getCurrentSelectedPoint()).toBeNull();
      });
    });
  });

  // ─── Undo / Redo ────────────────────────────────────────────────────
  describe("undo/redo", () => {
    it("resetProject pushes history, so canUndo=true after fresh store", () => {
      freshStore();
      expect(getStore().canUndo).toBe(true);
      expect(getStore().canRedo).toBe(false);
    });

    it("canUndo=true after a mutation", () => {
      getStore().addLayer();
      expect(getStore().canUndo).toBe(true);
    });

    it("undo restores previous state", () => {
      const originalCount = getStore().layers.length;
      getStore().addLayer();
      expect(getStore().layers.length).toBe(originalCount + 1);
      getStore().undo();
      expect(getStore().layers.length).toBe(originalCount);
    });

    it("canRedo=true after undo", () => {
      getStore().addLayer();
      getStore().undo();
      expect(getStore().canRedo).toBe(true);
    });

    it("redo restores undone state", () => {
      const originalCount = getStore().layers.length;
      getStore().addLayer();
      getStore().undo();
      getStore().redo();
      expect(getStore().layers.length).toBe(originalCount + 1);
    });

    it("restores the page-root projection through undo and redo", () => {
      const sourceFrame = structuredClone(getStore().frames[0]!);
      const rootLayer = {
        ...structuredClone(sourceFrame.layers[0]!),
        id: "root-history-layer",
        name: "Hidden page-root layer",
        visible: true,
      };
      const rootVector = {
        id: "page",
        name: "Document page",
        width: 360,
        height: 180,
        alpha: 0.65,
        viewportWidth: 720,
        viewportHeight: 360,
        widthUnit: "dp",
        heightUnit: "dp",
        tint: "#336699",
        tintMode: "src_in",
        autoMirrored: true,
        minSdk: 24,
      };
      const rootAnimation = {
        id: "page-history-motion",
        name: "Page history motion",
        duration: 1700,
        blocks: [],
      };
      const snapshot: LegacyDocumentSnapshot = {
        id: "root-history-document",
        name: "Root history document",
        frames: [
          {
            ...sourceFrame,
            id: "frame-history",
            name: "Frame projection",
            vector: {
              ...sourceFrame.vector,
              id: "frame-history",
              name: "Frame projection",
              width: 23,
              height: 17,
              alpha: 0.4,
            },
            animation: {
              ...sourceFrame.animation,
              id: "frame-history-motion",
              name: "Frame history motion",
              duration: 700,
              blocks: [],
            },
            hiddenLayerIds: [String(sourceFrame.layers[0]!.id)],
          },
        ],
        rootLayers: [rootLayer],
        rootVector,
        rootAnimation,
        rootHiddenLayerIds: [String(rootLayer.id)],
      };

      getStore().loadDocument(snapshot);
      getStore().selectRootLayer(rootLayer.id);
      getStore().setAnimationDuration(2200);

      getStore().undo();

      expect(getStore().selectedFrameId).toBe(PAGE_ROOT_ID);
      expect(getStore().vector).toEqual(rootVector);
      expect(getStore().animation).toMatchObject({
        name: rootAnimation.name,
        duration: rootAnimation.duration,
        blocks: rootAnimation.blocks,
      });
      expect(getStore().hiddenLayerIds).toEqual([String(rootLayer.id)]);
      expect(getStore().detailViewport.w).toBeGreaterThanOrEqual(rootVector.viewportWidth!);
      expect(getStore().detailViewport.h).toBeGreaterThanOrEqual(rootVector.viewportHeight!);

      getStore().redo();

      expect(getStore().selectedFrameId).toBe(PAGE_ROOT_ID);
      expect(getStore().vector).toEqual(rootVector);
      expect(getStore().animation).toMatchObject({
        name: rootAnimation.name,
        duration: 2200,
        blocks: rootAnimation.blocks,
      });
      expect(getStore().hiddenLayerIds).toEqual([String(rootLayer.id)]);
      expect(getStore().detailViewport.w).toBeGreaterThanOrEqual(rootVector.viewportWidth!);
      expect(getStore().detailViewport.h).toBeGreaterThanOrEqual(rootVector.viewportHeight!);
    });

    it("new mutation clears redo stack", () => {
      getStore().addLayer();
      getStore().undo();
      expect(getStore().canRedo).toBe(true);
      getStore().addLayer();
      expect(getStore().canRedo).toBe(false);
    });

    it("cancels an in-flight transaction without leaving an undo entry", () => {
      const layer = getStore().layers[0];
      getStore().selectLayer(layer.id);
      const beforeHistory = getStore().history.length;
      const beforeX = layer.translateX ?? 0;

      getStore().pushHistory();
      getStore().translateSelectedLayer(12, 0, { recordHistory: false });
      getStore().cancelLastHistoryTransaction();

      expect(getStore().layers[0].translateX ?? 0).toBe(beforeX);
      expect(getStore().history).toHaveLength(beforeHistory);
      expect(getStore().canRedo).toBe(false);
    });

    it("preserves the redo branch when a history-backed gesture is cancelled", () => {
      const layer = getStore().layers[0];
      getStore().selectLayer(layer.id);
      const startX = layer.translateX ?? 0;
      getStore().translateSelectedLayer(20, 0);
      getStore().undo();
      expect(getStore().canRedo).toBe(true);
      expect(getStore().layers[0].translateX ?? 0).toBe(startX);

      getStore().pushHistory();
      getStore().translateSelectedLayer(5, 0, { recordHistory: false });
      getStore().cancelLastHistoryTransaction();

      expect(getStore().layers[0].translateX ?? 0).toBe(startX);
      expect(getStore().canRedo).toBe(true);
      getStore().redo();
      expect(getStore().layers[0].translateX ?? 0).toBeCloseTo(startX + 20);
    });

    it("can duplicate inside an existing gesture transaction", () => {
      const layer = getStore().layers[0];
      getStore().selectLayer(layer.id);
      const beforeHistory = getStore().history.length;
      const beforeLayers = getStore().layers.length;

      getStore().duplicateSelectedLayersOffset(0, 0, { recordHistory: false });

      expect(getStore().layers).toHaveLength(beforeLayers + 1);
      expect(getStore().history).toHaveLength(beforeHistory);
    });

    it("undo is no-op when history is empty", () => {
      freshStore();
      const count = getStore().layers.length;
      getStore().undo();
      expect(getStore().layers.length).toBe(count);
    });

    it("redo is no-op when future is empty", () => {
      freshStore();
      const count = getStore().layers.length;
      getStore().redo();
      expect(getStore().layers.length).toBe(count);
    });

    it("pushHistory caps history at 100 entries", () => {
      for (let i = 0; i < 110; i++) {
        getStore().pushHistory();
      }
      expect(getStore().history.length).toBeLessThanOrEqual(100);
    });

    it("undo and redo preserve the overflow entry for cancelLastHistoryTransaction", () => {
      for (let i = 0; i < 105; i++) {
        getStore().pushHistory();
      }
      const overflow = getStore().historyOverflow;
      expect(overflow).not.toBeNull();

      getStore().undo();
      expect(getStore().historyOverflow).toBe(overflow);
      getStore().redo();
      expect(getStore().historyOverflow).toBe(overflow);

      const depthBefore = getStore().history.length;
      getStore().cancelLastHistoryTransaction();
      // The cancelled push pops off and the displaced oldest entry is restored
      // at the front — navigation depth is not permanently shrunk.
      expect(getStore().history.length).toBe(depthBefore);
      expect(getStore().history[0]).toBe(overflow);
      expect(getStore().historyOverflow).toBeNull();
    });

    it("resetProject carries a fresh documentV2 in the same write", () => {
      useEditorStore.setState({
        layers: getStore().layers.map((candidate) => ({
          ...candidate,
          name: "Mutated before reset",
        })),
      });

      const state = getStore();
      state.resetProject();

      const fresh = getStore();
      // Same-task readers see the reset projection committed, not the previous
      // document; a later flush must be a no-op.
      expect(canonicalize(fresh.documentV2)).toBe(canonicalize(commitDocumentV2(fresh)));
    });

    it("updateVector on the page root keeps documentV2 fresh in-task, including omitted fields", async () => {
      const rootLayer = structuredClone(getStore().frames[0]!.layers[0]!);
      const snapshot: LegacyDocumentSnapshot = {
        id: "page-vector-fresh",
        name: "Page vector fresh",
        frames: [],
        rootLayers: [rootLayer],
        rootVector: {
          id: "page",
          name: "Original page",
          width: 48,
          height: 32,
          alpha: 1,
          tint: "#112233",
          widthUnit: "dp",
          heightUnit: "dp",
        },
        rootAnimation: { id: "page-anim", name: "Page anim", duration: 1000, blocks: [] },
        rootHiddenLayerIds: [],
      };
      getStore().loadDocument(snapshot);
      getStore().selectRootLayer(rootLayer.id);

      // Patch only the name: every other page field must survive from live
      // state, not from a stale documentV2.page spread.
      getStore().updateVector({ name: "Renamed page" });

      let fresh = getStore();
      expect(fresh.documentV2.page.name).toBe("Renamed page");
      expect(fresh.vector.name).toBe("Renamed page");
      expect(fresh.documentV2.page.width).toBe(48);
      expect(fresh.documentV2.page.tint).toBe("#112233");
      expect(fresh.documentV2.page.widthUnit).toBe("dp");
      expect(canonicalize(fresh.documentV2)).toBe(canonicalize(commitDocumentV2(fresh)));

      await Promise.resolve();
      await Promise.resolve();
      fresh = getStore();
      expect(canonicalize(fresh.documentV2)).toBe(canonicalize(commitDocumentV2(fresh)));
    });
  });

  // ─── ToolMode ────────────────────────────────────────────────────────
  describe("toolMode", () => {
    it("defaults to Select so objects, not vector points, are the initial target", () => {
      expect(getStore().toolMode).toBe("select");
    });

    it("setToolMode changes the mode", () => {
      getStore().setToolMode("pen");
      expect(getStore().toolMode).toBe("pen");
      getStore().setToolMode("direct");
      expect(getStore().toolMode).toBe("direct");
      getStore().setToolMode("hand");
      expect(getStore().toolMode).toBe("hand");
    });
  });

  // ─── Playback ────────────────────────────────────────────────────────
  describe("playback", () => {
    it("defaults: not playing, progress 0, speed 1, not slow, repeating", () => {
      freshStore();
      expect(getStore().isPlaying).toBe(false);
      expect(getStore().progress).toBe(0);
      expect(getStore().speed).toBe(1);
      expect(getStore().isSlowMotion).toBe(false);
      expect(getStore().isRepeating).toBe(true);
    });

    it("togglePlayback flips isPlaying", () => {
      getStore().togglePlayback();
      expect(getStore().isPlaying).toBe(true);
      getStore().togglePlayback();
      expect(getStore().isPlaying).toBe(false);
    });

    it("setProgress clamps to [0, 1]", () => {
      getStore().setProgress(0.5);
      expect(getStore().progress).toBe(0.5);
      getStore().setProgress(-1);
      expect(getStore().progress).toBe(0);
      getStore().setProgress(2);
      expect(getStore().progress).toBe(1);
    });

    it("setSpeed updates speed", () => {
      getStore().setSpeed(2);
      expect(getStore().speed).toBe(2);
    });

    it("toggleSlowMotion flips isSlowMotion", () => {
      getStore().toggleSlowMotion();
      expect(getStore().isSlowMotion).toBe(true);
      getStore().toggleSlowMotion();
      expect(getStore().isSlowMotion).toBe(false);
    });

    it("toggleRepeating flips isRepeating", () => {
      getStore().toggleRepeating();
      expect(getStore().isRepeating).toBe(false);
      getStore().toggleRepeating();
      expect(getStore().isRepeating).toBe(true);
    });
  });

  // ─── Path Mutation Actions ──────────────────────────────────────────
  describe("path mutation actions", () => {
    describe("updateSelectedPoint", () => {
      it("updates the selected point coordinates on the from side", () => {
        const layer = getStore().layers[0];
        const sel: Selection = {
          layerId: layer.id,
          side: "from",
          subPathIndex: 0,
          commandIndex: 0,
          pointIndex: 0,
        };
        getStore().selectPoint(sel);
        getStore().updateSelectedPoint({ x: 99, y: 88 });
        const updated = getStore().layers.find((l) => l.id === layer.id)!;
        const pt = updated.from.subPaths[0].commands[0].points[0];
        expect(pt.x).toBe(99);
        expect(pt.y).toBe(88);
      });

      it("updates the selected point on the to side", () => {
        const layer = getStore().layers[0];
        getStore().setEditingSide("to");
        const sel: Selection = {
          layerId: layer.id,
          side: "to",
          subPathIndex: 0,
          commandIndex: 0,
          pointIndex: 0,
        };
        getStore().selectPoint(sel);
        getStore().updateSelectedPoint({ x: 42, y: 42 });
        const updated = getStore().layers.find((l) => l.id === layer.id)!;
        const pt = updated.to!.subPaths[0].commands[0].points[0];
        expect(pt.x).toBe(42);
        expect(pt.y).toBe(42);
      });

      it("no-op when no selection", () => {
        const before = pathToString(getStore().layers[0].from);
        getStore().clearSelection();
        getStore().updateSelectedPoint({ x: 999, y: 999 });
        expect(pathToString(getStore().layers[0].from)).toBe(before);
      });

      it("respects recordHistory=false option", () => {
        freshStore();
        const originalHistoryLen = getStore().history.length;
        getStore().selectPoint(makeSelection(getStore().layers[0].id));
        getStore().updateSelectedPoint({ x: 10, y: 10 }, { recordHistory: false });
        expect(getStore().history.length).toBe(originalHistoryLen);
      });
    });

    describe("addPointOnPath", () => {
      it("adds a point near the click location on from side", () => {
        getStore().addPointOnPath(5, 5);
        expect(getStore().canUndo).toBe(true);
      });

      it("no-op when selected layer is not found", () => {
        useEditorStore.setState({ selectedLayerId: 99999 });
        const beforeCount = getStore().layers.length;
        getStore().addPointOnPath(5, 5);
        expect(getStore().layers.length).toBe(beforeCount);
      });
    });

    describe("deleteSelectedPoint", () => {
      it("deletes the selected command from the path", () => {
        const layer = getStore().layers[0];
        const sel: Selection = {
          layerId: layer.id,
          side: "from",
          subPathIndex: 0,
          commandIndex: 1, // second command
          pointIndex: 0,
        };
        const beforeCmds = drawCommandCount(layer, "from");
        getStore().selectPoint(sel);
        getStore().deleteSelectedPoint();
        const after = getStore().layers.find((l) => l.id === layer.id)!;
        const afterCmds = drawCommandCount(after, "from");
        expect(afterCmds).toBe(beforeCmds - 1);
      });

      it("clears selection after delete", () => {
        getStore().selectPoint(makeSelection(getStore().layers[0].id));
        getStore().deleteSelectedPoint();
        expect(getStore().selection).toBeNull();
      });

      it("no-op when no selection", () => {
        const before = pathToString(getStore().layers[0].from);
        getStore().clearSelection();
        getStore().deleteSelectedPoint();
        expect(pathToString(getStore().layers[0].from)).toBe(before);
      });
    });

    describe("deleteSelectedSubPath", () => {
      it("deletes the entire subpath containing the selection", () => {
        const layer = getStore().layers[0];
        const subPathCount = layer.from.subPaths.length;
        if (subPathCount <= 1) {
          getStore().selectPoint(makeSelection(layer.id));
          getStore().deleteSelectedSubPath();
          return;
        }
        const sel = makeSelection(layer.id);
        getStore().selectPoint(sel);
        getStore().deleteSelectedSubPath();
        const updated = getStore().layers.find((l) => l.id === layer.id)!;
        expect(updated.from.subPaths.length).toBe(subPathCount - 1);
      });

      it("clears selection and selectedPoints after delete", () => {
        getStore().selectPoint(makeSelection(getStore().layers[0].id));
        getStore().deleteSelectedSubPath();
        expect(getStore().selection).toBeNull();
        expect(getStore().selectedPoints).toEqual([]);
      });
    });

    describe("splitSelectedCommand", () => {
      it("splits the selected command in half", () => {
        const layer = getStore().layers[0];
        const sel: Selection = {
          layerId: layer.id,
          side: "from",
          subPathIndex: 0,
          commandIndex: 1,
          pointIndex: 0,
        };
        const beforeCmds = layer.from.subPaths[0].commands.length;
        getStore().selectPoint(sel);
        getStore().splitSelectedCommand();
        const updated = getStore().layers.find((l) => l.id === layer.id)!;
        expect(updated.from.subPaths[0].commands.length).toBeGreaterThan(beforeCmds);
      });

      it("no-op when no selection", () => {
        const before = pathToString(getStore().layers[0].from);
        getStore().clearSelection();
        getStore().splitSelectedCommand();
        expect(pathToString(getStore().layers[0].from)).toBe(before);
      });
    });

    describe("splitSelectedLayerSegment", () => {
      it("splits matching from and to segments and selects the inserted midpoint", () => {
        const layer = getStore().layers[0];
        const beforeFrom = layer.from.subPaths[0].commands.length;
        const beforeTo = layer.to!.subPaths[0].commands.length;
        getStore().splitSelectedLayerSegment({
          layerId: layer.id,
          side: "from",
          subPathIndex: 0,
          commandIndex: 1,
        });
        const updated = getStore().layers.find((l) => l.id === layer.id)!;
        expect(updated.from.subPaths[0].commands.length).toBe(beforeFrom + 1);
        expect(updated.to!.subPaths[0].commands.length).toBe(beforeTo + 1);
        expect(getStore().selection).toMatchObject({
          layerId: layer.id,
          side: "from",
          subPathIndex: 0,
          commandIndex: 1,
        });
      });
    });

    describe("bendSelectedLayerSegment", () => {
      it("converts a line segment into a cubic curve through the dragged point", () => {
        const layer = getStore().layers[0];
        getStore().bendSelectedLayerSegment(
          {
            layerId: layer.id,
            side: "from",
            subPathIndex: 0,
            commandIndex: 1,
          },
          { x: 15, y: 12 },
        );
        const updated = getStore().layers.find((l) => l.id === layer.id)!;
        // Shape op edits ONLY the active side so morph endpoints can differ.
        expect(updated.from.subPaths[0].commands[1].type).toBe("C");
        expect(updated.from.subPaths[0].commands[1].points).toHaveLength(3);
        expect(updated.to!.subPaths[0].commands[1].type).toBe("L");
        expect(getStore().canUndo).toBe(true);
      });

      it("respects recordHistory=false option", () => {
        const layer = getStore().layers[0];
        const historyLength = getStore().history.length;
        getStore().bendSelectedLayerSegment(
          {
            layerId: layer.id,
            side: "from",
            subPathIndex: 0,
            commandIndex: 1,
          },
          { x: 15, y: 12 },
          { recordHistory: false },
        );
        expect(getStore().history.length).toBe(historyLength);
      });
    });

    describe("setSelectedCommandAsFirst", () => {
      it("rotates closed path to start at selected command", () => {
        const layer = getStore().layers[0];
        const sel: Selection = {
          layerId: layer.id,
          side: "from",
          subPathIndex: 0,
          commandIndex: 1,
          pointIndex: 0,
        };
        getStore().selectPoint(sel);
        getStore().setSelectedCommandAsFirst();
        expect(getStore().canUndo).toBe(true);
      });

      it("no-op when no selection", () => {
        const before = pathToString(getStore().layers[0].from);
        getStore().clearSelection();
        getStore().setSelectedCommandAsFirst();
        expect(pathToString(getStore().layers[0].from)).toBe(before);
      });
    });

    describe("reverseSelectedLayer", () => {
      it("reverses the path of the selected layer", () => {
        getStore().selectLayer(getStore().layers[0].id);
        getStore().reverseSelectedLayer();
        expect(getStore().canUndo).toBe(true);
      });

      it("no-op when selected layer not found", () => {
        useEditorStore.setState({ selectedLayerId: 99999 });
        const beforeLen = getStore().layers.length;
        getStore().reverseSelectedLayer();
        expect(getStore().layers.length).toBe(beforeLen);
      });
    });

    describe("shiftSelectedLayer", () => {
      it("shifts the path by given steps and returns true", () => {
        const layer = getStore().layers[0];
        getStore().selectLayer(layer.id);
        const result = getStore().shiftSelectedLayer(1);
        expect(result).toBe(true);
        expect(getStore().canUndo).toBe(true);
      });

      it("returns false when selected layer not found", () => {
        useEditorStore.setState({ selectedLayerId: 99999 });
        const result = getStore().shiftSelectedLayer(1);
        expect(result).toBe(false);
      });
    });

    describe("autoFixSelectedLayer", () => {
      it("auto-fixes the selected layer and returns true", () => {
        const layer = getStore().layers[0];
        getStore().selectLayer(layer.id);
        const result = getStore().autoFixSelectedLayer();
        expect(result).toBe(true);
        expect(getStore().canUndo).toBe(true);
      });

      it("returns false when selected layer not found", () => {
        useEditorStore.setState({ selectedLayerId: 99999 });
        const result = getStore().autoFixSelectedLayer();
        expect(result).toBe(false);
      });
    });

    describe("booleanCombine", () => {
      it("does not consume or delete locked operands", () => {
        const [first, second] = getStore().layers;
        useEditorStore.setState({
          layers: getStore().layers.map((layer) =>
            layer.id === second.id ? { ...layer, locked: true } : layer,
          ),
        });
        getStore().selectLayers([first.id, second.id]);
        const before = getStore().layers.map((layer) => pathToString(layer.from));

        getStore().booleanCombine("union");

        expect(getStore().layers).toHaveLength(2);
        expect(getStore().layers.map((layer) => pathToString(layer.from))).toEqual(before);
      });

      it("keeps a morphable result morphable instead of collapsing to a static shape", () => {
        const [a, b] = getStore().layers;
        getStore().selectLayers([a.id, b.id]);

        getStore().booleanCombine("union");

        const result = getStore().layers.find((layer) => layer.id === a.id)!;
        const to = result.to;
        expect(to).toBeDefined();
        // `to` is an independent clone of the combined geometry, never an alias of `from`.
        expect(to).not.toBe(result.from);
        if (!to) return;
        expect(to.subPaths.length).toBe(result.from.subPaths.length);
        expect(getStore().layers.some((layer) => layer.id === b.id)).toBe(false);
      });

      it("leaves a static layer static instead of inventing an end state", () => {
        const [a] = getStore().layers;
        useEditorStore.setState({
          layers: [
            { ...getStore().layers[0], to: undefined },
            { ...getStore().layers[1], id: "static-partner" },
          ],
        });
        getStore().selectLayers([a.id, "static-partner"]);

        getStore().booleanCombine("intersect");

        const result = getStore().layers.find((layer) => layer.id === a.id)!;
        expect(result.to).toBeUndefined();
      });

      it("refuses to run with fewer than two explicit selections instead of picking a hidden partner", () => {
        getStore().selectLayer(getStore().layers[0].id);
        const before = getStore().layers.map((layer) => pathToString(layer.from));

        getStore().booleanCombine("union");

        expect(getStore().layers).toHaveLength(2);
        expect(getStore().layers.map((layer) => pathToString(layer.from))).toEqual(before);
        expect(getStore().selectedLayerIds).toHaveLength(1);
      });

      it("prunes both operands' animation blocks and their selection", () => {
        const [a, b] = getStore().layers;
        const doomedBlockId = `block-${String(b.id)}`;
        useEditorStore.setState((state) => ({
          animation: {
            ...state.animation,
            blocks: [
              ...state.animation.blocks,
              {
                id: doomedBlockId,
                layerId: b.id,
                propertyName: "pathData",
                fromValue: pathToString(b.from),
                toValue: pathToString(b.from),
                startTime: 0,
                endTime: 500,
                interpolator: "FAST_OUT_SLOW_IN" as const,
                type: "path" as const,
              },
            ],
          },
          selectedBlockIds: [doomedBlockId],
        }));
        // A block on an untouched third layer must survive the boolean op.
        useEditorStore.setState({
          layers: [
            ...getStore().layers,
            { ...getStore().layers[0], id: "bystander-layer", name: "Bystander" },
          ],
        });
        useEditorStore.setState((state) => ({
          animation: {
            ...state.animation,
            blocks: [
              ...state.animation.blocks,
              {
                id: "block-survives",
                layerId: "bystander-layer",
                propertyName: "translateX",
                fromValue: 0,
                toValue: 10,
                startTime: 0,
                endTime: 500,
                interpolator: "FAST_OUT_SLOW_IN" as const,
                type: "number" as const,
              },
            ],
          },
        }));
        getStore().selectLayers([a.id, b.id]);

        getStore().booleanCombine("union");

        const blockIds = getStore().animation.blocks.map((block) => block.id);
        expect(blockIds).not.toContain(doomedBlockId);
        expect(blockIds).toContain("block-survives");
        expect(getStore().selectedBlockIds).not.toContain(doomedBlockId);
      });
    });
  });

  // ─── translateSelectedPoints (batch) ─────────────────────────────────
  describe("translateSelectedPoints", () => {
    it("translates all selected points by dx/dy", () => {
      const layer = getStore().layers[0];
      const sel: Selection = {
        layerId: layer.id,
        side: "from",
        subPathIndex: 0,
        commandIndex: 0,
        pointIndex: 0,
      };
      getStore().selectPoint(sel);
      const beforePt = { ...layer.from.subPaths[0].commands[0].points[0] };
      getStore().translateSelectedPoints(5, 3);
      const updated = getStore().layers.find((l) => l.id === layer.id)!;
      const afterPt = updated.from.subPaths[0].commands[0].points[0];
      expect(afterPt.x).toBeCloseTo(beforePt.x + 5, 5);
      expect(afterPt.y).toBeCloseTo(beforePt.y + 3, 5);
    });

    it("no-op when no selectedPoints", () => {
      getStore().clearSelection();
      const before = pathToString(getStore().layers[0].from);
      getStore().translateSelectedPoints(10, 10);
      expect(pathToString(getStore().layers[0].from)).toBe(before);
    });

    it("no-op when dx=0 and dy=0", () => {
      const sel = makeSelection(getStore().layers[0].id);
      getStore().selectPoint(sel);
      const before = pathToString(getStore().layers[0].from);
      getStore().translateSelectedPoints(0, 0);
      expect(pathToString(getStore().layers[0].from)).toBe(before);
    });

    it("respects recordHistory=false option", () => {
      freshStore();
      const originalHistoryLen = getStore().history.length;
      getStore().selectPoint(makeSelection(getStore().layers[0].id));
      getStore().translateSelectedPoints(1, 1, { recordHistory: false });
      expect(getStore().history.length).toBe(originalHistoryLen);
    });

    it("translates multiple selected points", () => {
      const layer = getStore().layers[0];
      const sel1: Selection = {
        layerId: layer.id,
        side: "from",
        subPathIndex: 0,
        commandIndex: 0,
        pointIndex: 0,
      };
      const sel2: Selection = {
        layerId: layer.id,
        side: "from",
        subPathIndex: 0,
        commandIndex: 1,
        pointIndex: 0,
      };
      getStore().selectMultiplePoints([sel1, sel2]);
      const beforePt1 = { ...layer.from.subPaths[0].commands[0].points[0] };
      const beforePt2 = { ...layer.from.subPaths[0].commands[1].points[0] };
      getStore().translateSelectedPoints(2, 3);
      const updated = getStore().layers.find((l) => l.id === layer.id)!;
      const afterPt1 = updated.from.subPaths[0].commands[0].points[0];
      const afterPt2 = updated.from.subPaths[0].commands[1].points[0];
      expect(afterPt1.x).toBeCloseTo(beforePt1.x + 2, 5);
      expect(afterPt2.x).toBeCloseTo(beforePt2.x + 2, 5);
    });
  });

  // ─── Timeline Block Management ───────────────────────────────────────
  describe("timeline block management", () => {
    it("addTimelineBlock adds a block to the animation and layer", () => {
      // Default frame already has a pathData block — add a second property
      const layer = getStore().layers[0];
      const before = getStore().animation.blocks.length;
      getStore().addTimelineBlock(layer.id, "fillAlpha");
      expect(getStore().animation.blocks.length).toBe(before + 1);
      const block = getStore().animation.blocks[getStore().animation.blocks.length - 1];
      expect(block.layerId).toBe(layer.id);
      expect(block.propertyName).toBe("fillAlpha");
    });

    it("addTimelineBlock for numeric property creates number block", () => {
      const layer = getStore().layers[0];
      getStore().addTimelineBlock(layer.id, "scaleX");
      const block = getStore().animation.blocks.find((b) => b.propertyName === "scaleX");
      expect(block?.type).toBe("number");
    });

    it("addTimelineBlock no-op when layer not found", () => {
      const before = getStore().animation.blocks.length;
      getStore().addTimelineBlock(99999, "pathData");
      expect(getStore().animation.blocks.length).toBe(before);
    });

    it("addTimelineBlock seeds numeric defaults for layers missing transform fields", () => {
      // Imported SVG layers carry no transform fields at all — the block must
      // still be number-typed with the property's semantic default, never a
      // bogus color-typed empty-string block.
      const layer = getStore().layers[0];
      const stripped = { ...layer };
      delete (stripped as Partial<Layer>).translateX;
      delete (stripped as Partial<Layer>).scaleX;
      useEditorStore.setState({
        layers: [stripped, ...getStore().layers.filter((candidate) => candidate.id !== layer.id)],
      });

      getStore().addTimelineBlock(layer.id, "translateY");
      let block = getStore().animation.blocks.at(-1)!;
      expect(block.type).toBe("number");
      expect(block.fromValue).toBe(0);
      expect(block.toValue).toBe(0);

      getStore().addTimelineBlock(layer.id, "scaleY");
      block = getStore().animation.blocks.at(-1)!;
      expect(block.type).toBe("number");
      expect(block.fromValue).toBe(1);
      expect(block.toValue).toBe(1);
    });

    it("addTimelineBlock prefers the layer value when numeric and keeps color tracks colored", () => {
      const layer = getStore().layers[0];
      useEditorStore.setState({
        layers: getStore().layers.map((candidate) =>
          candidate.id === layer.id
            ? { ...candidate, translateX: 12.5, fillColor: "#ff0000" }
            : candidate,
        ),
      });

      getStore().addTimelineBlock(layer.id, "translateX");
      const translate = getStore().animation.blocks.at(-1)!;
      expect(translate.type).toBe("number");
      expect(translate.fromValue).toBe(12.5);

      getStore().addTimelineBlock(layer.id, "fillColor");
      const fill = getStore().animation.blocks.at(-1)!;
      expect(fill.type).toBe("color");
      expect(fill.fromValue).toBe("#ff0000");
    });

    it("addTimelineBlock sets expanded=true on layer", () => {
      const layer = getStore().layers[0];
      getStore().toggleLayerExpanded(layer.id); // set to true
      getStore().toggleLayerExpanded(layer.id); // set to false
      getStore().addTimelineBlock(layer.id, "pathData");
      const updated = getStore().layers.find((l) => l.id === layer.id)!;
      expect(updated.expanded).toBe(true);
    });

    it("updateTimelineBlock patches block properties", () => {
      const layer = getStore().layers[0];
      getStore().addTimelineBlock(layer.id, "pathData");
      const blockId = getStore().animation.blocks.at(-1)!.id;
      getStore().updateTimelineBlock(blockId, { startTime: 100, endTime: 500 });
      const block = getStore().animation.blocks.at(-1)!;
      expect(block.startTime).toBe(100);
      expect(block.endTime).toBe(500);
      expect(
        getStore().animation.blocks.find((candidate) => candidate.id === blockId)?.startTime,
      ).toBe(100);
    });

    it("updateTimelineBlock is undoable by default", () => {
      const block = getStore().animation.blocks[0];
      const originalStart = block.startTime;

      getStore().updateTimelineBlock(block.id, { startTime: originalStart + 100 });
      getStore().undo();

      expect(
        getStore().animation.blocks.find((candidate) => candidate.id === block.id)?.startTime,
      ).toBe(originalStart);
    });

    it("supports one history snapshot for a continuous timeline gesture", () => {
      const block = getStore().animation.blocks[0];
      const originalStart = block.startTime;
      getStore().pushHistory();

      getStore().updateTimelineBlock(
        block.id,
        { startTime: originalStart + 50 },
        { recordHistory: false },
      );
      getStore().updateTimelineBlock(
        block.id,
        { startTime: originalStart + 100 },
        { recordHistory: false },
      );
      getStore().undo();

      expect(
        getStore().animation.blocks.find((candidate) => candidate.id === block.id)?.startTime,
      ).toBe(originalStart);
    });

    it("removes an animated property and restores it through undo", () => {
      const layer = getStore().layers[0]!;
      getStore().addTimelineBlock(layer.id, "rotation");
      const block = getStore().animation.blocks.find(
        (candidate) => candidate.propertyName === "rotation",
      )!;

      getStore().removeTimelineProperty(layer.id, "rotation");

      expect(getStore().animation.blocks.some((candidate) => candidate.id === block.id)).toBe(
        false,
      );
      expect(getStore().layers[0]!.timeline?.some((candidate) => candidate.id === block.id)).toBe(
        false,
      );
      getStore().undo();
      expect(getStore().animation.blocks.some((candidate) => candidate.id === block.id)).toBe(true);
    });

    it("merges adjacent segments when an interior keyframe is removed", () => {
      const layer = getStore().layers[0]!;
      const left = {
        id: "rotation-left",
        layerId: layer.id,
        propertyName: "rotation",
        type: "number" as const,
        fromValue: 0,
        toValue: 90,
        startTime: 0,
        endTime: 500,
        interpolator: "LINEAR" as const,
      };
      const right = {
        ...left,
        id: "rotation-right",
        fromValue: 90,
        toValue: 180,
        startTime: 500,
        endTime: 1000,
      };
      useEditorStore.setState((state) => ({
        animation: { ...state.animation, blocks: [left, right] },
        layers: state.layers.map((candidate) =>
          candidate.id === layer.id ? { ...candidate, timeline: [left, right] } : candidate,
        ),
        selectedBlockIds: [right.id],
      }));

      getStore().removeTimelineKeyframe(right.id, "start");

      expect(getStore().animation.blocks).toEqual([
        expect.objectContaining({
          id: left.id,
          startTime: 0,
          endTime: 1000,
          fromValue: 0,
          toValue: 180,
        }),
      ]);
      expect(getStore().selectedBlockIds).toEqual([left.id]);
    });

    it("selectBlocks sets selected block ids", () => {
      getStore().selectBlocks(["block1", "block2"]);
      expect(getStore().selectedBlockIds).toEqual(["block1", "block2"]);
    });

    it("toggleBlockSelection toggles a block id", () => {
      getStore().selectBlocks([]);
      getStore().toggleBlockSelection("block1");
      expect(getStore().selectedBlockIds).toContain("block1");
      getStore().toggleBlockSelection("block1");
      expect(getStore().selectedBlockIds).not.toContain("block1");
    });

    it("clearBlockSelection clears selection", () => {
      getStore().selectBlocks(["block1"]);
      getStore().clearBlockSelection();
      expect(getStore().selectedBlockIds).toEqual([]);
    });

    it("toggleLayerCollapsed toggles collapsed state", () => {
      getStore().toggleLayerCollapsed("layer1");
      expect(getStore().collapsedLayerIds).toContain("layer1");
      getStore().toggleLayerCollapsed("layer1");
      expect(getStore().collapsedLayerIds).not.toContain("layer1");
    });

    it("setTimelineZoom clamps to [0.1, 10]", () => {
      getStore().setTimelineZoom(5);
      expect(getStore().timelineZoom).toBe(5);
      getStore().setTimelineZoom(0);
      expect(getStore().timelineZoom).toBe(0.1);
      getStore().setTimelineZoom(20);
      expect(getStore().timelineZoom).toBe(10);
    });

    it("setTimelineScroll sets scroll values", () => {
      getStore().setTimelineScroll(100, 200);
      expect(getStore().timelineScrollX).toBe(100);
      expect(getStore().timelineScrollY).toBe(200);
    });
  });

  // ─── resetProject ────────────────────────────────────────────────────
  describe("resetProject", () => {
    it("resets all state to initial values", () => {
      getStore().addLayer();
      getStore().togglePlayback();
      getStore().setProgress(0.5);
      getStore().setSpeed(3);
      getStore().toggleSlowMotion();
      getStore().toggleRepeating();
      getStore().setToolMode("pen");
      getStore().setEditingSide("to");
      getStore().startActionMode();
      getStore().selectPoint(makeSelection(0));

      getStore().resetProject();

      // Default workspace: 3 frames; active Play→Pause has 2 layers (upper/lower)
      expect(getStore().frames.length).toBe(3);
      expect(getStore().layers.length).toBe(2);
      expect(getStore().animation.blocks.length).toBe(2);
      expect(String(getStore().selectedLayerId)).toBe(String(getStore().layers[0]?.id));
      expect(getStore().isPlaying).toBe(false);
      expect(getStore().progress).toBe(0);
      expect(getStore().speed).toBe(1);
      expect(getStore().isSlowMotion).toBe(false);
      expect(getStore().isRepeating).toBe(true);
      expect(getStore().toolMode).toBe("select");
      expect(getStore().timelineCollapsed).toBe(false);
      expect(getStore().editingSide).toBe("from");
      expect(getStore().isActionMode).toBe(false);
      expect(getStore().selection).toBeNull();
      expect(getStore().selectedPoints).toEqual([]);
      expect(getStore().zoom).toBe(1);
      expect(getStore().selectedBlockIds).toEqual([]);
      expect(getStore().collapsedLayerIds).toEqual([]);
      expect(getStore().timelineZoom).toBe(1);
      expect(getStore().hoveredItem).toBeNull();
      expect(getStore().dragState).toBeNull();
      expect(getStore().clipboard).toBeNull();
    });

    it("resets vector to defaults", () => {
      getStore().updateVector({ width: 100, height: 100 });
      getStore().resetProject();
      expect(getStore().vector.width).toBe(24);
      expect(getStore().vector.height).toBe(24);
    });

    it("resets animation to defaults", () => {
      getStore().setAnimationDuration(5000);
      getStore().resetProject();
      expect(getStore().animation.duration).toBe(1000);
      // Active Play→Pause frame: one pathData block per layer (upper + lower)
      expect(getStore().animation.blocks.length).toBe(2);
      expect(getStore().animation.blocks.every((b) => b.propertyName === "pathData")).toBe(true);
    });
  });

  // ─── UI actions ──────────────────────────────────────────────────────
  describe("UI actions", () => {
    it("setZoom updates zoom", () => {
      getStore().setZoom(2.5);
      expect(getStore().zoom).toBe(2.5);
      expect(getStore().detailViewport.scale).toBe(2.5);
    });

    it("toggleSnap toggles snapToGrid", () => {
      const before = getStore().snapToGrid;
      getStore().toggleSnap();
      expect(getStore().snapToGrid).toBe(!before);
    });

    it("setEditingSide changes side", () => {
      getStore().setEditingSide("to");
      expect(getStore().editingSide).toBe("to");
    });

    it("setEditingSide clears selection when side changes", () => {
      getStore().selectPoint(makeSelection(getStore().layers[0].id));
      expect(getStore().selection).not.toBeNull();
      expect(getStore().selectedPoints).toHaveLength(1);
      getStore().setEditingSide("to");
      expect(getStore().selection).toBeNull();
      expect(getStore().selectedPoints).toEqual([]);
    });

    it("setEditingSide preserves selection when same side", () => {
      const sel = makeSelection(getStore().layers[0].id);
      getStore().selectPoint(sel);
      getStore().setEditingSide("from");
      expect(getStore().selection).toEqual(sel);
    });

    it("startActionMode sets isActionMode=true and clears selection", () => {
      getStore().selectPoint(makeSelection(0));
      getStore().startActionMode();
      expect(getStore().isActionMode).toBe(true);
      expect(getStore().selection).toBeNull();
      expect(getStore().selectedPoints).toEqual([]);
      expect(getStore().toolMode).toBe("direct");
    });

    it("switches tools inside path morphing without leaving the editor", () => {
      getStore().startActionMode();

      getStore().setToolMode("pen");

      expect(getStore().toolMode).toBe("pen");
      expect(getStore().isActionMode).toBe(true);
    });

    it("closeActionMode sets isActionMode=false and clears selection", () => {
      getStore().startActionMode();
      getStore().selectPoint(makeSelection(0));
      getStore().closeActionMode();
      expect(getStore().isActionMode).toBe(false);
      expect(getStore().selection).toBeNull();
    });
  });

  // ─── Hover & Drag ────────────────────────────────────────────────────
  describe("hover & drag", () => {
    it("setHoveredItem sets the hovered item", () => {
      const item = { type: "point" as const, id: "pt1" };
      getStore().setHoveredItem(item);
      expect(getStore().hoveredItem).toEqual(item);
    });

    it("setHoveredItem clears with null", () => {
      getStore().setHoveredItem({ type: "point", id: "pt1" });
      getStore().setHoveredItem(null);
      expect(getStore().hoveredItem).toBeNull();
    });

    it("startDrag creates a dragState", () => {
      getStore().startDrag("move", 10, 20);
      expect(getStore().dragState).toEqual({
        type: "move",
        startX: 10,
        startY: 20,
        currentX: 10,
        currentY: 20,
      });
    });

    it("updateDrag updates current position", () => {
      getStore().startDrag("move", 10, 20);
      getStore().updateDrag(30, 40);
      expect(getStore().dragState!.currentX).toBe(30);
      expect(getStore().dragState!.currentY).toBe(40);
    });

    it("updateDrag is no-op when no dragState", () => {
      getStore().endDrag();
      expect(getStore().dragState).toBeNull();
      getStore().updateDrag(10, 10);
      expect(getStore().dragState).toBeNull();
    });

    it("endDrag clears dragState", () => {
      getStore().startDrag("move", 0, 0);
      getStore().endDrag();
      expect(getStore().dragState).toBeNull();
    });
  });

  // ─── Clipboard ───────────────────────────────────────────────────────
  describe("clipboard", () => {
    it("copyLayers copies selected layers to clipboard", () => {
      const layerId = getStore().layers[0].id;
      getStore().copyLayers([layerId]);
      expect(getStore().clipboard).not.toBeNull();
      expect(getStore().clipboard!.layers).toHaveLength(1);
    });

    it("copyLayers is no-op when no matching layers", () => {
      getStore().copyLayers([99999]);
      expect(getStore().clipboard).toBeNull();
    });

    it("pasteLayers pastes copied layers with new ids and 'copy' suffix", () => {
      const layerId = getStore().layers[0].id;
      getStore().copyLayers([layerId]);
      const beforeCount = getStore().layers.length;
      getStore().pasteLayers();
      expect(getStore().layers.length).toBe(beforeCount + 1);
      const pasted = getStore().layers[getStore().layers.length - 1];
      expect(pasted.name).toContain("copy");
      expect(pasted.id).not.toBe(layerId);
    });

    it("pasteLayers selects the first pasted layer", () => {
      const layerId = getStore().layers[0].id;
      getStore().copyLayers([layerId]);
      getStore().pasteLayers();
      const pasted = getStore().layers[getStore().layers.length - 1];
      expect(getStore().selectedLayerId).toBe(pasted.id);
    });

    it("pasteLayers is no-op when clipboard is empty", () => {
      const before = getStore().layers.length;
      getStore().pasteLayers();
      expect(getStore().layers.length).toBe(before);
    });

    it("cutLayers removes layers and copies them", () => {
      getStore().addLayer("path");
      const targetId = getStore().layers[1].id;
      const beforeCount = getStore().layers.length;
      getStore().cutLayers([targetId]);
      expect(getStore().layers.length).toBe(beforeCount - 1);
      expect(getStore().clipboard).not.toBeNull();
    });

    it("cutLayers is no-op when cutting all layers", () => {
      const allIds = getStore().layers.map((l) => l.id);
      const before = getStore().layers.length;
      getStore().cutLayers(allIds);
      expect(getStore().layers.length).toBe(before);
    });

    it("copyLayers captures a group's whole subtree, not just the top-level layer", () => {
      const first = getStore().layers[0]!;
      const second = getStore().layers[1]!;
      getStore().selectLayers([first.id, second.id]);
      getStore().groupSelectedLayers();
      const groupId = getStore().selectedLayerId;

      getStore().copyLayers([groupId]);

      const copiedIds = getStore().clipboard!.layers.map((layer) => String(layer.id));
      expect(copiedIds).toHaveLength(3);
      expect(new Set(copiedIds)).toEqual(new Set([groupId, first.id, second.id].map(String)));
    });

    it("cutLayers removes the group's descendants along with the group", () => {
      const first = getStore().layers[0]!;
      const second = getStore().layers[1]!;
      getStore().selectLayers([first.id, second.id]);
      getStore().groupSelectedLayers();
      const groupId = getStore().selectedLayerId;
      const beforeCount = getStore().layers.length;

      getStore().cutLayers([groupId]);

      const remainingIds = new Set(getStore().layers.map((layer) => String(layer.id)));
      for (const id of [groupId, first.id, second.id]) {
        expect(remainingIds.has(String(id))).toBe(false);
      }
      expect(getStore().layers.length).toBe(beforeCount - 3);
    });

    it("cutLayers prunes the cut subtree's TimelineBlocks and their selection", () => {
      const first = getStore().layers[0]!;
      const second = getStore().layers[1]!;
      const block = {
        id: "cut-alpha",
        layerId: first.id,
        propertyName: "alpha",
        type: "number" as const,
        fromValue: 0,
        toValue: 1,
        startTime: 0,
        endTime: 400,
      };
      useEditorStore.setState((state) => ({
        animation: { ...state.animation, blocks: [...state.animation.blocks, block] },
        layers: state.layers.map((candidate) =>
          candidate.id === first.id ? { ...candidate, timeline: [block] } : candidate,
        ),
        selectedBlockIds: [block.id],
      }));
      getStore().addLayer("path"); // survives the cut — must keep its blocks
      getStore().selectLayers([
        getStore().layers[0]!.id,
        getStore().layers[1]!.id,
      ]);
      getStore().groupSelectedLayers();
      const groupId = getStore().selectedLayerId;

      getStore().cutLayers([groupId]);

      expect(getStore().animation.blocks.some((b) => b.id === "cut-alpha")).toBe(false);
      expect(
        getStore().animation.blocks.some((b) =>
          [first.id, second.id].some((id) => String(b.layerId) === String(id)),
        ),
      ).toBe(false);
      // A surviving layer's blocks stay untouched.
      const survivor = getStore().layers.find((layer) => layer.type !== "group")!;
      expect(survivor).toBeDefined();
      expect(getStore().selectedBlockIds).not.toContain("cut-alpha");
    });

    it("pasteLayers re-parents pasted children to their pasted group", () => {
      const first = getStore().layers[0]!;
      const second = getStore().layers[1]!;
      getStore().selectLayers([first.id, second.id]);
      getStore().groupSelectedLayers();
      const groupId = getStore().selectedLayerId;
      getStore().copyLayers([groupId]);
      getStore().deleteSelectedLayers();

      getStore().pasteLayers();

      const pastedGroup = getStore().layers.find(
        (layer) => layer.type === "group" && layer.name.endsWith(" copy"),
      )!;
      expect(pastedGroup).toBeDefined();
      const pastedChildren = getStore().layers.filter(
        (layer) => String(layer.parentId) === String(pastedGroup.id),
      );
      expect(pastedChildren).toHaveLength(2);
      // No pasted layer points at an original (deleted) id.
      expect(pastedChildren.every((child) => child.parentId !== groupId)).toBe(true);
    });

    it("pasteLayers carries animation tracks with remapped ids into frame.animation", () => {
      const layer = getStore().layers[0]!;
      const block = {
        id: "paste-alpha",
        layerId: layer.id,
        propertyName: "alpha",
        type: "number" as const,
        fromValue: 0,
        toValue: 1,
        startTime: 0,
        endTime: 400,
      };
      // Start from a known block set: the default workspace ships its own
      // authored demo tracks, and this test asserts exact paste deltas.
      useEditorStore.setState((state) => ({
        animation: { ...state.animation, blocks: [block] },
        layers: state.layers.map((candidate) =>
          candidate.id === layer.id ? { ...candidate, timeline: [block] } : candidate,
        ),
      }));
      getStore().copyLayers([layer.id]);
      getStore().deleteSelectedLayers();
      const blocksBefore = getStore().animation.blocks;

      getStore().pasteLayers();

      const pasted = getStore().layers.at(-1)!;
      const newBlocks = getStore().animation.blocks.slice(blocksBefore.length);
      expect(newBlocks).toHaveLength(1);
      expect(String(newBlocks[0]!.layerId)).toBe(String(pasted.id));
      expect(newBlocks[0]!.id).not.toBe(block.id);
      // The pasted layer's timeline mirrors its own remapped block.
      expect(pasted.timeline!.map((candidate) => candidate.id)).toEqual([newBlocks[0]!.id]);
    });

    it("pasteLayers animates the pasted layer even when its mirror was stale at copy time", () => {
      const layer = getStore().layers[0]!;
      const block = {
        id: "hydrate-alpha",
        layerId: layer.id,
        propertyName: "alpha",
        type: "number" as const,
        fromValue: 0,
        toValue: 1,
        startTime: 0,
        endTime: 400,
      };
      // Authoring path: block lands in animation.blocks only — layer.timeline
      // is left stale (empty), exactly as live edits leave it.
      useEditorStore.setState((state) => ({
        animation: { ...state.animation, blocks: [block] },
      }));
      expect(layer.timeline ?? []).toHaveLength(0);

      getStore().copyLayers([layer.id]);
      // The original is gone before paste; only the copy-time block snapshot
      // can survive.
      getStore().deleteSelectedLayers();
      const blocksBefore = getStore().animation.blocks;

      getStore().pasteLayers();

      const pasted = getStore().layers.at(-1)!;
      const newBlocks = getStore().animation.blocks.slice(blocksBefore.length);
      expect(newBlocks).toHaveLength(1);
      expect(String(newBlocks[0]!.layerId)).toBe(String(pasted.id));
      expect(newBlocks[0]!.id).not.toBe(block.id);
      // Authored values survive the snapshot round-trip, not just identities.
      expect(newBlocks[0]!.toValue).toBe(block.toValue);
      expect(newBlocks[0]!.endTime).toBe(block.endTime);
      expect(getStore().animation.duration).toBeGreaterThanOrEqual(block.endTime);
      // The pasted layer's timeline mirrors its own remapped block.
      expect(pasted.timeline!.map((candidate) => candidate.id)).toEqual([newBlocks[0]!.id]);
    });

    it("pasteLayers rebuilds tracks from the copied animation.blocks, ignoring a diverged mirror", () => {
      const layer = getStore().layers[0]!;
      const authoredBlock = {
        id: "authored-alpha",
        layerId: layer.id,
        propertyName: "alpha",
        type: "number" as const,
        fromValue: 0,
        toValue: 1,
        startTime: 0,
        endTime: 300,
      };
      useEditorStore.setState((state) => ({
        animation: { ...state.animation, blocks: [authoredBlock] },
        // Mirror holds a superseded block the authoring pass replaced.
        layers: state.layers.map((candidate) =>
          candidate.id === layer.id
            ? {
                ...candidate,
                timeline: [
                  { ...authoredBlock, id: "ghost-alpha", toValue: 0.25, endTime: 100 },
                ],
              }
            : candidate,
        ),
      }));

      getStore().copyLayers([layer.id]);
      getStore().deleteSelectedLayers();
      const blocksBefore = getStore().animation.blocks;

      getStore().pasteLayers();

      const pasted = getStore().layers.at(-1)!;
      const newBlocks = getStore().animation.blocks.slice(blocksBefore.length);
      expect(newBlocks).toHaveLength(1);
      expect(String(newBlocks[0]!.layerId)).toBe(String(pasted.id));
      // The authored snapshot won; the ghost mirror entry did not leak through.
      expect(newBlocks[0]!.toValue).toBe(authoredBlock.toValue);
      expect(pasted.timeline!.map((candidate) => candidate.toValue)).toEqual([1]);
    });

    it("pasteLayers carries a copied group's children animation tracks too", () => {
      const first = getStore().layers[0]!;
      const second = getStore().layers[1]!;
      const childBlock = (id: string, layerId: string | number, toValue: number) => ({
        id,
        layerId,
        propertyName: "alpha",
        type: "number" as const,
        fromValue: 0,
        toValue,
        startTime: 0,
        endTime: 300,
      });
      useEditorStore.setState((state) => ({
        animation: {
          ...state.animation,
          // Start from a known block set: the default workspace ships its own
          // authored demo tracks, and this test asserts exact paste deltas.
          blocks: [
            childBlock("group-child-a", first.id, 1),
            childBlock("group-child-b", second.id, 0.5),
          ],
        },
      }));
      getStore().selectLayers([first.id, second.id]);
      getStore().groupSelectedLayers();
      const groupId = getStore().selectedLayerId;

      getStore().copyLayers([groupId]);
      getStore().deleteSelectedLayers();
      const blocksBefore = getStore().animation.blocks;

      getStore().pasteLayers();

      const newBlocks = getStore().animation.blocks.slice(blocksBefore.length);
      expect(newBlocks).toHaveLength(2);
      const pastedChildren = getStore().layers.filter(
        (layer) => layer.parentId != null && layer.type !== "group",
      );
      expect(pastedChildren).toHaveLength(2);
      const pastedIds = new Set(pastedChildren.map((child) => String(child.id)));
      for (const block of newBlocks) {
        expect(pastedIds.has(String(block.layerId))).toBe(true);
      }
    });

    it("copyLayers reads a selected subtree from a non-active artboard", () => {
      const other = getStore().frames[1];
      expect(other).toBeDefined();
      const layer = other.layers[0]!;
      const block = {
        id: "cross-board-alpha",
        layerId: layer.id,
        propertyName: "alpha",
        type: "number" as const,
        fromValue: 0,
        toValue: 1,
        startTime: 0,
        endTime: 400,
      };
      useEditorStore.setState((state) => ({
        frames: state.frames.map((frame) =>
          frame.id === other.id
            ? { ...frame, animation: { ...frame.animation, blocks: [block] } }
            : frame,
        ),
        selectedLayerRefs: [{ ownerId: other.id, layerId: layer.id }],
      }));

      getStore().copyLayers([layer.id]);

      expect(getStore().clipboard!.layers.map((item) => String(item.id))).toContain(String(layer.id));
      expect(getStore().clipboard!.blocks?.some((item) => item.id === block.id)).toBe(true);
    });

    it("pasteLayers scales the paste offset by the current zoom", () => {
      getStore().setDetailViewport({ x: -500, y: -500, w: 100, h: 100, scale: 4 });
      const layer = getStore().layers[0]!;
      const originalX = layer.translateX ?? 0;
      const originalY = layer.translateY ?? 0;
      getStore().copyLayers([layer.id]);

      getStore().pasteLayers();

      const pasted = getStore().layers.at(-1)!;
      expect(pasted.id).not.toBe(layer.id);
      // 8 screen px at 4x zoom = 2 world units.
      expect(pasted.translateX).toBeCloseTo(originalX + 2);
      expect(pasted.translateY).toBeCloseTo(originalY + 2);
    });
  });

  // ─── setLayers / importLayers / loadProject ──────────────────────────
  describe("setLayers / importLayers / loadProject", () => {
    it("setLayers replaces layers and selects first", () => {
      const newLayers: Layer[] = [
        {
          ...getStore().layers[0],
          id: 100,
          name: "Custom",
        },
      ];
      getStore().setLayers(newLayers);
      expect(getStore().layers).toHaveLength(1);
      expect(getStore().selectedLayerId).toBe(100);
      expect(getStore().selection).toBeNull();
      expect(getStore().progress).toBe(0);
    });

    it("setLayers with empty array sets selectedLayerId to 0", () => {
      getStore().setLayers([]);
      expect(getStore().layers).toHaveLength(0);
      expect(getStore().selectedLayerId).toBe(0);
    });

    it("importLayers appends layers", () => {
      const beforeCount = getStore().layers.length;
      const incoming: Layer[] = [
        {
          ...getStore().layers[0],
          id: 200,
          name: "Imported",
        },
      ];
      getStore().importLayers(incoming);
      expect(getStore().layers.length).toBe(beforeCount + 1);
      expect(getStore().selectedLayerId).toBe(200);
    });

    it("importLayers is no-op with empty array", () => {
      const before = getStore().layers.length;
      getStore().importLayers([]);
      expect(getStore().layers.length).toBe(before);
    });

    it("loadProject replaces entire project state", () => {
      const newLayers = [getStore().layers[0]];
      getStore().loadProject({
        layers: newLayers,
        vector: { id: "v", name: "Test", width: 48, height: 48, alpha: 0.5 },
        animation: { id: "a", name: "test-anim", duration: 2000, blocks: [] },
        hiddenLayerIds: ["hidden1"],
      });
      expect(getStore().layers).toEqual(newLayers);
      expect(getStore().vector.width).toBe(48);
      expect(getStore().animation.duration).toBe(2000);
      expect(getStore().hiddenLayerIds).toEqual(["hidden1"]);
      expect(getStore().selection).toBeNull();
      expect(getStore().progress).toBe(0);
      expect(getStore().isActionMode).toBe(false);
    });

    it("loadProject clears stale frame and point selection atomically", () => {
      const layer = getStore().layers[0];
      useEditorStore.setState({
        selectedFrameIds: getStore().frames.map((frame) => frame.id),
        selectionKind: "frame",
        hasCanvasSelection: true,
        selectedPoints: [
          {
            layerId: layer.id,
            side: "from",
            subPathIndex: 0,
            commandIndex: 0,
            pointIndex: 0,
          },
        ],
      });

      getStore().loadProject({
        layers: [layer],
        vector: { id: "fresh", name: "Fresh", width: 24, height: 24, alpha: 1 },
        animation: { id: "fresh-animation", name: "Fresh", duration: 1000, blocks: [] },
        hiddenLayerIds: [],
      });

      expect(getStore().selectedFrameIds).toEqual([]);
      expect(getStore().selectedPoints).toEqual([]);
      expect(getStore().selectionKind).toBe("layer");
      expect(getStore().selectedLayerRefs).toEqual([
        { ownerId: getStore().selectedFrameId, layerId: layer.id },
      ]);
    });

    it("loadDocument restores every frame and page-root owner atomically", () => {
      const beforeFrameIds = getStore().frames.map((frame) => frame.id);
      const sourceFrames = getStore().frames.slice(0, 2);
      const rootLayer = { ...structuredClone(getStore().layers[0]), id: "page-vector" };
      const snapshot: LegacyDocumentSnapshot = {
        id: "imported-document",
        name: "Imported document",
        frames: sourceFrames.map((frame, index) => ({
          ...structuredClone(frame),
          id: `imported-frame-${index}`,
          name: `Imported frame ${index + 1}`,
          x: index * 80,
          y: index * 24,
          layers: frame.layers.map((layer) => ({
            ...structuredClone(layer),
            id: `imported-${index}-${String(layer.id)}`,
            name: `${layer.name} imported ${index}`,
          })),
        })),
        rootLayers: [rootLayer],
        rootVector: { id: "page", name: "Page", width: 240, height: 160, alpha: 1 },
        rootAnimation: {
          id: "page-motion",
          name: "Page motion",
          duration: 1800,
          blocks: [],
        },
        rootHiddenLayerIds: [String(rootLayer.id)],
      };

      getStore().loadDocument(snapshot);

      const state = getStore();
      expect(state.frames.map((frame) => frame.id)).toEqual([
        "imported-frame-0",
        "imported-frame-1",
      ]);
      expect(state.frames[1].x).toBe(80);
      expect(state.frames[1].y).toBe(24);
      expect(state.frames[1].layers[0].name).toContain("imported 1");
      expect(state.rootLayers).toHaveLength(1);
      expect(state.rootLayers[0].id).toBe("page-vector");
      expect(state.rootAnimation.duration).toBe(1800);
      expect(state.selectedFrameId).toBe("imported-frame-0");
      expect(state.layers).toEqual(state.frames[0].layers);
      expect(state.timelineCollapsed).toBe(false);

      getStore().undo();
      expect(getStore().frames.map((frame) => frame.id)).toEqual(beforeFrameIds);
    });

    it("normalizes fragile command IDs at store boundaries", () => {
      const legacyLayer: Layer = {
        ...getStore().layers[0],
        id: 300,
        from: parsePath("M 0 0 L 10 10"),
        to: parsePath("M 0 0 L 20 20"),
      };
      legacyLayer.from.subPaths[0].commands[0].id = "cmd_1712345678901_0";
      legacyLayer.to!.subPaths[0].commands[0].id = "cmd_1712345678901_1";

      getStore().setLayers([legacyLayer]);

      expect(getLayerCommandIds(getStore().layers).every((id) => !/^cmd_\d+/.test(id))).toBe(true);
    });
  });

  // ─── replaceSelectedLayerPaths / updateSelectedLayer ──────────────────
  describe("replaceSelectedLayerPaths / updateSelectedLayer", () => {
    it("replaceSelectedLayerPaths updates from/to of selected layer", () => {
      const layer = getStore().layers[0];
      const newFrom = parsePath("M 0 0 L 50 50");
      getStore().replaceSelectedLayerPaths({ from: newFrom });
      const updated = getStore().layers.find((l) => l.id === layer.id)!;
      expect(pathToString(updated.from)).toBe(pathToString(newFrom));
    });

    it("replaceSelectedLayerPaths also updates pathData when from provided", () => {
      const layer = getStore().layers[0];
      const newFrom = parsePath("M 0 0 L 50 50");
      getStore().replaceSelectedLayerPaths({ from: newFrom });
      const updated = getStore().layers.find((l) => l.id === layer.id)!;
      expect(pathToString(updated.pathData!)).toBe(pathToString(newFrom));
    });

    it("replaceSelectedLayerPaths no-op when layer not found", () => {
      useEditorStore.setState({ selectedLayerId: 99999 });
      const before = pathToString(getStore().layers[0].from);
      getStore().replaceSelectedLayerPaths({ from: parsePath("M 0 0 L 50 50") });
      expect(pathToString(getStore().layers[0].from)).toBe(before);
    });

    it("updateSelectedLayer patches layer properties", () => {
      const layer = getStore().layers[0];
      getStore().updateSelectedLayer({ name: "Updated", visible: false });
      const updated = getStore().layers.find((l) => l.id === layer.id)!;
      expect(updated.name).toBe("Updated");
      expect(updated.visible).toBe(false);
    });

    it("updateSelectedLayer no-op when layer not found", () => {
      useEditorStore.setState({ selectedLayerId: 99999 });
      getStore().updateSelectedLayer({ name: "Should not apply" });
      expect(getStore().layers[0].name).not.toBe("Should not apply");
    });
  });

  // ─── Vector & Animation ─────────────────────────────────────────────
  describe("vector & animation", () => {
    it("updateVector patches vector metadata", () => {
      getStore().updateVector({ width: 48, name: "Test" });
      expect(getStore().vector.width).toBe(48);
      expect(getStore().vector.name).toBe("Test");
      expect(getStore().vector.height).toBe(24); // unchanged
    });

    it("setAnimationDuration clamps to min 100ms", () => {
      getStore().setAnimationDuration(50);
      expect(getStore().animation.duration).toBe(100);
    });

    it("setAnimationDuration updates blocks that end at old duration", () => {
      const layer = getStore().layers[0];
      getStore().addTimelineBlock(layer.id, "pathData");
      getStore().setAnimationDuration(2000);
      expect(getStore().animation.duration).toBe(2000);
      const block = getStore().animation.blocks[0];
      expect(block.endTime).toBe(2000);
    });

    it("setAnimationDuration is undoable", () => {
      const originalDuration = getStore().animation.duration;
      getStore().setAnimationDuration(originalDuration + 500);

      getStore().undo();

      expect(getStore().animation.duration).toBe(originalDuration);
    });

    it("updateVector records an undoable history entry", () => {
      const originalWidth = getStore().vector.width;
      getStore().updateVector({ width: 96, name: "Resized" });

      getStore().undo();

      expect(getStore().vector.width).toBe(originalWidth);
      expect(getStore().vector.name).not.toBe("Resized");
    });

    it("updateVector refits the detail viewport only when the artboard size changes", () => {
      getStore().setDetailViewport((current) => ({ ...current, x: 42, y: -7 }));
      const pannedBeforeRename = getStore().detailViewport;

      getStore().updateVector({ name: "Renamed" });

      expect(getStore().detailViewport).toEqual(pannedBeforeRename);

      getStore().setDetailViewport((current) => ({ ...current, x: 11 }));
      getStore().updateVector({ width: getStore().vector.width + 24 });

      expect(getStore().detailViewport.x).not.toBe(11);
    });
  });

  // ─── loadSample ──────────────────────────────────────────────────────
  describe("loadSample", () => {
    it("loads an original demo project and selects the first editable path", () => {
      getStore().loadSample(0);

      expect(getStore().vector.name).toBe("playtopause");
      expect(getStore().animation.duration).toBe(300);
      expect(getStore().animation.blocks).toHaveLength(2);
      expect(getStore().layers.some((layer) => layer.type === "group")).toBe(true);
      expect(getStore().layers.find((layer) => layer.id === getStore().selectedLayerId)?.type).toBe(
        "path",
      );
      expect(getStore().progress).toBe(0);
      expect(getStore().isPlaying).toBe(false);
    });

    it("wraps around with modulo", () => {
      getStore().loadSample(10); // 10 % 5 = 0
      expect(getStore().vector.name).toBe("playtopause");
    });

    it("loads even when the current selected layer is missing", () => {
      useEditorStore.setState({ selectedLayerId: 99999 });
      getStore().loadSample(0);
      expect(getStore().vector.name).toBe("playtopause");
      expect(getStore().layers.find((layer) => layer.id === getStore().selectedLayerId)?.type).toBe(
        "path",
      );
    });

    it("loads every bundled demo without leaking fragile command IDs", () => {
      for (let index = 0; index < DEMO_INFOS.length; index++) {
        getStore().loadSample(index);
        expect(getLayerCommandIds(getStore().layers).every((id) => !/^cmd_\d+/.test(id))).toBe(
          true,
        );
      }
    });
  });

  // ─── getCompatibilityStatus ──────────────────────────────────────────
  describe("getCompatibilityStatus", () => {
    it("returns compatible=true for initial layers", () => {
      const status = getStore().getCompatibilityStatus();
      // Default morph frames are pre-fixed so the app never greets with Auto Fix
      expect(status.compatible).toBe(true);
      expect(status.warning).toBe("");
      expect(status.fromPoints).toBeGreaterThan(0);
      expect(status.toPoints).toBeGreaterThan(0);
    });

    it("returns compatible warning for incompatible paths", () => {
      getStore().replaceSelectedLayerPaths({
        from: parsePath("M 0 0 L 10 10"),
        to: parsePath("M 0 0 L 5 5 L 10 10"),
      });
      const status = getStore().getCompatibilityStatus();
      expect(status.compatible).toBe(false);
      expect(status.warning.length).toBeGreaterThan(0);
    });

    it("returns default for non-existent layer", () => {
      useEditorStore.setState({ selectedLayerId: 99999 });
      const status = getStore().getCompatibilityStatus();
      expect(status.compatible).toBe(true);
      expect(status.fromPoints).toBe(0);
      expect(status.toPoints).toBe(0);
    });
  });

  describe("owner-aware layer chrome actions", () => {
    it("toggles an inactive frame layer without changing the active selection", () => {
      const sourceFrameId = getStore().selectedFrameId;
      const sourceLayer = getStore().layers[0]!;
      getStore().addFrame();
      const activeFrameId = getStore().selectedFrameId;
      const selectionBefore = getStore().selectionKind;

      getStore().toggleOwnedLayerVisibility(sourceFrameId, sourceLayer.id);
      getStore().toggleOwnedLayerLock(sourceFrameId, sourceLayer.id);

      const source = getStore().frames.find((frame) => frame.id === sourceFrameId)!;
      const updated = source.layers.find((layer) => String(layer.id) === String(sourceLayer.id))!;
      expect(updated.visible).toBe(false);
      expect(updated.locked).toBe(true);
      expect(getStore().selectedFrameId).toBe(activeFrameId);
      expect(getStore().selectionKind).toBe(selectionBefore);
    });
  });

  // ─── Edge cases ──────────────────────────────────────────────────────
  describe("edge cases", () => {
    it("hiddenLayerIds is included in loadProject", () => {
      getStore().loadProject({
        layers: getStore().layers,
        vector: getStore().vector,
        animation: getStore().animation,
        hiddenLayerIds: ["h1", "h2"],
      });
      expect(getStore().hiddenLayerIds).toEqual(["h1", "h2"]);
    });

    it("addLayer with group type creates a group layer", () => {
      getStore().addLayer("group");
      const added = getStore().layers[getStore().layers.length - 1];
      expect(added.type).toBe("group");
      expect(added.name).toContain("Group layer");
    });

    it("convertLayerType no-op for non-existent layer", () => {
      const beforeTypes = getStore().layers.map((l) => l.type);
      getStore().convertLayerType(99999, "clipPath");
      const afterTypes = getStore().layers.map((l) => l.type);
      expect(afterTypes).toEqual(beforeTypes);
    });
  });
});
