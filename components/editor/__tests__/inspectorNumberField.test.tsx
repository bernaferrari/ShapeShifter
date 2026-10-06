// @vitest-environment happy-dom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NumberRow } from "../inspector/InspectorControls";
import { useEditorStore } from "@/lib/store/editorStore";
import { renderEditorComponent, type RenderedEditorComponent } from "./renderEditorComponent";

let rendered: RenderedEditorComponent | null = null;
let baseline: ReturnType<typeof useEditorStore.getState>;

beforeEach(() => {
  baseline = useEditorStore.getState();
});

afterEach(() => {
  rendered?.unmount();
  rendered = null;
  useEditorStore.setState(baseline, true);
});

function typeValue(input: HTMLInputElement, value: string) {
  React.act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function key(input: Element, value: string) {
  React.act(() => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }),
    );
  });
}

describe.each([false, true])("NumberRow numeric editing (compact=%s)", (compact) => {
  function mount(options: { min?: number; max?: number; mixed?: boolean } = {}) {
    const onChange = vi.fn();
    function Field() {
      const [value, setValue] = React.useState(12.25);
      return (
        <NumberRow
          label="X"
          value={value}
          compact={compact}
          {...options}
          onChange={(next) => {
            onChange(next);
            setValue(next);
          }}
        />
      );
    }
    rendered = renderEditorComponent(<Field />);
    const input = rendered.container.querySelector("input")!;
    React.act(() => input.focus());
    return { input, onChange };
  }

  it("keeps intermediate drafts out of the document and commits decimal precision on blur", () => {
    const { input, onChange } = mount();
    typeValue(input, "");
    typeValue(input, "-");
    typeValue(input, "-2.375");
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("-2.375");

    React.act(() => input.blur());

    expect(onChange).toHaveBeenCalledExactlyOnceWith(-2.375);
    expect(input.value).toBe("-2.375");
  });

  it("accepts a locale comma and commits only once on Enter", () => {
    const { input, onChange } = mount();
    typeValue(input, "2,4");
    key(input, "Enter");
    expect(onChange).toHaveBeenCalledExactlyOnceWith(2.4);
    expect(input.value).toBe("2.4");
    expect(document.activeElement).not.toBe(input);
  });

  it("restores the original value on Escape without changing history", () => {
    const { input, onChange } = mount();
    const historyLength = useEditorStore.getState().history.length;
    typeValue(input, "99.9");
    key(input, "Escape");
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("12.25");
    expect(useEditorStore.getState().history.length).toBe(historyLength);
    expect(useEditorStore.getState().historyGestureActive).toBe(false);
  });

  it.each(["", "-", ".", "Infinity", "2..4"])("discards invalid or empty draft %s", (draft) => {
    const { input, onChange } = mount();
    typeValue(input, draft);
    React.act(() => input.blur());
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("12.25");
  });

  it("clamps committed values while keeping fractional limits for stepped adjustments", () => {
    const { input, onChange } = mount({ min: 0.25, max: 15.75 });
    typeValue(input, "30.5");
    key(input, "Enter");
    expect(onChange).toHaveBeenLastCalledWith(15.75);
    key(rendered!.container.querySelector('[role="slider"]')!, "ArrowRight");
    expect(onChange).toHaveBeenLastCalledWith(15.75);
  });

  it("leaves mixed values unchanged when its empty field loses focus", () => {
    const { input, onChange } = mount({ mixed: true });
    expect(input.value).toBe("");
    React.act(() => input.blur());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("lets a vertical swipe over the scrub label scroll without editing or adding history", () => {
    const { onChange } = mount();
    const label = rendered!.container.querySelector<HTMLElement>('[role="slider"]')!;
    const history = useEditorStore.getState().history.length;
    const pointer = (type: string, x: number, y: number) =>
      React.act(() => {
        label.dispatchEvent(
          new PointerEvent(type, {
            pointerType: "touch",
            pointerId: 7,
            isPrimary: true,
            button: 0,
            clientX: x,
            clientY: y,
            bubbles: true,
          }),
        );
      });
    pointer("pointerdown", 10, 10);
    pointer("pointermove", 13, 40);
    pointer("pointermove", 16, 90);
    pointer("pointerup", 16, 90);
    expect(onChange).not.toHaveBeenCalled();
    expect(useEditorStore.getState().history).toHaveLength(history);

    pointer("pointerdown", 10, 10);
    pointer("pointermove", 30, 12);
    pointer("pointermove", 50, 12);
    pointer("pointerup", 50, 12);
    // Measured from where the sideways drag became intentional (20px × 0.5),
    // not from touch-down, which would include the slop and jump to 32.
    expect(onChange).toHaveBeenLastCalledWith(22);
  });
});
