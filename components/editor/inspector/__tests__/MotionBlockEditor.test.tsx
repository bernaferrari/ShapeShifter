// @vitest-environment happy-dom

import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "@/lib/store/editorStore";
import { numberAtTime } from "@/lib/shapeshifter/playheadResolve";
import { MotionPanel } from "../InspectorPanels";
import {
  renderEditorComponent,
  buttonWithText,
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
  rendered = renderEditorComponent(
    <MotionPanel layer={layer} selectionCount={1} onEditMorph={() => {}} />,
  );
  return { blockId, layer };
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

describe("motion endpoint authoring", () => {
  it("turns a newly added static track into real motion and undoes the endpoint edit", () => {
    const { blockId, layer } = mount();
    const from = Number(block(blockId).fromValue);
    typeValue(field("Rotation to value"), String(from + 180.375));
    key(field("Rotation to value"), "Enter");

    const edited = block(blockId);
    expect(edited.toValue).toBe(from + 180.375);
    expect(numberAtTime(layer, [edited], "rotation", 1000, 1000)).toBe(from + 180.375);
    React.act(() => useEditorStore.getState().undo());
    expect(block(blockId).toValue).toBe(from);
  });

  it("accepts exact timing and rejects an end before the start", () => {
    const { blockId } = mount();
    typeValue(field("Rotation start time"), "137.5");
    key(field("Rotation start time"), "Enter");
    expect(block(blockId).startTime).toBe(137.5);

    typeValue(field("Rotation end time"), "100");
    key(field("Rotation end time"), "Enter");
    expect(block(blockId).endTime).toBe(useEditorStore.getState().animation.duration);
    expect(field("Rotation end time").getAttribute("aria-invalid")).toBe("true");
    expect(rendered!.container.querySelector('[role="alert"]')?.textContent).toContain("ms");
  });

  it("discards endpoint drafts on Escape without recording history", () => {
    const { blockId } = mount();
    const before = block(blockId).toValue;
    const historyLength = useEditorStore.getState().history.length;
    typeValue(field("Rotation to value"), "275");
    key(field("Rotation to value"), "Escape");
    expect(block(blockId).toValue).toBe(before);
    expect(field("Rotation to value").value).toBe(String(before));
    expect(useEditorStore.getState().history.length).toBe(historyLength);
  });

  it("keeps incomplete numeric drafts out of the model", () => {
    const { blockId } = mount();
    const before = block(blockId).fromValue;
    typeValue(field("Rotation from value"), "-");
    key(field("Rotation from value"), "Enter");
    expect(block(blockId).fromValue).toBe(before);
    expect(field("Rotation from value").getAttribute("aria-invalid")).toBe("true");
  });

  it("authors color endpoints with alpha and preserves invalid drafts for correction", () => {
    const { blockId } = mount("fillColor");
    typeValue(field("Fill to value"), "#ff000080");
    key(field("Fill to value"), "Enter");
    expect(block(blockId).toValue).toBe("#ff000080");
    typeValue(field("Fill to value"), "#12");
    key(field("Fill to value"), "Enter");
    expect(block(blockId).toValue).toBe("#ff000080");
    expect(field("Fill to value").value).toBe("#12");
    expect(field("Fill to value").getAttribute("aria-invalid")).toBe("true");
  });

  it("displays scale percentages while storing their scalar values", () => {
    const { blockId } = mount("scaleX");
    typeValue(field("Scale X to value"), "125,5");
    key(field("Scale X to value"), "Enter");
    expect(block(blockId).toValue).toBe(1.255);
    expect(field("Scale X to value").value).toBe("125.5");
  });

  it("pauses playback to preview an endpoint", () => {
    const { blockId } = mount();
    React.act(() => {
      useEditorStore.getState().updateTimelineBlock(blockId, { endTime: 700 });
      useEditorStore.setState({ isPlaying: true });
    });
    React.act(() => {
      rendered!.container
        .querySelector<HTMLButtonElement>('[aria-label="Preview Rotation to value"]')!
        .click();
    });
    expect(useEditorStore.getState().isPlaying).toBe(false);
    expect(useEditorStore.getState().progress).toBeCloseTo(
      700 / useEditorStore.getState().animation.duration,
    );
  });

  it("authors SVG path endpoints and keeps invalid path drafts available for correction", () => {
    const { blockId } = mount("pathData");
    const textarea = rendered!.container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Path from value"]',
    )!;
    expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
    const typePath = (value: string) =>
      React.act(() => {
        textarea.focus();
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
          textarea,
          value,
        );
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      });
    const original = block(blockId).fromValue;
    typePath("M 0 0 L 20 20");
    key(textarea, "Enter");
    expect(block(blockId).fromValue).toBe("M 0 0 L 20 20");
    React.act(() => useEditorStore.getState().undo());
    expect(block(blockId).fromValue).toBe(original);
    typePath("broken path");
    key(textarea, "Enter");
    expect(block(blockId).fromValue).toBe(original);
    expect(textarea.getAttribute("aria-invalid")).toBe("true");
    expect(textarea.value).toBe("broken path");
  });

  it("edits custom curve coordinates precisely and moves focused handles from the keyboard", () => {
    const { blockId, layer } = mount();
    React.act(() => buttonWithText(rendered!.container, "Custom easing curve").click());
    typeValue(field("Rotation easing X1"), "0.275");
    key(field("Rotation easing X1"), "Enter");
    typeValue(field("Rotation easing Y1"), "1.35");
    key(field("Rotation easing Y1"), "Enter");
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
    typeValue(field("Rotation easing X2"), "1.5");
    key(field("Rotation easing X2"), "Enter");
    expect(field("Rotation easing X2").getAttribute("aria-invalid")).toBe("true");
  });

  it("groups a custom curve drag into one undo transaction and restores it on pointer cancellation", () => {
    const { blockId } = mount();
    React.act(() => buttonWithText(rendered!.container, "Custom easing curve").click());
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
