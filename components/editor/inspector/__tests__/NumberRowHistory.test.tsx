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
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 10, pointerId: 1 }),
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
});
