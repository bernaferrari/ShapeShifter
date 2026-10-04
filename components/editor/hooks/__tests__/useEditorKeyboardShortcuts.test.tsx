// @vitest-environment happy-dom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorStore } from "@/lib/store/editorStore";
import {
  renderEditorComponent,
  type RenderedEditorComponent,
} from "../../__tests__/renderEditorComponent";
import { isEditorShortcutBlocked, useEditorKeyboardShortcuts } from "../useEditorKeyboardShortcuts";
import { BottomToolPalette } from "../../BottomToolPalette";

function KeyboardHarness() {
  useEditorKeyboardShortcuts();
  return (
    <>
      <button type="button">Play</button>
      <input aria-label="Name" />
    </>
  );
}

function dispatchKey(init: KeyboardEventInit) {
  React.act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
    );
  });
}

function dispatchAt(target: EventTarget, type: "keydown" | "keyup", init: KeyboardEventInit) {
  const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
  React.act(() => target.dispatchEvent(event));
  return event;
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
  vi.restoreAllMocks();
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

  it("nudges selected artboards without moving their artwork", () => {
    const store = useEditorStore.getState();
    const frame = store.frames[0]!;
    store.selectFrame(frame.id);
    const layer = useEditorStore.getState().layers[0]!;
    const beforeLayerX = layer.translateX ?? 0;

    dispatchKey({ key: "ArrowRight", shiftKey: true });

    expect(useEditorStore.getState().frames.find((item) => item.id === frame.id)!.x).toBe(
      frame.x + 5,
    );
    expect(useEditorStore.getState().layers[0]!.translateX ?? 0).toBe(beforeLayerX);
    React.act(() => useEditorStore.getState().undo());
    expect(useEditorStore.getState().frames.find((item) => item.id === frame.id)!.x).toBe(frame.x);
  });

  it("does not move latent artwork when the canvas has no selection", () => {
    useEditorStore.getState().deselectAll();
    const layers = useEditorStore.getState().layers;
    dispatchKey({ key: "ArrowRight" });
    expect(useEditorStore.getState().layers).toEqual(layers);
  });

  it("lets a focused button own Space and arrow keys", () => {
    const store = useEditorStore.getState();
    store.selectLayer(store.layers[0]!.id);
    useEditorStore.setState({ isPlaying: false });
    const layers = useEditorStore.getState().layers;
    const button = rendered!.container.querySelector("button")!;

    const down = dispatchAt(button, "keydown", { key: " ", code: "Space" });
    dispatchAt(button, "keyup", { key: " ", code: "Space" });
    dispatchAt(button, "keydown", { key: "ArrowRight" });

    expect(down.defaultPrevented).toBe(false);
    expect(useEditorStore.getState().isPlaying).toBe(false);
    expect(useEditorStore.getState().spacePanActive).toBe(false);
    expect(useEditorStore.getState().layers).toEqual(layers);
  });

  it("keeps tool shortcuts available after focusing a toolbar button", () => {
    const button = rendered!.container.querySelector("button")!;
    dispatchAt(button, "keydown", { key: "p" });
    expect(useEditorStore.getState().toolMode).toBe("pen");
    dispatchAt(button, "keydown", { key: "a" });
    expect(useEditorStore.getState().toolMode).toBe("direct");
  });

  it("switches tools from the focused Base UI tooltip/button in the drawing palette", () => {
    rendered!.unmount();
    rendered = renderEditorComponent(
      <>
        <KeyboardHarness />
        <BottomToolPalette />
      </>,
    );
    const move = rendered.container.querySelector<HTMLButtonElement>('button[aria-label="Move"]')!;
    React.act(() => move.focus());
    dispatchAt(move, "keydown", { key: "p", code: "KeyP" });
    expect(useEditorStore.getState().toolMode).toBe("pen");
    expect(
      rendered.container.querySelector('button[aria-label="Pen"]')!.getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("blocks editor mutations while a modal is open", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.append(dialog);
    const store = useEditorStore.getState();
    store.selectLayer(store.layers[0]!.id);
    const beforeCount = useEditorStore.getState().layers.length;
    try {
      dispatchKey({ key: "d", ctrlKey: true });
      dispatchKey({ key: "Delete" });
      dispatchKey({ key: "p" });
      expect(useEditorStore.getState().layers).toHaveLength(beforeCount);
      expect(useEditorStore.getState().toolMode).toBe("select");
    } finally {
      dialog.remove();
    }
  });

  it("blocks canvas shortcuts inside nonmodal dialogs and menus", () => {
    for (const role of ["dialog", "menu"]) {
      const surface = document.createElement("div");
      surface.setAttribute("role", role);
      rendered!.container.append(surface);
      dispatchAt(surface, "keydown", { key: "p" });
      expect(useEditorStore.getState().toolMode).toBe("select");
      surface.remove();
    }
  });

  it("does not toggle playback for a Space release without a canvas press", () => {
    useEditorStore.setState({ isPlaying: false });
    dispatchAt(window, "keyup", { key: " ", code: "Space" });
    const input = rendered!.container.querySelector("input")!;
    dispatchAt(input, "keydown", { key: " ", code: "Space" });
    dispatchAt(window, "keyup", { key: " ", code: "Space" });
    expect(useEditorStore.getState().isPlaying).toBe(false);
  });

  it("releases panning after window blur without a late playback toggle", () => {
    useEditorStore.setState({ isPlaying: false });
    dispatchKey({ key: " ", code: "Space" });
    expect(useEditorStore.getState().spacePanActive).toBe(true);

    React.act(() => window.dispatchEvent(new Event("blur")));
    expect(useEditorStore.getState().spacePanActive).toBe(false);
    dispatchAt(window, "keyup", { key: " ", code: "Space" });
    expect(useEditorStore.getState().isPlaying).toBe(false);

    dispatchKey({ key: "h" });
    expect(useEditorStore.getState().spacePanActive).toBe(true);
    React.act(() => window.dispatchEvent(new Event("blur")));
    expect(useEditorStore.getState().spacePanActive).toBe(false);
  });

  it("releases Space panning even when focus moves into a text field", () => {
    useEditorStore.setState({ isPlaying: false });
    dispatchKey({ key: " ", code: "Space" });
    dispatchAt(rendered!.container.querySelector("input")!, "keyup", { key: " ", code: "Space" });
    expect(useEditorStore.getState().spacePanActive).toBe(false);
    expect(useEditorStore.getState().isPlaying).toBe(false);
  });

  it("keeps explicit timeline Delete available on focused keyframe and block controls", () => {
    const button = rendered!.container.querySelector("button")!;
    for (const attribute of ["data-timeline-keyframe-block-id", "data-timeline-block-id"]) {
      button.setAttribute(attribute, "block");
      const event = new KeyboardEvent("keydown", { key: "Delete" });
      Object.defineProperty(event, "target", { value: button });
      expect(isEditorShortcutBlocked(event)).toBe(false);
      button.removeAttribute(attribute);
    }
  });

  it("releases panning when the document is hidden", () => {
    dispatchKey({ key: "h" });
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    React.act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(useEditorStore.getState().spacePanActive).toBe(false);
  });

  it("does not reinterpret composition or unsupported modifier shortcuts as canvas tools", () => {
    const store = useEditorStore.getState();
    store.selectLayer(store.layers[0]!.id);
    const layers = useEditorStore.getState().layers;
    dispatchKey({ key: "p", isComposing: true });
    dispatchKey({ key: "p", altKey: true });
    dispatchKey({ key: "ArrowRight", metaKey: true });
    expect(useEditorStore.getState().toolMode).toBe("select");
    expect(useEditorStore.getState().layers).toEqual(layers);
  });
});
