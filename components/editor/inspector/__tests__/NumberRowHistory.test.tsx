// @vitest-environment happy-dom

import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "@/lib/store/editorStore";
import {
  renderEditorComponent,
  type RenderedEditorComponent,
} from "../../__tests__/renderEditorComponent";
import { NumberRow } from "../InspectorControls";

function NumberRowHarness({ kind }: { kind: "layer" | "vector" }) {
  const translateX = useEditorStore((state) => state.layers[0]?.translateX ?? 0);
  const width = useEditorStore((state) => state.vector.width);
  if (kind === "vector") {
    return (
      <NumberRow
        label="W"
        value={width}
        onChange={(value) => useEditorStore.getState().updateVector({ width: value })}
      />
    );
  }
  return (
    <NumberRow
      label="X"
      value={translateX}
      onChange={(value) => useEditorStore.getState().updateSelectedLayer({ translateX: value })}
    />
  );
}

function scrub(slider: Element, deltas: number[]) {
  React.act(() => {
    slider.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        pointerId: 1,
        button: 0,
        buttons: 1,
        isPrimary: true,
        pointerType: "mouse",
      }),
    );
  });
  for (const delta of deltas) {
    React.act(() => {
      slider.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          cancelable: true,
          clientX: 10 + delta,
          pointerId: 1,
          button: 0,
          buttons: 1,
          isPrimary: true,
          pointerType: "mouse",
        }),
      );
    });
  }
  React.act(() => {
    slider.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        clientX: 10 + deltas.at(-1)!,
        pointerId: 1,
        button: 0,
        isPrimary: true,
        pointerType: "mouse",
      }),
    );
  });
}

let rendered: RenderedEditorComponent | null = null;
let baseline: ReturnType<typeof useEditorStore.getState>;

beforeEach(() => {
  baseline = useEditorStore.getState();
  useEditorStore.getState().resetProject();
});

afterEach(() => {
  rendered?.unmount();
  rendered = null;
  useEditorStore.setState(baseline, true);
});

describe("NumberRow history", () => {
  it("undoes several inspector numeric ticks as one step", () => {
    const layer = useEditorStore.getState().layers[0]!;
    useEditorStore.getState().selectLayer(layer.id);
    const startX = layer.translateX ?? 0;
    rendered = renderEditorComponent(<NumberRowHarness kind="layer" />);
    const slider = rendered.container.querySelector('[role="slider"]');
    expect(slider).toBeInstanceOf(HTMLElement);

    scrub(slider!, [8, 16, 24]);
    expect(useEditorStore.getState().layers[0]!.translateX).not.toBe(startX);

    React.act(() => {
      useEditorStore.getState().undo();
    });
    expect(useEditorStore.getState().layers[0]!.translateX ?? 0).toBe(startX);
  });

  it("undoes several artboard size ticks as one step", () => {
    const startWidth = useEditorStore.getState().vector.width;
    rendered = renderEditorComponent(<NumberRowHarness kind="vector" />);
    const slider = rendered.container.querySelector('[role="slider"]');
    expect(slider).toBeInstanceOf(HTMLElement);

    scrub(slider!, [6, 12, 18]);
    expect(useEditorStore.getState().vector.width).not.toBe(startWidth);

    React.act(() => {
      useEditorStore.getState().undo();
    });
    expect(useEditorStore.getState().vector.width).toBe(startWidth);
  });

  it("keeps the displayed value live when scrubbing a focused numeric field", () => {
    const layer = useEditorStore.getState().layers[0]!;
    useEditorStore.getState().selectLayer(layer.id);
    rendered = renderEditorComponent(<NumberRowHarness kind="layer" />);
    const input = rendered.container.querySelector("input")!;
    React.act(() => input.focus());
    scrub(rendered.container.querySelector('[role="slider"]')!, [10]);
    expect(input.value).toBe(String(useEditorStore.getState().layers[0]!.translateX));
    expect(useEditorStore.getState().historyGestureActive).toBe(false);
  });
});
