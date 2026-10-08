// @vitest-environment happy-dom
import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useWorldPointEditing } from "../useWorldPointEditing";
import { useEditorStore } from "@/lib/store/editorStore";
import { createPathLayer } from "@/lib/store/defaultWorkspace";
import { parsePath } from "@/lib/pathshift/pathUtils";
import {
  renderEditorComponent,
  type RenderedEditorComponent,
} from "../../__tests__/renderEditorComponent";
import type { Selection } from "@/lib/pathshift/types";
import { evaluateAndroidScene } from "@/lib/pathshift/scene/evaluate";

let baseline: ReturnType<typeof useEditorStore.getState>;
let rendered: RenderedEditorComponent;
let editing: ReturnType<typeof useWorldPointEditing>;
const selection = (commandIndex: number): Selection => ({
  layerId: "path",
  side: "from",
  subPathIndex: 0,
  commandIndex,
  pointIndex: 0,
});
beforeEach(() => {
  baseline = useEditorStore.getState();
  const path = parsePath("M 0 0 L 10 0 L 10 10 Z");
  useEditorStore.setState({
    layers: [
      createPathLayer({
        id: "path",
        name: "Path",
        from: path,
        pathData: path,
        visible: true,
        locked: false,
      }),
    ],
    selectedLayerId: "path",
    selectedLayerIds: ["path"],
    selectedLayerRefs: [{ ownerId: baseline.selectedFrameId, layerId: "path" }],
    selectedPoints: [],
    history: [],
    future: [],
    canUndo: false,
  });
  function Harness() {
    const current = useEditorStore((state) => state.layers[0]!.from);
    const layers = useEditorStore((state) => state.layers);
    editing = useWorldPointEditing({
      path: current,
      ownerOrigin: { x: 100, y: 100 },
      layerTranslation: { x: 0, y: 0 },
      worldMatrix: { a: 0, b: 2, c: -2, d: 0, e: 0, f: 0 },
      locked: evaluateAndroidScene(
        layers,
        { id: "test", name: "Test", duration: 1000, blocks: [] },
        0,
      ).nodesById.get("path")?.locked,
      layerId: "path",
      editingSide: "from",
      hitRadius: 5,
      syncActiveOwner: useEditorStore.getState().syncActiveOwner,
    });
    return null;
  }
  rendered = renderEditorComponent(<Harness />);
});
afterEach(() => {
  rendered.unmount();
  useEditorStore.setState(baseline, true);
});

describe("World multi-anchor editing", () => {
  it("carries cubic tangent handles through a transformed frozen multi-anchor gesture without double movement", () => {
    act(() =>
      useEditorStore.getState().updateSelectedLayer(
        {
          from: parsePath("M0 0 C3 0 7 0 10 0 C13 0 17 0 20 0"),
          pathData: parsePath("M0 0 C3 0 7 0 10 0 C13 0 17 0 20 0"),
        },
        { recordHistory: false },
      ),
    );
    const anchor = { ...selection(1), pointIndex: 2 };
    act(() => {
      editing.start(anchor);
      editing.finish();
      editing.start({ ...selection(1), pointIndex: 1 }, true);
      editing.finish();
      editing.start(anchor);
    });
    act(() => editing.update({ x: 94, y: 124 }, true));
    act(() => editing.update({ x: 90, y: 130 }, true));
    act(() => editing.finish());
    const commands = useEditorStore.getState().layers[0].from.subPaths[0].commands;
    expect(commands[1].points).toEqual([
      { x: 3, y: 0 },
      { x: 12, y: 5 },
      { x: 15, y: 5 },
    ]);
    expect(commands[2].points[0]).toEqual({ x: 18, y: 5 });
    expect(useEditorStore.getState().history).toHaveLength(1);
    act(() => useEditorStore.getState().undo());
    expect(useEditorStore.getState().layers[0].from.subPaths[0].commands[1].points[1]).toEqual({
      x: 7,
      y: 0,
    });
  });
  it("cannot edit through a locked ancestor", () => {
    act(() =>
      useEditorStore.setState((state) => ({
        layers: [
          { ...state.layers[0]!, parentId: "parent" },
          { ...state.layers[0]!, id: "parent", type: "group", locked: true },
        ],
      })),
    );
    expect(editing.hitTest({ x: 100, y: 100 })).toBeNull();
    act(() => editing.start(selection(0)));
    expect(editing.hasDrag()).toBe(false);
  });
  it("does not resurrect frozen geometry after Undo during a drag", () => {
    act(() => editing.start(selection(0)));
    act(() => editing.update({ x: 98, y: 102 }, true));
    act(() => useEditorStore.getState().undo());
    act(() => editing.update({ x: 90, y: 110 }, true));
    act(() => editing.cancel());
    expect(useEditorStore.getState().layers[0]!.from.subPaths[0]!.commands[0]!.points[0]).toEqual({
      x: 0,
      y: 0,
    });
    expect(useEditorStore.getState().canRedo).toBe(true);
  });
  it("moves selected anchors through a rotated/scaled parent and undoes as one gesture", () => {
    act(() => {
      editing.start(selection(0));
      editing.finish();
      editing.start(selection(1), true);
      editing.finish();
    });
    act(() => editing.start(selection(0)));
    act(() => editing.update({ x: 94, y: 104 }, true));
    act(() => editing.update({ x: 90, y: 108 }, true));
    act(() => editing.finish());
    const points = useEditorStore
      .getState()
      .layers[0]!.from.subPaths[0]!.commands.map((command) => command.points[0]);
    expect(points.slice(0, 3)).toEqual([
      { x: 4, y: 5 },
      { x: 14, y: 5 },
      { x: 10, y: 10 },
    ]);
    expect(useEditorStore.getState().history).toHaveLength(1);
    act(() => useEditorStore.getState().undo());
    expect(useEditorStore.getState().layers[0]!.from.subPaths[0]!.commands[0]!.points[0]).toEqual({
      x: 0,
      y: 0,
    });
  });
  it("does not create undo entries for a click, and Shift toggles anchors off", () => {
    act(() => {
      editing.start(selection(0));
      editing.update({ x: 100, y: 100 }, true);
      editing.finish();
    });
    expect(useEditorStore.getState().history).toHaveLength(0);
    act(() => editing.start(selection(0), true));
    expect(editing.hasDrag()).toBe(false);
    expect(useEditorStore.getState().selectedPoints).toEqual([]);
  });
  it("restores all anchors when the gesture is cancelled", () => {
    act(() => {
      editing.start(selection(0));
      editing.finish();
      editing.start(selection(1), true);
      editing.finish();
      editing.start(selection(0));
    });
    act(() => editing.update({ x: 98, y: 102 }, true));
    act(() => editing.cancel());
    expect(useEditorStore.getState().layers[0]!.from.subPaths[0]!.commands[1]!.points[0]).toEqual({
      x: 10,
      y: 0,
    });
    expect(useEditorStore.getState().history).toHaveLength(0);
  });
});

describe("point drag invalidation and picking", () => {
  it("picks the nearest anchor, and respects an explicitly selected coincident anchor", () => {
    act(() =>
      useEditorStore
        .getState()
        .updateSelectedLayer(
          { from: parsePath("M0 0 L1 0 L1 0 Z"), pathData: parsePath("M0 0 L1 0 L1 0 Z") },
          { recordHistory: false },
        ),
    );
    expect(editing.hitTest({ x: 100, y: 102 })?.commandIndex).toBe(1);
    act(() => useEditorStore.getState().selectPoint(selection(2)));
    expect(editing.hitTest({ x: 100, y: 102 })?.commandIndex).toBe(2);
  });
  it("does not overwrite a non-history edit during a drag", () => {
    act(() => editing.start(selection(1)));
    act(() =>
      useEditorStore
        .getState()
        .updateSelectedLayer(
          { from: parsePath("M0 0 L20 0 Z"), pathData: parsePath("M0 0 L20 0 Z") },
          { recordHistory: false },
        ),
    );
    act(() => editing.update({ x: 90, y: 120 }, true));
    expect(useEditorStore.getState().layers[0].from.subPaths[0].commands[1].points[0]).toEqual({
      x: 20,
      y: 0,
    });
    expect(editing.hasDrag()).toBe(false);
  });
  it("inserts a pose and drags it in a single undo transaction", () => {
    act(() => {
      useEditorStore.setState({
        animation: {
          id: "motion",
          name: "Motion",
          duration: 1000,
          blocks: [
            {
              id: "shape",
              layerId: "path",
              type: "path",
              propertyName: "pathData",
              startTime: 0,
              endTime: 1000,
              fromValue: "M0 0 L10 0 L10 10 Z",
              toValue: "M0 0 L20 0 L20 20 Z",
              interpolator: "LINEAR",
            },
          ],
        },
        toolMode: "direct",
        progress: 0.5,
        isActionMode: false,
        isPlaying: false,
      });
      useEditorStore.getState().syncPathEditingWithPlayhead();
    });
    const before = useEditorStore.getState().animation;
    act(() => editing.start(selection(1)));
    act(() => editing.update({ x: 96, y: 134 }, true));
    act(() => editing.finish());
    expect(useEditorStore.getState().animation.blocks).toHaveLength(2);
    expect(useEditorStore.getState().history).toHaveLength(1);
    act(() => useEditorStore.getState().undo());
    expect(useEditorStore.getState().animation).toEqual(before);
  });
});
