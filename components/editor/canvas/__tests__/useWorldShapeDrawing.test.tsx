// @vitest-environment happy-dom
import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useWorldShapeDrawing } from "../useWorldShapeDrawing";
import { useEditorStore, PAGE_ROOT_ID } from "@/lib/store/editorStore";
import { getAccuratePathBounds } from "@/lib/shapeshifter/pathUtils";
import {
  renderEditorComponent,
  type RenderedEditorComponent,
} from "../../__tests__/renderEditorComponent";

let baseline: ReturnType<typeof useEditorStore.getState>;
let rendered: RenderedEditorComponent;
let drawing: ReturnType<typeof useWorldShapeDrawing>;
beforeEach(() => {
  baseline = useEditorStore.getState();
  useEditorStore.setState({
    history: [],
    future: [],
    canUndo: false,
    snapToGrid: true,
    toolMode: "rectangle",
  });
  function Harness() {
    drawing = useWorldShapeDrawing({
      hitArtboard: (point) =>
        point.x >= 0 && point.x < 24 && point.y >= 0 && point.y < 24
          ? baseline.selectedFrameId
          : null,
      snapStep: 1,
      worldPerPixel: 0.1,
    });
    return null;
  }
  rendered = renderEditorComponent(<Harness />);
});
afterEach(() => {
  rendered.unmount();
  useEditorStore.setState(baseline, true);
});
const modifiers = { shift: false, alt: false, bypassSnap: false };

describe("Primitive drawing workflow", () => {
  it("creates a selected static rectangle in its frame with one undo step", () => {
    const count = useEditorStore.getState().layers.length;
    act(() => drawing.start({ x: 2.1, y: 3.2 }, false));
    act(() => drawing.update({ x: 13.6, y: 14.4 }, modifiers));
    expect(useEditorStore.getState().layers).toHaveLength(count);
    act(() => drawing.finish());
    const state = useEditorStore.getState();
    const layer = state.layers.at(-1)!;
    expect(state.layers).toHaveLength(count + 1);
    expect(getAccuratePathBounds(layer.from)).toEqual({ x: 2, y: 3, w: 12, h: 11 });
    expect(layer.to).toBeUndefined();
    expect(state.selectedLayerId).toBe(layer.id);
    expect(state.toolMode).toBe("select");
    expect(state.history).toHaveLength(1);
    act(() => state.undo());
    expect(useEditorStore.getState().layers).toHaveLength(count);
  });
  it("draws an equal-axis ellipse from its center on the page", () => {
    act(() => useEditorStore.getState().setToolMode("ellipse"));
    act(() => drawing.start({ x: 100, y: 100 }, true));
    act(() => drawing.update({ x: 104, y: 106 }, { shift: true, alt: true, bypassSnap: true }));
    act(() => drawing.finish());
    const state = useEditorStore.getState();
    expect(state.selectedFrameId).toBe(PAGE_ROOT_ID);
    const layer = state.layers.at(-1)!;
    expect(layer.name).toBe("Ellipse");
    expect(getAccuratePathBounds(layer.from)).toEqual({ x: 94, y: 94, w: 12, h: 12 });
    expect(layer.from.subPaths[0]!.commands.filter((command) => command.type === "C")).toHaveLength(
      4,
    );
    act(() => state.undo());
    expect(useEditorStore.getState().selectedFrameId).toBe(baseline.selectedFrameId);
    expect(useEditorStore.getState().rootLayers).toHaveLength(baseline.rootLayers.length);
  });
  it("cancels previews and clicks without creating phantom layers or undo history", () => {
    act(() => drawing.start({ x: 2, y: 2 }, false));
    act(() => drawing.finish());
    act(() => drawing.start({ x: 3, y: 3 }, false));
    act(() => drawing.update({ x: 8, y: 8 }, modifiers));
    act(() => drawing.cancel());
    expect(drawing.preview).toBeNull();
    expect(useEditorStore.getState().history).toHaveLength(0);
    expect(useEditorStore.getState().layers).toHaveLength(baseline.layers.length);
  });
});
