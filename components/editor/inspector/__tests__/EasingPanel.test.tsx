// @vitest-environment happy-dom

import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "@/lib/store/editorStore";
import { EasingPanel } from "../EasingPanel";
import {
  renderEditorComponent,
  type RenderedEditorComponent,
} from "../../__tests__/renderEditorComponent";

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

function mount(propertyName = "rotation") {
  const store = useEditorStore.getState();
  const layer = store.layers[0]!;
  store.selectLayer(layer.id);
  store.addTimelineBlock(layer.id, propertyName);
  const blockId = useEditorStore.getState().selectedBlockIds[0]!;
  rendered = renderEditorComponent(<LiveEasingPanel blockId={blockId} />);
  return { blockId, layer };
}

/** Re-reads the block from the store so the panel reflects edits, like the inspector. */
function LiveEasingPanel({ blockId }: { blockId: string }) {
  const block = useEditorStore((state) =>
    state.animation.blocks.find((item) => item.id === blockId),
  );
  return block ? <EasingPanel block={block} onBack={() => {}} /> : null;
}

function field(label: string) {
  const input = rendered!.container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  expect(input).toBeInstanceOf(HTMLInputElement);
  return input!;
}

function typeValue(input: HTMLInputElement, value: string) {
  React.act(() => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function key(input: Element, key: string) {
  React.act(() =>
    input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })),
  );
}

function block(id: string) {
  return useEditorStore.getState().animation.blocks.find((item) => item.id === id)!;
}

describe("easing panel", () => {
  it("edits custom curve coordinates precisely and moves focused handles from the keyboard", () => {
    const { blockId, layer } = mount();
    typeValue(field("Rotation easing curve"), "0.275, 1.35, 0.2, 1");
    key(field("Rotation easing curve"), "Enter");
    expect(block(blockId).interpolator).toBe("cubic-bezier(0.275, 1.35, 0.2, 1)");
    const handle = rendered!.container.querySelector('[aria-label="Easing control point 1"]')!;
    React.act(() =>
      handle.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowUp",
          altKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(block(blockId).interpolator).toBe("cubic-bezier(0.275, 1.351, 0.2, 1)");
    expect(
      useEditorStore.getState().layers.find((item) => item.id === layer.id)?.translateY ?? 0,
    ).toBe(0);
    React.act(() => useEditorStore.getState().undo());
    expect(block(blockId).interpolator).toBe("cubic-bezier(0.275, 1.35, 0.2, 1)");
    typeValue(field("Rotation easing curve"), "0.2, 0, 1.5, 1");
    key(field("Rotation easing curve"), "Enter");
    expect(field("Rotation easing curve").getAttribute("aria-invalid")).toBe("true");
  });

  it("groups a custom curve drag into one undo transaction and restores it on pointer cancellation", () => {
    const { blockId } = mount();
    const handle = rendered!.container.querySelector('[aria-label="Easing control point 1"]')!;
    const svg = handle.closest("svg")!;
    svg.getBoundingClientRect = () => ({ width: 120, height: 120, left: 0, top: 0 }) as DOMRect;
    const original = block(blockId).interpolator;
    const historyLength = useEditorStore.getState().history.length;
    const pointer = (element: Element, type: string, clientX = 0, clientY = 0) =>
      React.act(() =>
        element.dispatchEvent(
          new PointerEvent(type, {
            clientX,
            clientY,
            button: 0,
            pointerId: 1,
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
    pointer(handle, "pointerdown");
    pointer(svg, "pointerup");
    expect(useEditorStore.getState().history).toHaveLength(historyLength);
    pointer(handle, "pointerdown");
    pointer(svg, "pointermove", 55, 25);
    pointer(svg, "pointermove", 60, 20);
    expect(block(blockId).interpolator).not.toBe(original);
    expect(useEditorStore.getState().history).toHaveLength(historyLength + 1);
    pointer(svg, "pointercancel");
    expect(block(blockId).interpolator).toBe(original);
    expect(useEditorStore.getState().history).toHaveLength(historyLength);
  });
});

describe("easing presets", () => {
  it("applies a named preset from the picker", () => {
    const { blockId } = mount();
    const select = rendered!.container.querySelector<HTMLSelectElement>(
      'select[aria-label="Rotation easing"]',
    )!;
    React.act(() => {
      select.value = "LINEAR";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(block(blockId).interpolator).toBe("LINEAR");
  });
});
