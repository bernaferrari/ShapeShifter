// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "@/lib/store/editorStore";
import { useTimelineViewSettings } from "../timelineViewSettings";
import { LayerTimeline } from "../../LayerTimeline";
import { useEditorKeyboardShortcuts } from "../../hooks/useEditorKeyboardShortcuts";
import {
  renderEditorComponent,
  type RenderedEditorComponent,
} from "../../__tests__/renderEditorComponent";

let baseline: ReturnType<typeof useEditorStore.getState>;
let rendered: RenderedEditorComponent | null = null;
beforeEach(() => {
  baseline = useEditorStore.getState();
  useEditorStore.getState().resetProject();
  useTimelineViewSettings.getState().setUnit("milliseconds");
});
afterEach(() => {
  rendered?.unmount();
  rendered = null;
  useEditorStore.setState(baseline, true);
  useTimelineViewSettings.getState().setUnit("milliseconds");
});
function mount(compact = false) {
  const state = useEditorStore.getState();
  const layer = state.layers[0]!;
  state.selectLayer(layer.id);
  useEditorStore.setState({
    animation: {
      ...state.animation,
      duration: 1000,
      blocks: [
        {
          id: "left",
          layerId: layer.id,
          propertyName: "rotation",
          type: "number",
          startTime: 0,
          endTime: 500,
          fromValue: 0,
          toValue: 45,
          interpolator: "LINEAR",
        },
        {
          id: "right",
          layerId: layer.id,
          propertyName: "rotation",
          type: "number",
          startTime: 500,
          endTime: 1000,
          fromValue: 45,
          toValue: 90,
          interpolator: "LINEAR",
        },
      ],
    },
    history: [],
    future: [],
  });
  function Harness() {
    useEditorKeyboardShortcuts();
    return <LayerTimeline compact={compact} />;
  }
  rendered = renderEditorComponent(<Harness />);
  return layer;
}
const marker = (time: number) =>
  rendered!.container.querySelector<HTMLButtonElement>(
    `[data-timeline-keyframe-block-id][aria-label$="at ${time} milliseconds"]`,
  )!;
async function click(element: Element) {
  await React.act(async () =>
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })),
  );
}
function key(element: Element, value: string) {
  React.act(() =>
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }),
    ),
  );
}

describe("one logical selected keyframe", () => {
  it("renders a shared boundary once and fills only the key at the playhead", async () => {
    mount();
    expect(rendered!.container.querySelectorAll("[data-timeline-keyframe-block-id]")).toHaveLength(
      3,
    );
    expect(marker(0).dataset.keyframeCurrent).toBe("true");
    await click(marker(500));
    expect(marker(500).getAttribute("aria-pressed")).toBe("true");
    expect(marker(500).dataset.keyframeCurrent).toBe("true");
    expect(marker(1000).dataset.keyframeCurrent).toBe("false");
    expect(marker(1000).getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector('[aria-label="Rotation start keyframe editor"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="popover-content"]')?.textContent).toContain(
      "2 of 3",
    );
  });
  it("deletes the selected key after focus moves, joins neighbors, and undoes once", async () => {
    mount();
    await click(marker(500));
    await click(document.querySelector('[aria-label="Close keyframe editor"]')!);
    const options = rendered!.container.querySelector<HTMLButtonElement>(
      '[aria-label="Timeline options"]',
    )!;
    React.act(() => options.focus());
    key(options, "Delete");
    expect(useEditorStore.getState().animation.blocks).toMatchObject([
      { startTime: 0, endTime: 1000, fromValue: 0, toValue: 90 },
    ]);
    expect(useEditorStore.getState().selectedKeyframe).toBeNull();
    expect(useEditorStore.getState().history).toHaveLength(1);
    React.act(() => useEditorStore.getState().undo());
    expect(useEditorStore.getState().animation.blocks).toHaveLength(2);
  });
  it("rail diamonds select an existing pose without changing animation or history", async () => {
    const layer = mount();
    const before = useEditorStore.getState().animation;
    await click(
      rendered!.container.querySelector(
        `[aria-label="Select Rotation for ${layer.name} keyframe"]`,
      )!,
    );
    expect(useEditorStore.getState().animation).toBe(before);
    expect(useEditorStore.getState().history).toHaveLength(0);
    expect(useEditorStore.getState().selectedKeyframe).toEqual({ blockId: "left", edge: "start" });
  });
  it("navigates key details and edits outgoing easing in place", async () => {
    mount();
    await click(marker(500));
    await click(document.querySelector('[aria-label="Previous Rotation keyframe"]')!);
    expect(useEditorStore.getState().progress).toBe(0);
    await click(document.querySelector('[aria-label="Keyframe easing"]')!);
    const select = document.querySelector<HTMLSelectElement>('[aria-label="Rotation easing"]')!;
    React.act(() => {
      select.value = "FAST_OUT_SLOW_IN";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(useEditorStore.getState().animation.blocks[0]!.interpolator).toBe("FAST_OUT_SLOW_IN");
    expect(useEditorStore.getState().history).toHaveLength(1);
  });
  it("keeps fractional time visible and uses one unit in details and transport", async () => {
    mount();
    React.act(() => useEditorStore.getState().setProgress(0.51725));
    expect(
      rendered!.container.querySelector<HTMLInputElement>(
        '[aria-label="Current time in milliseconds"]',
      )!.value,
    ).toBe("517.25");
    React.act(() => useTimelineViewSettings.getState().setUnit("seconds"));
    expect(
      rendered!.container.querySelector<HTMLInputElement>('[aria-label="Current time in seconds"]')!
        .value,
    ).toBe("0.51725");
    await click(marker(500));
    expect(
      document.querySelector<HTMLInputElement>('[aria-label="Rotation keyframe time"]')!.value,
    ).toBe("0.5");
  });
  it("seeks empty space and inserts a key at that position", async () => {
    mount();
    const lane = marker(500).closest<HTMLElement>("[data-timeline-lane]")!;
    lane.getBoundingClientRect = () => ({ left: 0, width: 1000 }) as DOMRect;
    React.act(() =>
      lane.dispatchEvent(new MouseEvent("click", { clientX: 250, bubbles: true, detail: 1 })),
    );
    expect(useEditorStore.getState().progress).toBe(0.25);
    await React.act(async () =>
      lane.dispatchEvent(new MouseEvent("dblclick", { clientX: 250, bubbles: true, detail: 2 })),
    );
    expect(useEditorStore.getState().animation.blocks).toHaveLength(3);
    expect(marker(250)).not.toBeNull();
    expect(useEditorStore.getState().history).toHaveLength(1);
  });
  it("keeps phone row labels free of three-button navigation clusters", () => {
    const layer = mount(true);
    expect(
      rendered!.container.querySelector(
        `[aria-label="Previous Rotation for ${layer.name} keyframe"]`,
      ),
    ).toBeNull();
    expect(
      rendered!.container.querySelector(
        `[aria-label="Select Rotation for ${layer.name} keyframe"]`,
      ),
    ).not.toBeNull();
  });
});

describe("shared insertion command", () => {
  it("creates a first pose, extends both ends, and keeps the final pose when deleting", () => {
    const state = useEditorStore.getState();
    const layer = state.layers[0]!;
    useEditorStore.setState({
      animation: { ...state.animation, duration: 1000, blocks: [] },
      history: [],
    });
    state.setProgress(0.25);
    expect(state.addKeyframeAtPlayhead(layer.id, "rotation")).toBe(true);
    expect(useEditorStore.getState().animation.blocks).toMatchObject([
      { startTime: 250, endTime: 250 },
    ]);
    state.setProgress(0.1);
    state.addKeyframeAtPlayhead(layer.id, "rotation");
    state.setProgress(0.8);
    state.addKeyframeAtPlayhead(layer.id, "rotation");
    expect(useEditorStore.getState().history).toHaveLength(3);
    expect(
      useEditorStore.getState().animation.blocks.map((block) => [block.startTime, block.endTime]),
    ).toEqual([
      [100, 250],
      [250, 800],
    ]);
    state.undo();
    state.undo();
    const only = useEditorStore.getState().animation.blocks[0]!;
    state.removeTimelineKeyframe(only.id, "start");
    expect(useEditorStore.getState().animation.blocks).toHaveLength(1);
    expect(useEditorStore.getState().history).toHaveLength(1);
  });
  it("treats a nearby fractional time as a new pose consistently", () => {
    const state = useEditorStore.getState();
    const layer = state.layers[0]!;
    useEditorStore.setState({ animation: { ...state.animation, duration: 1000, blocks: [] } });
    state.setProgress(0);
    state.addKeyframeAtPlayhead(layer.id, "rotation");
    state.setProgress(0.00025);
    state.addKeyframeAtPlayhead(layer.id, "rotation");
    expect(useEditorStore.getState().animation.blocks).toMatchObject([
      { startTime: 0, endTime: 0.25 },
    ]);
  });
});
