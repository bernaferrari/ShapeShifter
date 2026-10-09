// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "@/lib/store/editorStore";
import { HOLD_INTERPOLATOR } from "@/lib/pathshift/interpolators";
import { TimelineGraphEditor } from "../TimelineGraphEditor";
import {
  renderEditorComponent,
  type RenderedEditorComponent,
} from "../../__tests__/renderEditorComponent";

let baseline: ReturnType<typeof useEditorStore.getState>;
let rendered: RenderedEditorComponent | null = null;
let layerId: string | number;
beforeEach(() => {
  baseline = useEditorStore.getState();
  const store = useEditorStore.getState();
  store.resetProject();
  layerId = useEditorStore.getState().selectedLayerId;
  useEditorStore.setState({
    animation: {
      ...useEditorStore.getState().animation,
      blocks: [
        {
          id: "spin",
          layerId,
          propertyName: "rotation",
          fromValue: 0,
          toValue: 90,
          startTime: 0,
          endTime: 1000,
          interpolator: "LINEAR",
          type: "number",
        },
        {
          id: "blink",
          layerId,
          propertyName: "alpha",
          fromValue: 1,
          toValue: 0,
          startTime: 0,
          endTime: 500,
          interpolator: HOLD_INTERPOLATOR,
          type: "number",
        },
      ],
    },
  });
});
afterEach(() => {
  rendered?.unmount();
  rendered = null;
  useEditorStore.setState(baseline, true);
});

function drag(element: Element, dx: number, dy: number) {
  const init = { bubbles: true, cancelable: true, pointerId: 1, button: 0, isPrimary: true };
  React.act(() => {
    element.dispatchEvent(new PointerEvent("pointerdown", { ...init, clientX: 100, clientY: 100 }));
  });
  React.act(() => {
    element.dispatchEvent(
      new PointerEvent("pointermove", { ...init, clientX: 100 + dx, clientY: 100 + dy }),
    );
  });
  React.act(() => {
    element.dispatchEvent(
      new PointerEvent("pointerup", { ...init, clientX: 100 + dx, clientY: 100 + dy }),
    );
  });
}
const block = (id: string) =>
  useEditorStore.getState().animation.blocks.find((item) => item.id === id)!;

describe("graph editor", () => {
  it("draws every numeric track with its keyframes, and holds without easing handles", () => {
    rendered = renderEditorComponent(<TimelineGraphEditor contentWidth={500} gutter={8} stickyLeft={0} />);
    const keys = [...rendered.container.querySelectorAll("[data-graph-keyframe]")].map((node) =>
      node.getAttribute("data-graph-keyframe"),
    );
    expect(keys).toEqual(expect.arrayContaining(["rotation:0", "rotation:1000", "alpha:0", "alpha:500"]));
    const handles = [...rendered.container.querySelectorAll("[data-graph-handle]")].map((node) =>
      node.getAttribute("data-graph-handle"),
    );
    expect(handles).toEqual(["spin:0", "spin:1"]);
    expect(rendered.container.textContent).toContain("Rotation");
  });

  it("drags a keyframe to change its value as one undo step", () => {
    rendered = renderEditorComponent(<TimelineGraphEditor contentWidth={500} gutter={8} stickyLeft={0} />);
    const historyBefore = useEditorStore.getState().history.length;
    drag(rendered.container.querySelector('[data-graph-keyframe="rotation:1000"]')!, 0, 40);
    expect(Number(block("spin").toValue)).toBeLessThan(90);
    expect(useEditorStore.getState().history.length).toBe(historyBefore + 1);
  });

  it("drags an easing handle into a custom curve", () => {
    rendered = renderEditorComponent(<TimelineGraphEditor contentWidth={500} gutter={8} stickyLeft={0} />);
    drag(rendered.container.querySelector('[data-graph-handle="spin:0"]')!, 100, 0);
    expect(block("spin").interpolator).toMatch(/^cubic-bezier\(0\.2, 0, 1, 1\)$/);
  });
});
