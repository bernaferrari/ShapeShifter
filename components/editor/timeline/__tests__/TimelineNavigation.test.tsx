// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorStore } from "@/lib/store/editorStore";
import { LayerTimeline } from "../../LayerTimeline";
import {
  chooseMenuItem,
  renderEditorComponent,
  type RenderedEditorComponent,
} from "../../__tests__/renderEditorComponent";
import { TimelineInsertKeyframeButton } from "../TimelineInsertKeyframeButton";
import { useTimelineViewSettings } from "../timelineViewSettings";
import { anchoredTimelineScroll, formatTimelineMark, timelineMajorStep } from "../timelineScale";
import { useEditorKeyboardShortcuts } from "../../hooks/useEditorKeyboardShortcuts";

let rendered: RenderedEditorComponent | null;
let baseline: ReturnType<typeof useEditorStore.getState>;
beforeEach(() => {
  baseline = useEditorStore.getState();
  useEditorStore.getState().resetProject();
  useEditorStore.setState({ timelineZoom: 1, timelineScrollX: 0 });
  useTimelineViewSettings.setState({ unit: "milliseconds", fps: 30, snapping: true });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
});
afterEach(() => {
  rendered?.unmount();
  rendered = null;
  vi.restoreAllMocks();
  useEditorStore.setState(baseline, true);
});

function button(label: string) {
  return rendered!.container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
}
function click(label: string) {
  React.act(() => button(label).click());
}
function timelineOption(itemText: string) {
  return chooseMenuItem(button("Timeline options"), itemText);
}
function stepFrame(key: "," | ".") {
  React.act(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })),
  );
}
function KeyboardTimeline() {
  useEditorKeyboardShortcuts();
  return <LayerTimeline />;
}

describe("timeline navigation", () => {
  it("snaps ruler scrubbing to fractional keys with a visible guide, and honors Alt and the snap toggle", async () => {
    const store = useEditorStore.getState();
    store.addTimelineBlock(store.layers[0].id, "rotation");
    store.updateTimelineBlock(useEditorStore.getState().selectedBlockIds[0], { endTime: 450.25 });
    rendered = renderEditorComponent(<LayerTimeline />);
    const ruler = rendered.container.querySelector<HTMLElement>(
      '[aria-label="Timeline playhead"]',
    )!;
    ruler.getBoundingClientRect = () => ({ left: 0, width: 1000 }) as DOMRect;
    const scrub = (altKey = false) => {
      React.act(() =>
        ruler.dispatchEvent(
          new PointerEvent("pointerdown", {
            clientX: 446,
            button: 0,
            pointerId: 1,
            altKey,
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
    };
    scrub();
    expect(useEditorStore.getState().progress).toBe(0.45025);
    expect(rendered.container.querySelector("[data-timeline-snap-guide]")?.textContent).toBe(
      "Keyframe · 450.25 ms",
    );
    React.act(() => window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 })));
    expect(rendered.container.querySelector("[data-timeline-snap-guide]")).toBeNull();
    scrub(true);
    expect(useEditorStore.getState().progress).toBe(0.446);
    React.act(() => window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 })));
    await timelineOption("Snap to keyframes");
    expect(useTimelineViewSettings.getState().snapping).toBe(false);
    scrub();
    expect(useEditorStore.getState().progress).toBe(0.446);
    expect(rendered.container.querySelector("[data-timeline-snap-guide]")).toBeNull();
    React.act(() => window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 })));
  });
  it("shows a selected preview range and resets to full duration without editing keyframe timing", async () => {
    const store = useEditorStore.getState();
    store.addTimelineBlock(store.layers[0].id, "rotation");
    const id = useEditorStore.getState().selectedBlockIds[0];
    store.updateTimelineBlock(id, { startTime: 100, endTime: 700 });
    const blocks = useEditorStore.getState().animation.blocks;
    rendered = renderEditorComponent(<LayerTimeline />);
    await timelineOption("Loop selection");
    const range = rendered.container.querySelector<HTMLElement>("[data-timeline-preview-range]")!;
    const label = () =>
      rendered!.container.querySelector("[data-timeline-preview-range-label]")?.textContent;
    expect(range.style.left).toBe("340px");
    expect(range.style.width).toBe("600px");
    expect(label()).toBe("Looping 100–700 ms");
    await timelineOption("Show frames");
    expect(label()).toBe("Looping 3–21 f");
    click("Preview full animation");
    expect(rendered.container.querySelector("[data-timeline-preview-range]")).toBeNull();
    expect(useEditorStore.getState().animation.blocks).toBe(blocks);
  });
  it("copies and pastes motion from timeline shortcuts while text fields retain native clipboard editing", () => {
    const store = useEditorStore.getState();
    useEditorStore.setState({ animation: { ...store.animation, blocks: [] }, clipboard: null });
    store.addTimelineBlock(store.layers[0].id, "rotation");
    function Harness() {
      useEditorKeyboardShortcuts();
      return <LayerTimeline />;
    }
    rendered = renderEditorComponent(<Harness />);
    const ruler = rendered.container.querySelector<HTMLElement>(
      '[aria-label="Timeline playhead"]',
    )!;
    const copy = new KeyboardEvent("keydown", {
      key: "c",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    React.act(() => ruler.dispatchEvent(copy));
    expect(copy.defaultPrevented).toBe(true);
    expect(useEditorStore.getState().timelineClipboard?.blocks).toHaveLength(1);
    expect(useEditorStore.getState().clipboard).toBeNull();
    React.act(() => {
      store.addLayer("path");
      store.setProgress(0.25);
    });
    const target = useEditorStore.getState().selectedLayerId;
    const paste = new KeyboardEvent("keydown", {
      key: "v",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    React.act(() => ruler.dispatchEvent(paste));
    expect(paste.defaultPrevented).toBe(true);
    expect(
      useEditorStore.getState().animation.blocks.filter((block) => block.layerId === target),
    ).toHaveLength(1);
    const input = rendered.container.querySelector<HTMLInputElement>(
      '[aria-label="Current time in milliseconds"]',
    )!;
    const nativePaste = new KeyboardEvent("keydown", {
      key: "v",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    React.act(() => input.dispatchEvent(nativePaste));
    expect(nativePaste.defaultPrevented).toBe(false);
    expect(
      useEditorStore.getState().animation.blocks.filter((block) => block.layerId === target),
    ).toHaveLength(1);
  });
  it("keeps ruler, track width, and playhead aligned through zoom, scrolling, and fit", async () => {
    useEditorStore.setState({ progress: 0.6 });
    rendered = renderEditorComponent(<LayerTimeline />);
    const ruler = rendered.container.querySelector<HTMLElement>(
      '[aria-label="Timeline playhead"]',
    )!;
    const content = rendered.container.querySelector<HTMLElement>("[data-timeline-content]")!;
    const tracks = content.parentElement!;
    const head = () => rendered!.container.querySelector<HTMLElement>("[data-timeline-playhead]")!;
    expect(head().style.left).toBe("840px");
    await timelineOption("Zoom in");
    expect(useEditorStore.getState().timelineZoom).toBeCloseTo(Math.sqrt(2));
    expect(parseFloat(ruler.style.width)).toBeCloseTo(1000 * Math.sqrt(2));
    expect(content.style.width).toBe(ruler.style.width);
    expect(parseFloat(head().style.left)).toBeCloseTo(840);
    React.act(() => {
      tracks.scrollLeft = 300;
      tracks.dispatchEvent(new Event("scroll"));
    });
    expect(ruler.style.left).toBe("-300px");
    expect(parseFloat(head().style.left)).toBeCloseTo(240 + 600 * Math.sqrt(2) - 300);
    await timelineOption("Zoom to fit");
    expect(content.style.width).toBe("1000px");
    expect(tracks.scrollLeft).toBe(0);
    expect(head().style.left).toBe("840px");
  });

  it("displays and steps exact frames without rounding fractional milliseconds", async () => {
    useEditorStore.setState({ progress: 0.5 });
    rendered = renderEditorComponent(<KeyboardTimeline />);
    await timelineOption("Show frames");
    const frame = rendered.container.querySelector<HTMLInputElement>(
      '[aria-label="Current frame"]',
    )!;
    expect(frame.value).toBe("15");
    stepFrame(".");
    expect(useEditorStore.getState().progress * 1000).toBeCloseTo(500 + 1000 / 30, 10);
    expect(frame.value).toBe("16");
    React.act(() => useTimelineViewSettings.getState().setFps(24));
    const previous = useEditorStore.getState().progress;
    stepFrame(".");
    expect(useEditorStore.getState().progress * 1000).toBeCloseTo(previous * 1000 + 1000 / 24, 10);
  });

  it("moves an object clip by an exact frame from its keyboard control", async () => {
    const store = useEditorStore.getState();
    useEditorStore.setState({ animation: { ...store.animation, blocks: [] } });
    store.addTimelineBlock(store.layers[0].id, "rotation");
    const id = useEditorStore.getState().selectedBlockIds[0];
    store.updateTimelineBlock(id, { startTime: 100, endTime: 700 });
    rendered = renderEditorComponent(<LayerTimeline />);
    await timelineOption("Show frames");
    const clip = rendered.container.querySelector<HTMLElement>("[data-timeline-block-id]")!;
    React.act(() =>
      clip.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
      ),
    );
    const updated = useEditorStore.getState().animation.blocks.find((block) => block.id === id)!;
    expect(updated.startTime).toBeCloseTo(100 + 1000 / 30, 10);
    expect(updated.endTime - updated.startTime).toBeCloseTo(600);
  });

  it("inserts a keyframe at the current time on the selected property track", () => {
    const store = useEditorStore.getState();
    const layer = store.layers[0];
    store.addTimelineBlock(layer.id, "rotation");
    const id = useEditorStore.getState().selectedBlockIds[0];
    store.updateTimelineBlock(id, { fromValue: 0, toValue: 100, interpolator: "LINEAR" });
    store.insertTimelineKeyframe(id, 350);
    store.addTimelineBlock(layer.id, "scaleX");
    const unrelated = useEditorStore.getState().selectedBlockIds[0];
    store.updateTimelineBlock(unrelated, { endTime: 800 });
    store.selectBlocks([id]);
    useEditorStore.setState({ progress: 0.5, isPlaying: true });
    rendered = renderEditorComponent(
      <>
        <LayerTimeline />
        <TimelineInsertKeyframeButton />
      </>,
    );
    React.act(() => store.setProgress(0.2));
    click("Insert keyframe at playhead");
    const blocks = useEditorStore
      .getState()
      .animation.blocks.filter((block) => block.propertyName === "rotation");
    expect(blocks).toHaveLength(3);
    expect(blocks.some((block) => block.endTime === 200 && block.toValue === 20)).toBe(true);
  });

  it("inserts across selected tracks in one undo step, including another segment of the selected property", () => {
    const store = useEditorStore.getState();
    useEditorStore.setState({ animation: { ...store.animation, blocks: [] } });
    const layer = store.layers[0];
    store.addTimelineBlock(layer.id, "rotation");
    const rotation = useEditorStore.getState().selectedBlockIds[0];
    store.updateTimelineBlock(rotation, { fromValue: 0, toValue: 100, interpolator: "LINEAR" });
    store.insertTimelineKeyframe(rotation, 350);
    store.addTimelineBlock(layer.id, "scaleX");
    const scale = useEditorStore.getState().selectedBlockIds[0];
    store.selectBlocks([rotation, scale]);
    useEditorStore.setState({ progress: 0.5 });
    const historyLength = useEditorStore.getState().history.length;
    rendered = renderEditorComponent(<TimelineInsertKeyframeButton />);
    click("Insert keyframe at playhead");
    expect(useEditorStore.getState().animation.blocks).toHaveLength(5);
    expect(useEditorStore.getState().selectedBlockIds).toHaveLength(2);
    expect(useEditorStore.getState().history).toHaveLength(historyLength + 1);
    React.act(() => store.undo());
    expect(useEditorStore.getState().animation.blocks).toHaveLength(3);
    expect(useEditorStore.getState().selectedBlockIds).toEqual([rotation, scale]);
  });
});

describe("timeline scale", () => {
  it("chooses readable zoom-aware steps in time and whole frames", () => {
    expect(timelineMajorStep(1000, 1000, "milliseconds", 30)).toBe(100);
    expect(timelineMajorStep(1000, 5000, "milliseconds", 30)).toBe(20);
    expect(timelineMajorStep(1000, 10000, "frames", 30)).toBe(1000 / 30);
    expect(formatTimelineMark(500, "frames", 30, 100)).toBe("15");
    expect(formatTimelineMark(500, "milliseconds", 30, 100)).toBe("0.5 s");
  });
  it("clamps a zoom anchor at both physical edges", () => {
    expect(anchoredTimelineScroll(0, 1000, 3)).toBe(0);
    expect(anchoredTimelineScroll(0.5, 1000, 3)).toBe(1000);
    expect(anchoredTimelineScroll(1, 1000, 3)).toBe(2000);
  });
});
