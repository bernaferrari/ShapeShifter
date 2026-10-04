// @vitest-environment happy-dom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as interpolation from "@/lib/shapeshifter/interpolators";
import type { TimelineBlock } from "@/lib/shapeshifter/types";
import { useEditorStore } from "@/lib/store/editorStore";
import { useEditorKeyboardShortcuts } from "../../hooks/useEditorKeyboardShortcuts";
import { MotionBlockEditor } from "../MotionBlockEditor";
import { MotionValueGraph } from "../MotionValueGraph";
import {
  buttonWithText,
  click,
  renderEditorComponent,
  type RenderedEditorComponent,
} from "../../__tests__/renderEditorComponent";

const block: TimelineBlock = {
  id: "rotation-segment",
  layerId: "shape",
  propertyName: "rotation",
  type: "number",
  startTime: 125,
  endTime: 2125,
  fromValue: 10,
  toValue: 90,
  interpolator: "LINEAR",
};
let rendered: RenderedEditorComponent | null = null;
let baseline: ReturnType<typeof useEditorStore.getState>;
beforeEach(() => {
  baseline = useEditorStore.getState();
  useEditorStore.getState().resetProject();
});
afterEach(() => {
  rendered?.unmount();
  rendered = null;
  vi.restoreAllMocks();
  useEditorStore.setState(baseline, true);
});

function disclosure() {
  return rendered!.container.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
}

function graph() {
  const svg = rendered!.container.querySelector<SVGSVGElement>('svg[role="img"]');
  expect(svg).not.toBeNull();
  return svg!;
}

describe("numeric motion graphs", () => {
  it("starts collapsed without computing samples, then reveals labeled axes and a value graph", () => {
    const evaluate = vi.spyOn(interpolation, "evaluateInterpolator");
    rendered = renderEditorComponent(<MotionValueGraph block={block} />);
    expect(disclosure().getAttribute("aria-expanded")).toBe("false");
    expect(disclosure().getAttribute("aria-label")).toBe("Rotation value and velocity graphs");
    expect(rendered.container.querySelector('svg[role="img"]')).toBeNull();
    expect(evaluate).not.toHaveBeenCalled();

    click(disclosure());
    const svg = graph();
    expect(disclosure().getAttribute("aria-expanded")).toBe("true");
    expect(svg.closest("div")?.id).toBe(disclosure().getAttribute("aria-controls"));
    expect(svg.querySelector("title")?.textContent).toBe("Rotation value graph (°)");
    expect(svg.getAttribute("aria-labelledby")).toBe(svg.querySelector("title")?.id);
    expect(svg.getAttribute("aria-describedby")).toBe(svg.querySelector("desc")?.id);
    expect(svg.querySelector("desc")?.textContent).toContain("between 125 and 2125 milliseconds");
    expect(svg.querySelector("desc")?.textContent).not.toContain("viewport units");
    expect(svg.textContent).toContain("Value (°)");
    expect(svg.textContent).toContain("Time (ms)");
    expect(svg.textContent).toContain("1125");
    expect(rendered.container.querySelector("figcaption")?.textContent).toContain("10 → 90 °");
    expect(evaluate).toHaveBeenCalled();
  });

  it("switches accessible Value/Velocity buttons without resampling the authored signal", () => {
    const evaluate = vi.spyOn(interpolation, "evaluateInterpolator");
    rendered = renderEditorComponent(<MotionValueGraph block={block} />);
    click(disclosure());
    const calls = evaluate.mock.calls.length;
    const value = buttonWithText(rendered.container, "Value");
    const velocity = buttonWithText(rendered.container, "Velocity");
    expect(value.getAttribute("aria-pressed")).toBe("true");
    expect(velocity.getAttribute("aria-pressed")).toBe("false");

    click(velocity);
    expect(velocity.getAttribute("aria-pressed")).toBe("true");
    expect(value.getAttribute("aria-pressed")).toBe("false");
    expect(graph().querySelector("title")?.textContent).toBe("Rotation velocity graph (°/s)");
    expect(graph().querySelector("desc")?.textContent).toContain("change per second");
    expect(graph().querySelector("desc")?.textContent).toContain(
      "Sampled velocities range from 40 to 40 °/s.",
    );
    const path = graph().querySelector('path[data-motion-value-curve="velocity"]')!;
    expect(path.getAttribute("d")).not.toContain("NaN");
    expect(evaluate.mock.calls.length).toBe(calls);

    click(disclosure());
    expect(rendered.container.querySelector('svg[role="img"]')).toBeNull();
  });

  it("keeps focused graph controls out of playback and canvas arrow shortcuts", () => {
    function KeyboardParent() {
      useEditorKeyboardShortcuts();
      return <MotionValueGraph block={block} />;
    }
    const state = useEditorStore.getState();
    state.selectLayer(state.layers[0]!.id);
    const before = state.layers[0]!.translateX ?? 0;
    rendered = renderEditorComponent(<KeyboardParent />);
    click(disclosure());
    const velocity = buttonWithText(rendered.container, "Velocity");
    velocity.focus();
    for (const [type, key] of [
      ["keydown", " "],
      ["keyup", " "],
      ["keydown", "ArrowRight"],
      ["keydown", "Enter"],
    ]) {
      React.act(() =>
        velocity.dispatchEvent(
          new KeyboardEvent(type!, {
            key,
            code: key === " " ? "Space" : key,
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
    }
    expect(useEditorStore.getState().isPlaying).toBe(false);
    expect(useEditorStore.getState().layers[0]!.translateX ?? 0).toBe(before);
    expect(velocity.type).toBe("button");
  });

  it("does not recompute or render a new path when playback updates the parent", () => {
    const evaluate = vi.spyOn(interpolation, "evaluateInterpolator");
    function PlaybackParent() {
      const progress = useEditorStore((state) => state.progress);
      return (
        <div data-progress={progress}>
          <MotionValueGraph block={block} />
        </div>
      );
    }
    rendered = renderEditorComponent(<PlaybackParent />);
    click(disclosure());
    const calls = evaluate.mock.calls.length;
    const path = graph().querySelector("path")!;
    const d = path.getAttribute("d");
    for (const progress of [0.1, 0.4, 0.9]) React.act(() => useEditorStore.setState({ progress }));
    expect(rendered.container.firstElementChild?.getAttribute("data-progress")).toBe("0.9");
    expect(evaluate.mock.calls.length).toBe(calls);
    expect(graph().querySelector("path")).toBe(path);
    expect(path.getAttribute("d")).toBe(d);
  });

  it("updates the graph when authored endpoint or timing data changes", () => {
    const evaluate = vi.spyOn(interpolation, "evaluateInterpolator");
    let edit!: (value: TimelineBlock) => void;
    function AuthoringParent() {
      const [segment, setSegment] = React.useState(block);
      edit = setSegment;
      return <MotionValueGraph block={segment} />;
    }
    rendered = renderEditorComponent(<AuthoringParent />);
    click(disclosure());
    click(buttonWithText(rendered.container, "Velocity"));
    const oldPath = graph().querySelector("path")!.getAttribute("d");
    const calls = evaluate.mock.calls.length;
    React.act(() => edit({ ...block, toValue: 130, endTime: 1125 }));
    expect(evaluate.mock.calls.length).toBeGreaterThan(calls);
    expect(graph().querySelector("path")!.getAttribute("d")).not.toBe(oldPath);
    expect(graph().querySelector("desc")?.textContent).toContain("to 130 °");
    expect(graph().querySelector("desc")?.textContent).toContain("and 1125 milliseconds");
  });

  it.each([
    ["alpha", "Opacity", "Property values before opacity limits."],
    ["trimPathEnd", "Trim end", "Property values before trim wrapping."],
  ])(
    "explains unbounded %s signal values without claiming clamped paint",
    (propertyName, label, note) => {
      rendered = renderEditorComponent(
        <MotionValueGraph
          block={{
            ...block,
            propertyName,
            fromValue: 0,
            toValue: 1,
            interpolator: "cubic-bezier(0.3, 1.4, 0.5, 1.2)",
          }}
        />,
      );
      click(disclosure());
      expect(graph().querySelector("title")?.textContent).toBe(`${label} value graph (%)`);
      expect(rendered.container.querySelector("p")?.textContent).toBe(note);
      click(buttonWithText(rendered.container, "Velocity"));
      expect(graph().querySelector("title")?.textContent).toBe(`${label} velocity graph (%/s)`);
    },
  );

  it.each([
    { propertyName: "pathData", type: "path" as const, fromValue: "M 0 0", toValue: "M 1 1" },
    { propertyName: "fillColor", type: "color" as const, fromValue: "#fff", toValue: "#000" },
  ])("does not offer numeric graphs for $propertyName segments", (patch) => {
    rendered = renderEditorComponent(
      <MotionBlockEditor block={{ ...block, ...patch }} duration={2500} onEditMorph={() => {}} />,
    );
    expect(
      rendered.container.querySelector('[aria-label$="value and velocity graphs"]'),
    ).toBeNull();
  });

  it("handles extreme imported coordinates with a status message instead of an invalid SVG", () => {
    rendered = renderEditorComponent(
      <MotionValueGraph block={{ ...block, fromValue: 1.75e308, toValue: 1.75e308 }} />,
    );
    click(disclosure());
    expect(rendered.container.querySelector('svg[role="img"]')).toBeNull();
    expect(rendered.container.querySelector('[role="status"]')?.textContent).toBe(
      "Graph values exceed the display range.",
    );
  });

  it("integrates numeric graphs beside the existing easing controls", () => {
    rendered = renderEditorComponent(
      <MotionBlockEditor block={block} duration={2500} onEditMorph={() => {}} />,
    );
    expect(
      rendered.container.querySelector('[aria-label="Rotation value and velocity graphs"]'),
    ).toBeInstanceOf(HTMLButtonElement);
    expect(buttonWithText(rendered.container, "Custom easing curve")).toBeInstanceOf(
      HTMLButtonElement,
    );
    expect(rendered.container.querySelector('[aria-label="Rotation to value"]')).toBeInstanceOf(
      HTMLInputElement,
    );
  });
});
