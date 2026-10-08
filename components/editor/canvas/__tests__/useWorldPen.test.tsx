// @vitest-environment happy-dom
import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useWorldPen } from "../useWorldPen";
import { useWorldPenCreation } from "../useWorldPenCreation";
import { useEditorStore } from "@/lib/store/editorStore";
import { createPathLayer } from "@/lib/store/defaultWorkspace";
import { parsePath, pathToString } from "@/lib/pathshift/pathUtils";
import { createEditorAgent } from "@/lib/agent/editorAgent";
import {
  renderEditorComponent,
  type RenderedEditorComponent,
} from "../../__tests__/renderEditorComponent";

let baseline: ReturnType<typeof useEditorStore.getState>;
let rendered: RenderedEditorComponent;
let pen: ReturnType<typeof useWorldPen>;
let createPenPath: ReturnType<typeof useWorldPenCreation>;
beforeEach(() => {
  baseline = useEditorStore.getState();
  const path = parsePath("M 0 0 L 10 0");
  useEditorStore.setState({
    layers: [
      createPathLayer({
        id: "pen",
        name: "Pen",
        from: path,
        pathData: path,
        visible: true,
        locked: false,
      }),
    ],
    selectedLayerId: "pen",
    selectedLayerIds: ["pen"],
    selectedLayerRefs: [{ ownerId: baseline.selectedFrameId, layerId: "pen" }],
    animation: { id: "test", name: "Test", duration: 1000, blocks: [] },
    history: [],
    future: [],
    canUndo: false,
    canRedo: false,
    isPlaying: false,
    isActionMode: false,
    toolMode: "pen",
    dragState: null,
  });
  function Harness() {
    const path = useEditorStore(
      (state) =>
        state.layers.find((layer) => String(layer.id) === String(state.selectedLayerId))!.from,
    );
    pen = useWorldPen({
      path,
      snapStep: 1,
      worldPerPixel: 0.1,
      commit: (next) =>
        useEditorStore
          .getState()
          .updateSelectedLayer({ from: next, pathData: next }, { recordHistory: false }),
    });
    createPenPath = useWorldPenCreation({
      activeSubpathRef: pen.activeSubpathRef,
      beginPath: pen.beginPath,
      snapStep: 1,
      hitArtboard: () => useEditorStore.getState().frames[1]!.id,
    });
    return null;
  }
  rendered = renderEditorComponent(<Harness />);
});
afterEach(() => {
  rendered.unmount();
  useEditorStore.setState(baseline, true);
});

describe("World pen transaction ownership", () => {
  it("keeps ordinary Pen commits active, then clears construction and deleted outgoing tangents on Undo/Redo", () => {
    act(() => pen.pointerDown({ x: 20, y: 20 }));
    act(() => pen.pointerDrag({ x: 23, y: 25 }));
    act(() => pen.pointerUp());
    expect(pen.activeSubpathRef.current).not.toBeNull();
    act(() => pen.pointerDown({ x: 30, y: 20 }));
    act(() => pen.pointerDrag({ x: 33, y: 25 }));
    act(() => pen.pointerUp());
    expect(pen.activeSubpathRef.current).not.toBeNull();
    act(() => useEditorStore.getState().undo());
    expect(pen.activeSubpathRef.current).toBeNull();
    act(() => useEditorStore.getState().redo());
    expect(pen.activeSubpathRef.current).toBeNull();
    act(() => pen.pointerDown({ x: 40, y: 20 }));
    act(() => pen.pointerUp());
    act(() => pen.pointerDown({ x: 50, y: 20 }));
    act(() => pen.pointerUp());
    const commands = useEditorStore.getState().layers[0].from.subPaths.at(-1)!.commands;
    expect(commands.map((command) => command.type)).toEqual(["M", "L"]);
  });
  it("starts an independent path in the pointed owner and cancels the first anchor atomically", () => {
    const frame = useEditorStore.getState().frames[1]!;
    const before = pathToString(useEditorStore.getState().layers[0]!.from);
    act(() => expect(createPenPath({ x: frame.x + 1.4, y: frame.y + 2.2 }, false)).toBe(true));
    const state = useEditorStore.getState();
    expect(state.selectedFrameId).toBe(frame.id);
    const created = state.layers.find((layer) => layer.id === state.selectedLayerId)!;
    expect(pathToString(created.from)).toBe("M1 2");
    expect(created.strokeWidth).toBe(1);
    expect(state.toolMode).toBe("pen");
    expect(state.history).toHaveLength(1);
    act(() => pen.cancelPointer());
    expect(useEditorStore.getState().selectedFrameId).toBe(baseline.selectedFrameId);
    expect(pathToString(useEditorStore.getState().layers[0]!.from)).toBe(before);
    expect(useEditorStore.getState().history).toHaveLength(0);
  });
  it("restores the inserted anchor on native pointer cancellation", () => {
    act(() => pen.pointerDown({ x: 20, y: 20 }));
    expect(useEditorStore.getState().dragState).not.toBeNull();
    act(() => pen.pointerDrag({ x: 23, y: 25 }));
    act(() => pen.cancelPointer());
    expect(pathToString(useEditorStore.getState().layers[0]!.from)).toBe("M0 0 L10 0");
    expect(useEditorStore.getState().history).toHaveLength(0);
    expect(useEditorStore.getState().dragState).toBeNull();
  });
  it("cannot revive an inserted anchor after Undo during its drag", () => {
    act(() => pen.pointerDown({ x: 20, y: 20 }));
    act(() => useEditorStore.getState().undo());
    act(() => pen.pointerDrag({ x: 24, y: 25 }));
    act(() => pen.cancelPointer());
    expect(pathToString(useEditorStore.getState().layers[0]!.from)).toBe("M0 0 L10 0");
    expect(useEditorStore.getState().canRedo).toBe(true);
  });
  it("rejects agent edits during a live pointer and accepts them after release", () => {
    act(() => pen.pointerDown({ x: 20, y: 20 }));
    const agent = createEditorAgent();
    const { revision } = agent.inspect();
    const request = {
      expectedRevision: revision,
      commands: [
        {
          type: "renameLayer" as const,
          ownerId: useEditorStore.getState().selectedFrameId,
          layerId: "pen",
          name: "Finished",
        },
      ],
    };
    expect(() => agent.apply(request)).toThrow("Finish the current gesture");
    act(() => pen.pointerUp());
    act(() => agent.apply(request));
    expect(useEditorStore.getState().layers[0]!.name).toBe("Finished");
  });
});
