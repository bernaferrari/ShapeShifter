// @vitest-environment happy-dom
import React, { act, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "@/lib/store/editorStore";
import { createPathLayer } from "@/lib/store/defaultWorkspace";
import { parsePath } from "@/lib/shapeshifter/pathUtils";
import { usePathCanvasEditing } from "../usePathCanvasEditing";
import {
  renderEditorComponent,
  type RenderedEditorComponent,
} from "../../__tests__/renderEditorComponent";

let baseline: ReturnType<typeof useEditorStore.getState>;
let rendered: RenderedEditorComponent;
let editing: ReturnType<typeof usePathCanvasEditing>;
const source = "M0 0 C3 0 7 0 10 0 C13 0 17 0 20 0";
beforeEach(() => {
  baseline = useEditorStore.getState();
  const path = parsePath(source);
  useEditorStore.setState({
    layers: [
      createPathLayer({
        id: "curve",
        name: "Curve",
        from: path,
        pathData: path,
        visible: true,
        locked: false,
      }),
    ],
    selectedLayerId: "curve",
    selectedLayerIds: ["curve"],
    selectedLayerRefs: [{ ownerId: baseline.selectedFrameId, layerId: "curve" }],
    selection: null,
    selectedPoints: [],
    selectedSubPaths: [],
    selectedBlockIds: [],
    editingSide: "from",
    isActionMode: true,
    toolMode: "direct",
    animation: { id: "test", name: "Test", duration: 1000, blocks: [] },
    history: [],
    future: [],
    isPlaying: false,
    dragState: null,
  });
  function Harness() {
    const state = useEditorStore();
    const svgRef = useRef<SVGSVGElement | null>(null);
    const down = useRef<{ x: number; y: number } | null>(null);
    editing = usePathCanvasEditing({
      side: "from",
      svgRef,
      view: { x: 0, y: 0, w: 100, h: 100, scale: 1 },
      pointFromClient: (x, y) => ({ x, y }),
      pointerDownPositionRef: down,
      currentLayer: state.layers[0],
      selectedLayerId: "curve",
      editingSide: "from",
      selectedPoints: state.selectedPoints,
      selection: state.selection,
      selectedLayerSubPaths: [],
      isEditingThisSide: true,
      isActionMode: true,
      snapToGrid: false,
      selectedLayerBounds: null,
    });
    return (
      <svg ref={svgRef}>
        <circle />
      </svg>
    );
  }
  rendered = renderEditorComponent(<Harness />);
});
afterEach(() => {
  rendered.unmount();
  useEditorStore.setState(baseline, true);
});
function start() {
  act(() =>
    editing.onPointPointerDown(
      {
        button: 0,
        pointerId: 1,
        clientX: 10,
        clientY: 0,
        shiftKey: false,
        stopPropagation() {},
        currentTarget: rendered.container.querySelector("circle")!,
      } as unknown as React.PointerEvent<Element>,
      0,
      1,
      2,
    ),
  );
}
function move(x: number, y: number) {
  act(() =>
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: y, buttons: 1 })),
  );
}
const commands = () => useEditorStore.getState().layers[0].from.subPaths[0].commands;

describe("detail Direct curve editing", () => {
  it("moves attached handles from frozen geometry and records one Undo gesture", () => {
    start();
    move(12, 3);
    move(15, 5);
    act(() => window.dispatchEvent(new PointerEvent("pointerup")));
    expect(commands()[1].points).toEqual([
      { x: 3, y: 0 },
      { x: 12, y: 5 },
      { x: 15, y: 5 },
    ]);
    expect(commands()[2].points[0]).toEqual({ x: 18, y: 5 });
    expect(useEditorStore.getState().history).toHaveLength(1);
    act(() => useEditorStore.getState().undo());
    expect(commands()[1].points[1]).toEqual({ x: 7, y: 0 });
  });
  it("deduplicates explicitly selected handles with their selected anchor", () => {
    act(() => {
      const store = useEditorStore.getState();
      store.selectPoint({
        layerId: "curve",
        side: "from",
        subPathIndex: 0,
        commandIndex: 1,
        pointIndex: 2,
      });
      store.selectPoint(
        { layerId: "curve", side: "from", subPathIndex: 0, commandIndex: 1, pointIndex: 1 },
        true,
      );
    });
    start();
    move(12, 3);
    expect(commands()[1].points[1]).toEqual({ x: 9, y: 3 });
  });
  it.each(["pointercancel", "Escape"])("cancels the whole tangent edit on %s", (action) => {
    start();
    move(12, 3);
    act(() =>
      window.dispatchEvent(
        action === "Escape"
          ? new KeyboardEvent("keydown", { key: "Escape", cancelable: true })
          : new PointerEvent(action),
      ),
    );
    expect(commands()[1].points[1]).toEqual({ x: 7, y: 0 });
    expect(useEditorStore.getState().history).toHaveLength(0);
    expect(useEditorStore.getState().dragState).toBeNull();
  });
  it("cannot resurrect a curve after Undo during its drag, and creates no history for clicks", () => {
    start();
    move(10, 0);
    expect(useEditorStore.getState().history).toHaveLength(0);
    move(12, 3);
    act(() => useEditorStore.getState().undo());
    move(15, 5);
    expect(commands()[1].points[1]).toEqual({ x: 7, y: 0 });
    expect(useEditorStore.getState().canRedo).toBe(true);
  });
  it("does not edit anchors under a locked ancestor", () => {
    act(() =>
      useEditorStore.setState((state) => ({
        layers: [
          { ...state.layers[0], parentId: "group" },
          { ...state.layers[0], id: "group", type: "group", locked: true },
        ],
      })),
    );
    start();
    move(12, 3);
    expect(commands()[1].points[1]).toEqual({ x: 7, y: 0 });
    expect(useEditorStore.getState().history).toHaveLength(0);
  });
});
