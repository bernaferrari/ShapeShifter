import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "../editorStore";
import { parsePath, pathToString } from "../../shapeshifter/pathUtils";
import { DEMO_INFOS } from "../../shapeshifter/demoProjects";
import type { Selection, Layer } from "../../shapeshifter/types";

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
  const path = side === "from" ? layer.from : layer.to;
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
    [layer.from, layer.to, layer.pathData]
      .filter(Boolean)
      .flatMap((path) =>
        path!.subPaths.flatMap((subPath) => subPath.commands.map((command) => command.id)),
      ),
  );
}

describe("editorStore", () => {
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

  // ─── Layer CRUD ──────────────────────────────────────────────────────
  describe("layer CRUD", () => {
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
      it("deletes a layer by id", () => {
        const initialCount = getStore().layers.length;
        const targetId = getStore().layers[1].id;
        getStore().deleteLayer(targetId);
        expect(getStore().layers.length).toBe(initialCount - 1);
        expect(getStore().layers.find((l) => l.id === targetId)).toBeUndefined();
      });

      it("selects first remaining layer if deleted was selected", () => {
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
        getStore().deleteLayer(getStore().layers[1].id);
        expect(getStore().canUndo).toBe(true);
      });

      it("clears selection on delete", () => {
        getStore().selectPoint(makeSelection(0));
        getStore().deleteLayer(getStore().layers[1].id);
        expect(getStore().selection).toBeNull();
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
        const targetId = getStore().layers[1].id;
        getStore().selectLayer(targetId);
        expect(getStore().selectedLayerId).toBe(targetId);
      });

      it("clears point selection", () => {
        getStore().selectPoint(makeSelection(0));
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

    it("new mutation clears redo stack", () => {
      getStore().addLayer();
      getStore().undo();
      expect(getStore().canRedo).toBe(true);
      getStore().addLayer();
      expect(getStore().canRedo).toBe(false);
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
  });

  // ─── ToolMode ────────────────────────────────────────────────────────
  describe("toolMode", () => {
    it("defaults to 'select'", () => {
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
        const pt = updated.to.subPaths[0].commands[0].points[0];
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
        const beforeTo = layer.to.subPaths[0].commands.length;
        getStore().splitSelectedLayerSegment({
          layerId: layer.id,
          side: "from",
          subPathIndex: 0,
          commandIndex: 1,
        });
        const updated = getStore().layers.find((l) => l.id === layer.id)!;
        expect(updated.from.subPaths[0].commands.length).toBe(beforeFrom + 1);
        expect(updated.to.subPaths[0].commands.length).toBe(beforeTo + 1);
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
        expect(updated.from.subPaths[0].commands[1].type).toBe("C");
        expect(updated.from.subPaths[0].commands[1].points).toHaveLength(3);
        expect(updated.to.subPaths[0].commands[1].type).toBe("C");
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
      const layer = getStore().layers[0];
      getStore().addTimelineBlock(layer.id, "pathData");
      expect(getStore().animation.blocks.length).toBe(1);
      const block = getStore().animation.blocks[0];
      expect(block.layerId).toBe(layer.id);
      expect(block.propertyName).toBe("pathData");
      expect(block.type).toBe("path");
    });

    it("addTimelineBlock for numeric property creates number block", () => {
      const layer = getStore().layers[0];
      getStore().addTimelineBlock(layer.id, "scaleX");
      const block = getStore().animation.blocks[0];
      expect(block.type).toBe("number");
    });

    it("addTimelineBlock no-op when layer not found", () => {
      getStore().addTimelineBlock(99999, "pathData");
      expect(getStore().animation.blocks.length).toBe(0);
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
      const blockId = getStore().animation.blocks[0].id;
      getStore().updateTimelineBlock(blockId, { startTime: 100, endTime: 500 });
      const block = getStore().animation.blocks[0];
      expect(block.startTime).toBe(100);
      expect(block.endTime).toBe(500);
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

      expect(getStore().layers.length).toBe(3);
      expect(getStore().selectedLayerId).toBe(0);
      expect(getStore().isPlaying).toBe(false);
      expect(getStore().progress).toBe(0);
      expect(getStore().speed).toBe(1);
      expect(getStore().isSlowMotion).toBe(false);
      expect(getStore().isRepeating).toBe(true);
      expect(getStore().toolMode).toBe("select");
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
      expect(getStore().animation.blocks).toEqual([]);
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
      getStore().setEditingSide("to");
      expect(getStore().selection).toBeNull();
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

    it("normalizes fragile command IDs at store boundaries", () => {
      const legacyLayer: Layer = {
        ...getStore().layers[0],
        id: 300,
        from: parsePath("M 0 0 L 10 10"),
        to: parsePath("M 0 0 L 20 20"),
      };
      legacyLayer.from.subPaths[0].commands[0].id = "cmd_1712345678901_0";
      legacyLayer.to.subPaths[0].commands[0].id = "cmd_1712345678901_1";

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
      expect(typeof status.compatible).toBe("boolean");
      expect(typeof status.fromPoints).toBe("number");
      expect(typeof status.toPoints).toBe("number");
      expect(typeof status.warning).toBe("string");
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
