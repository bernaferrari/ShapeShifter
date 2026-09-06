// @vitest-environment happy-dom

import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PathCanvas } from "../PathCanvas";
import { useEditorStore, type EditorState } from "@/lib/store/editorStore";
import { renderEditorComponent, type RenderedEditorComponent } from "./renderEditorComponent";

let rendered: RenderedEditorComponent | null = null;
let baseline: EditorState;

beforeEach(() => {
  baseline = useEditorStore.getState();
});

afterEach(() => {
  rendered?.unmount();
  rendered = null;
  useEditorStore.setState(baseline, true);
});

describe("PathCanvas hooks contract", () => {
  it("keeps rendering when the selected layer id dangles mid-mount instead of throwing", () => {
    const state = useEditorStore.getState();
    expect(state.layers.find((layer) => layer.id === state.selectedLayerId)).toBeDefined();
    rendered = renderEditorComponent(<PathCanvas side="from" />);
    expect(rendered.container.querySelector("svg")).not.toBeNull();

    // Simulates Delete in action mode: the selected layer vanishes while the
    // detail canvas stays mounted. An early return between hook calls would
    // throw "Rendered fewer hooks than expected" here.
    React.act(() => {
      useEditorStore.setState({ selectedLayerId: "no-longer-exists" });
    });

    expect(rendered.container.querySelector("svg")).not.toBeNull();
    const stateAfter = useEditorStore.getState();
    expect(
      stateAfter.layers.find((layer) => layer.id === stateAfter.selectedLayerId),
    ).toBeUndefined();
  });

  it("keeps rendering when every layer is deleted mid-mount", () => {
    rendered = renderEditorComponent(<PathCanvas side="preview" />);
    expect(rendered.container.querySelector("svg")).not.toBeNull();

    React.act(() => {
      useEditorStore.setState({ layers: [] });
    });

    expect(rendered.container.querySelector("svg")).not.toBeNull();
  });
});
