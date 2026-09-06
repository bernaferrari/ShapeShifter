// @vitest-environment happy-dom

import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "@/lib/store/editorStore";
import { renderEditorComponent, type RenderedEditorComponent } from "../../__tests__/renderEditorComponent";
import { useEditorKeyboardShortcuts } from "../useEditorKeyboardShortcuts";

function KeyboardHarness() {
  useEditorKeyboardShortcuts();
  return null;
}

function dispatchKey(init: KeyboardEventInit) {
  React.act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });
}

let rendered: RenderedEditorComponent | null = null;
let baseline: ReturnType<typeof useEditorStore.getState>;

beforeEach(() => {
  baseline = useEditorStore.getState();
  useEditorStore.getState().resetProject();
  rendered = renderEditorComponent(<KeyboardHarness />);
});

afterEach(() => {
  rendered?.unmount();
  rendered = null;
  useEditorStore.setState(baseline, true);
});

describe("useEditorKeyboardShortcuts", () => {
  it("resolves Control command shortcuts before tool keys", () => {
    const store = useEditorStore.getState();
    const sourceId = store.layers[0]!.id;
    store.selectLayer(sourceId);
    store.setToolMode("pen");
    store.copyLayers([sourceId]);
    const beforeCount = useEditorStore.getState().layers.length;

    dispatchKey({ key: "v", ctrlKey: true });
    expect(useEditorStore.getState().layers.length).toBe(beforeCount + 1);
    expect(useEditorStore.getState().toolMode).toBe("pen");

    dispatchKey({ key: "d", ctrlKey: true });
    expect(useEditorStore.getState().layers.length).toBe(beforeCount + 2);
    expect(useEditorStore.getState().toolMode).toBe("pen");

    const pastedId = useEditorStore.getState().selectedLayerId;
    dispatchKey({ key: "x", ctrlKey: true });
    expect(
      useEditorStore.getState().layers.some((layer) => String(layer.id) === String(pastedId)),
    ).toBe(false);
    expect(useEditorStore.getState().toolMode).toBe("pen");
  });

  it("does not nudge the canvas when a local control already handled the arrow key", () => {
    const store = useEditorStore.getState();
    const layer = store.layers[0]!;
    store.selectLayer(layer.id);
    const beforeX = layer.translateX ?? 0;
    const event = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "defaultPrevented", { get: () => true });

    React.act(() => {
      window.dispatchEvent(event);
    });

    expect(useEditorStore.getState().layers[0]!.translateX ?? 0).toBe(beforeX);
  });
});
