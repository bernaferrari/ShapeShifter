// @vitest-environment happy-dom

import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "@/lib/store/editorStore";
import { useEditorKeyboardShortcuts } from "../../hooks/useEditorKeyboardShortcuts";
import { TimelinePropertyBlock } from "../TimelinePropertyBlock";
import {
  TimelineCurrentTimeInput,
  TimelineDurationInput,
  TimelinePropertyValue,
} from "../TimelineLiveState";
import {
  renderEditorComponent,
  type RenderedEditorComponent,
} from "../../__tests__/renderEditorComponent";
import { shiftTimelineItems } from "../timelineTiming";
import { LayerTimeline } from "../../LayerTimeline";

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

function key(input: Element, key: string, shiftKey = false) {
  React.act(() =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }),
    ),
  );
}

function typeValue(input: HTMLInputElement, value: string) {
  React.act(() => input.focus());
  React.act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function mountBlock() {
  const store = useEditorStore.getState();
  store.selectLayer(store.layers[0]!.id);
  store.addTimelineBlock(store.layers[0]!.id, "rotation");
  const id = useEditorStore.getState().selectedBlockIds[0]!;
  store.updateTimelineBlock(id, { startTime: 100, endTime: 500 });
  function Harness() {
    useEditorKeyboardShortcuts();
    const block = useEditorStore((state) => state.animation.blocks.find((item) => item.id === id)!);
    const selected = useEditorStore((state) => state.selectedBlockIds.includes(id));
    return (
      <div data-timeline-row>
        <TimelinePropertyBlock block={block} duration={1000} selected={selected} />
      </div>
    );
  }
  rendered = renderEditorComponent(<Harness />);
  return id;
}

function pointer(element: Element, type: string, clientX = 0, altKey = false) {
  React.act(() =>
    element.dispatchEvent(
      new PointerEvent(type, {
        clientX,
        altKey,
        button: 0,
        pointerId: 1,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
}

describe("timeline editing", () => {
  it("keeps a property rail selected after pointerdown and click", () => {
    const id = mountBlock();
    const rail = rendered!.container.querySelector("[data-timeline-block-id]")!;
    pointer(rail, "pointerdown");
    pointer(rail, "pointerup");
    React.act(() => rail.dispatchEvent(new MouseEvent("click", { detail: 1, bubbles: true })));
    expect(useEditorStore.getState().selectedBlockIds).toEqual([id]);
    expect(rail.getAttribute("aria-pressed")).toBe("true");
  });

  it("nudges focused keyframe timing without moving canvas geometry", () => {
    const id = mountBlock();
    const before = useEditorStore.getState().layers[0]!.translateX ?? 0;
    const keyframe = rendered!.container.querySelector('[data-timeline-keyframe-edge="start"]')!;
    key(keyframe, "ArrowRight");
    expect(
      useEditorStore.getState().animation.blocks.find((block) => block.id === id)!.startTime,
    ).toBe(101);
    expect(useEditorStore.getState().layers[0]!.translateX ?? 0).toBe(before);
    key(keyframe, "ArrowUp");
    expect(useEditorStore.getState().layers[0]!.translateY ?? 0).toBe(0);
  });

  it("supports Alt dragging at millisecond precision and one-step undo", () => {
    const id = mountBlock();
    const rail = rendered!.container.querySelector("[data-timeline-block-id]")!;
    const track = rendered!.container.querySelector<HTMLElement>("[data-timeline-row]")!;
    track.getBoundingClientRect = () => ({ width: 1000 }) as DOMRect;
    pointer(rail, "pointerdown", 0);
    pointer(rail, "pointermove", 13, true);
    pointer(rail, "pointermove", 17, true);
    pointer(rail, "pointerup", 17, true);
    const edited = useEditorStore.getState().animation.blocks.find((block) => block.id === id)!;
    expect([edited.startTime, edited.endTime]).toEqual([117, 517]);
    React.act(() => useEditorStore.getState().undo());
    const restored = useEditorStore.getState().animation.blocks.find((block) => block.id === id)!;
    expect([restored.startTime, restored.endTime]).toEqual([100, 500]);
  });

  it("displays the actual eased numeric value at the playhead", () => {
    const store = useEditorStore.getState();
    const block = {
      id: "test",
      layerId: store.layers[0]!.id,
      propertyName: "rotation",
      type: "number" as const,
      startTime: 0,
      endTime: 1000,
      fromValue: 0,
      toValue: 180,
      interpolator: "LINEAR",
    };
    useEditorStore.setState({
      progress: 0.25,
      animation: { ...store.animation, duration: 1000, blocks: [block] },
    });
    rendered = renderEditorComponent(
      <TimelinePropertyValue block={block} propertyName="rotation" selected />,
    );
    expect(rendered.container.textContent).toBe("45°");
  });

  it("scrubs the ruler from the keyboard and keeps its accessible time current", () => {
    useEditorStore.setState({ progress: 0.25 });
    function Harness() {
      useEditorKeyboardShortcuts();
      return <LayerTimeline />;
    }
    rendered = renderEditorComponent(<Harness />);
    const ruler = rendered.container.querySelector(
      '[role="slider"][aria-label="Timeline playhead"]',
    )!;
    key(ruler, "ArrowRight");
    const time = useEditorStore.getState().progress * useEditorStore.getState().animation.duration;
    expect(time).toBe(251);
    expect(ruler.getAttribute("aria-valuenow")).toBe("251");
    key(ruler, "End");
    expect(useEditorStore.getState().progress).toBe(1);
    key(ruler, "Home");
    expect(useEditorStore.getState().progress).toBe(0);
  });

  it("edits duration from its grip without also scrubbing the parent ruler", () => {
    useEditorStore.setState({ progress: 0.25 });
    rendered = renderEditorComponent(<LayerTimeline />);
    const grip = rendered.container.querySelector(
      '[role="slider"][aria-label="Animation duration"]',
    )!;
    key(grip, "ArrowRight", true);
    expect(useEditorStore.getState().animation.duration).toBe(1010);
    expect(useEditorStore.getState().progress).toBe(0.25);
  });
});

describe("timeline transport drafts", () => {
  it("pauses playback on time entry and Escape discards a typed time", () => {
    useEditorStore.setState({ progress: 0.25, isPlaying: true });
    rendered = renderEditorComponent(<TimelineCurrentTimeInput color="var(--primary)" />);
    const input = rendered.container.querySelector("input")!;
    typeValue(input, "700");
    expect(useEditorStore.getState().isPlaying).toBe(false);
    key(input, "Escape");
    expect(useEditorStore.getState().progress).toBe(0.25);
  });

  it("Escape discards duration changes and Enter commits one undoable change", () => {
    const original = useEditorStore.getState().animation.duration;
    rendered = renderEditorComponent(<TimelineDurationInput />);
    const input = rendered.container.querySelector("input")!;
    typeValue(input, "2750");
    key(input, "Escape");
    expect(useEditorStore.getState().animation.duration).toBe(original);
    typeValue(input, "2750");
    key(input, "Enter");
    expect(useEditorStore.getState().animation.duration).toBe(2750);
    React.act(() => useEditorStore.getState().undo());
    expect(useEditorStore.getState().animation.duration).toBe(original);
  });
});

describe("group timing precision", () => {
  const items = [
    { originalStart: 17, originalEnd: 317 },
    { originalStart: 143, originalEnd: 643 },
  ];
  it("snaps one shared offset instead of rounding each keyframe", () => {
    const shift = shiftTimelineItems(items, 76, 1000);
    expect(shift).toBe(100);
    expect(items[1]!.originalStart + shift - (items[0]!.originalStart + shift)).toBe(126);
  });
  it("clamps the whole group together at both timeline edges", () => {
    expect(shiftTimelineItems(items, -100, 1000)).toBe(-17);
    expect(shiftTimelineItems(items, 500, 1000)).toBe(357);
  });
});
