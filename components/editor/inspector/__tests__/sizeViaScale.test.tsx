// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "@/lib/store/editorStore";
import { Inspector } from "../../Inspector";
import {
  renderEditorComponent,
  type RenderedEditorComponent,
} from "../../__tests__/renderEditorComponent";

let baseline: ReturnType<typeof useEditorStore.getState>;
let rendered: RenderedEditorComponent | null = null;
beforeEach(() => {
  baseline = useEditorStore.getState();
  useEditorStore.getState().resetProject();
});
afterEach(() => {
  rendered?.unmount();
  rendered = null;
  useEditorStore.setState(baseline, true);
});

function field(label: string) {
  return rendered!.container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
}
function commit(input: HTMLInputElement, value: string) {
  React.act(() => input.focus());
  React.act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  React.act(() =>
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  React.act(() => input.blur());
}
const layer = () =>
  useEditorStore
    .getState()
    .layers.find((item) => String(item.id) === String(useEditorStore.getState().selectedLayerId))!;

describe("W/H on a morphing shape", () => {
  it("resizes through scale instead of rewriting the morph keyframes", () => {
    // The starter "Upper" path morphs, so its outline is animated.
    const pathBlocks = () =>
      useEditorStore
        .getState()
        .animation.blocks.filter(
          (block) =>
            String(block.layerId) === String(layer().id) && block.propertyName === "pathData",
        );
    const before = structuredClone(pathBlocks());
    rendered = renderEditorComponent(<Inspector />);
    const width = Number(field("W").value);

    commit(field("W"), String(width * 2));

    expect(pathBlocks()).toEqual(before);
    expect(layer().scaleX).toBeCloseTo(2);
    expect(layer().scaleY).toBeCloseTo(2);
    expect(Number(field("W").value)).toBeCloseTo(width * 2);
    // Scaling anchors on the shape's center rather than Android's top-left default.
    expect(layer().pivotX).not.toBe(0);
  });
});
