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
import { TOUCH_HOLD_MS } from "@/lib/touchIntent";

let rendered: RenderedEditorComponent | null;
let baseline: ReturnType<typeof useEditorStore.getState>;
beforeEach(() => {
  baseline = useEditorStore.getState();
  useEditorStore.getState().resetProject();
  useEditorStore.setState({ timelineZoom: 1, timelineScrollX: 0, timelineScrollY: 0 });
  useTimelineViewSettings.setState({ unit: "milliseconds", fps: 30, snapping: true });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1260);
});
afterEach(() => {
  vi.useRealTimers();
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
function stepFrame(key: "<" | ">") {
  React.act(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })),
  );
}
function KeyboardTimeline() {
  useEditorKeyboardShortcuts();
  return <LayerTimeline />;
}

function touch(element: Element, type: string, id: number, x: number, y = 300) {
  React.act(() => {
    element.dispatchEvent(
      new PointerEvent(type, {
        pointerType: "touch",
        pointerId: id,
        isPrimary: id === 1,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
        altKey: true,
      }),
    );
  });
}
function mountTouchTimeline() {
  rendered = renderEditorComponent(<LayerTimeline />);
  rendered.container.querySelector("section")!.getBoundingClientRect = () =>
    new DOMRect(0, 0, 1260, 600);
  for (const row of rendered.container.querySelectorAll<HTMLElement>("[data-timeline-row]"))
    row.getBoundingClientRect = () => new DOMRect(250, 200, 1000, 30);
  const ruler = rendered.container.querySelector<HTMLElement>('[aria-label="Timeline playhead"]')!;
  ruler.getBoundingClientRect = () => new DOMRect(250, 0, 1000, 36);
  return {
    viewport: rendered.container.querySelector<HTMLElement>('[aria-label="Animation tracks"]')!,
    ruler,
  };
}
function addMotion() {
  const store = useEditorStore.getState();
  store.addTimelineBlock(store.layers[0].id, "rotation");
  const id = useEditorStore.getState().selectedBlockIds[0];
  store.updateTimelineBlock(id, { startTime: 100, endTime: 700 });
  return id;
}

describe("timeline navigation", () => {
  it("scrolls instead of retiming when a quick swipe starts on a segment", () => {
    vi.useFakeTimers();
    const id = addMotion();
    useEditorStore.getState().selectBlocks([]);
    const original = useEditorStore.getState().animation;
    const { viewport } = mountTouchTimeline();
    const segment = rendered!.container.querySelector(`[data-timeline-block-id="${id}"]`)!;
    React.act(() => useEditorStore.setState({ timelineZoom: 2 }));
    touch(segment, "pointerdown", 1, 600);
    touch(segment, "pointermove", 1, 540);
    React.act(() => vi.advanceTimersByTime(TOUCH_HOLD_MS * 2));
    touch(segment, "pointermove", 1, 500);
    touch(viewport, "pointerup", 1, 500);
    expect(useEditorStore.getState().animation).toBe(original);
    expect(useEditorStore.getState().selectedBlockIds).not.toContain(id);
    expect(useEditorStore.getState().timelineScrollX).toBeGreaterThan(0);
  });

  it("pinches around the touched time and continues scrolling with the remaining finger", () => {
    const { viewport } = mountTouchTimeline();
    // Time zero sits past the 240px names column and the 10px lane gutter.
    const pointer = (type: string, id: number, x: number) => touch(viewport, type, id, x + 10);
    pointer("pointerdown", 1, 600);
    pointer("pointerdown", 2, 800);
    pointer("pointermove", 1, 500);
    pointer("pointermove", 2, 900);
    expect(useEditorStore.getState().timelineZoom).toBeCloseTo(2);
    expect(useEditorStore.getState().timelineScrollX).toBeCloseTo(460);
    pointer("pointerup", 1, 500);
    pointer("pointermove", 2, 850);
    expect(useEditorStore.getState().timelineZoom).toBeCloseTo(2);
    expect(useEditorStore.getState().timelineScrollX).toBeCloseTo(510);
    pointer("pointerdown", 3, 650);
    pointer("pointermove", 3, 550);
    expect(useEditorStore.getState().timelineZoom).toBeCloseTo(3);
    expect(useEditorStore.getState().timelineScrollX).toBeCloseTo(1070);
    pointer("pointerup", 2, 850);
    pointer("pointerup", 3, 550);
  });

  it.each(["keyframe", "segment", "duration", "scrub"])(
    "cancels an active %s edit before pinching without leaving an undo step",
    (kind) => {
      vi.useFakeTimers();
      const id = addMotion();
      useEditorStore.setState({ progress: 0.25 });
      const original = useEditorStore.getState();
      const { viewport, ruler } = mountTouchTimeline();
      const target =
        kind === "scrub"
          ? ruler
          : kind === "duration"
            ? rendered!.container.querySelector('[aria-label="Animation duration"]')!
            : kind === "keyframe"
              ? rendered!.container.querySelector(
                  `[data-timeline-keyframe-block-id="${id}"][data-timeline-keyframe-edge="start"]`,
                )!
              : rendered!.container.querySelector(`[data-timeline-block-id="${id}"]`)!;
      touch(target, "pointerdown", 1, 500);
      // Keyframes and segments only pick up after a still hold on touch.
      React.act(() => vi.advanceTimersByTime(TOUCH_HOLD_MS));
      touch(target, "pointermove", 1, 560);
      if (kind === "scrub") expect(useEditorStore.getState().progress).not.toBe(original.progress);
      else expect(useEditorStore.getState().animation).not.toEqual(original.animation);
      touch(viewport, "pointerdown", 2, 760);
      expect(useEditorStore.getState().animation).toEqual(original.animation);
      expect(useEditorStore.getState().history).toEqual(original.history);
      expect(useEditorStore.getState().progress).toBe(original.progress);
      touch(viewport, "pointermove", 2, 960);
      expect(useEditorStore.getState().timelineZoom).toBeCloseTo(2);
      touch(viewport, "pointerup", 2, 960);
      touch(viewport, "pointermove", 1, 510);
      touch(viewport, "pointerup", 1, 510);
      expect(useEditorStore.getState().animation).toEqual(original.animation);
      expect(useEditorStore.getState().history).toEqual(original.history);
      expect(useEditorStore.getState().progress).toBe(original.progress);
      const click = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 });
      React.act(() => ruler.dispatchEvent(click));
      expect(click.defaultPrevented).toBe(true);
      expect(useEditorStore.getState().progress).toBe(original.progress);
      // A fresh tap is still a normal edit, rather than being swallowed after navigation.
      touch(ruler, "pointerdown", 3, 650);
      touch(ruler, "pointerup", 3, 650);
      expect(useEditorStore.getState().progress).toBeCloseTo(0.4);
    },
  );

  it("scrolls blank tracks and layer names with one finger without changing row heights", () => {
    useEditorStore.setState({ timelineZoom: 2, timelineScrollX: 100, timelineScrollY: 0 });
    const { viewport } = mountTouchTimeline();
    touch(viewport, "pointerdown", 1, 600, 300);
    touch(viewport, "pointermove", 1, 550, 260);
    touch(viewport, "pointerup", 1, 550, 260);
    expect(useEditorStore.getState().timelineZoom).toBe(2);
    expect(useEditorStore.getState().timelineScrollX).toBe(150);
    expect(useEditorStore.getState().timelineScrollY).toBe(40);
    const names = rendered!.container.querySelector("[data-timeline-layer-names]")!;
    touch(names, "pointerdown", 2, 100, 300);
    touch(names, "pointermove", 2, 100, 250);
    touch(names, "pointerup", 2, 100, 250);
    expect(useEditorStore.getState().timelineScrollY).toBe(90);
    expect(useEditorStore.getState().timelineScrollX).toBe(150);
    expect(useEditorStore.getState().timelineZoom).toBe(2);
  });

  it("leaves sheet/header gestures and buttons usable after pinching", () => {
    const { viewport } = mountTouchTimeline();
    touch(viewport, "pointerdown", 1, 600);
    touch(viewport, "pointerdown", 2, 800);
    touch(viewport, "pointermove", 2, 900);
    touch(viewport, "pointerup", 1, 600);
    touch(viewport, "pointerup", 2, 900);
    const play = button("Play");
    const moved = vi.fn();
    // Header controls must receive their native moves rather than being treated
    // as orphaned pointers from the track viewport (including the sheet handle).
    play.addEventListener("pointermove", moved);
    touch(play, "pointerdown", 3, 20, 10);
    touch(play, "pointermove", 3, 20, -40);
    touch(play, "pointerup", 3, 20, -40);
    expect(moved).toHaveBeenCalledTimes(1);
    React.act(() =>
      play.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 })),
    );
    expect(useEditorStore.getState().isPlaying).toBe(true);
  });

  it("offers back-and-forth playback with an explicit snapping hint", async () => {
    rendered = renderEditorComponent(<LayerTimeline />);
    await timelineOption("Back-and-forth playback");
    expect(useEditorStore.getState().playbackMode).toBe("back-and-forth");
    expect(useEditorStore.getState().isRepeating).toBe(true);
    await timelineOption("Back-and-forth playback");
    expect(useEditorStore.getState().playbackMode).toBe("forward");
    if (button("Timeline options").getAttribute("aria-expanded") !== "true") {
      React.act(() => button("Timeline options").click());
    }
    expect(document.body.textContent).toContain("Hold Alt / Option to ignore snapping.");
    expect(document.body.textContent).not.toContain("bypass");
  });

  it("uses one scroll viewport for names and tracks and records its vertical position", () => {
    rendered = renderEditorComponent(<LayerTimeline />);
    const viewport = rendered.container.querySelector<HTMLElement>(
      '[aria-label="Animation tracks"]',
    )!;
    const names = rendered.container.querySelector<HTMLElement>("[data-timeline-layer-names]")!;
    const segments = rendered.container.querySelector<HTMLElement>("[data-timeline-segments]")!;
    expect(viewport.contains(names)).toBe(true);
    expect(viewport.contains(segments)).toBe(true);
    expect(names.className).not.toContain("overflow-y-auto");
    expect(segments.className).not.toContain("overflow-auto");
    React.act(() => {
      viewport.scrollTop = 90;
      viewport.dispatchEvent(new Event("scroll"));
    });
    expect(useEditorStore.getState().timelineScrollY).toBe(90);
  });

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
    expect(range.style.left).toBe("350px");
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
    const tracks = rendered.container.querySelector<HTMLElement>(
      '[aria-label="Animation tracks"]',
    )!;
    const head = () => rendered!.container.querySelector<HTMLElement>("[data-timeline-playhead]")!;
    expect(head().style.left).toBe("850px");
    await timelineOption("Zoom in");
    expect(useEditorStore.getState().timelineZoom).toBeCloseTo(Math.sqrt(2));
    expect(parseFloat(ruler.style.width)).toBeCloseTo(1000 * Math.sqrt(2));
    // Lanes carry a 10px gutter on both ends around the ruler's time span.
    expect(parseFloat(content.style.width)).toBeCloseTo(parseFloat(ruler.style.width) + 20);
    expect(parseFloat(head().style.left)).toBeCloseTo(850);
    React.act(() => {
      tracks.scrollLeft = 300;
      tracks.dispatchEvent(new Event("scroll"));
    });
    expect(ruler.style.left).toBe("-290px");
    expect(parseFloat(head().style.left)).toBeCloseTo(250 + 600 * Math.sqrt(2) - 300);
    await timelineOption("Fit animation");
    expect(content.style.width).toBe("1020px");
    expect(tracks.scrollLeft).toBe(0);
    expect(head().style.left).toBe("850px");
  });

  it("jumps between keyframes with , and . and the transport chevrons", () => {
    addMotion();
    useEditorStore.setState({ progress: 0.25 });
    rendered = renderEditorComponent(<KeyboardTimeline />);
    const duration = useEditorStore.getState().animation.duration;
    const time = () => Math.round(useEditorStore.getState().progress * duration);
    stepFrame(">");
    expect(time()).toBe(Math.round(250 + 1000 / 30));
    React.act(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ".", bubbles: true })),
    );
    expect(time()).toBe(700);
    click("Previous keyframe");
    expect(time()).toBe(100);
    click("Previous keyframe");
    expect(time()).toBe(0);
    expect(button("Previous keyframe").disabled).toBe(true);
    click("Next keyframe");
    expect(time()).toBe(100);
  });

  it("displays and steps exact frames without rounding fractional milliseconds", async () => {
    useEditorStore.setState({ progress: 0.5 });
    rendered = renderEditorComponent(<KeyboardTimeline />);
    await timelineOption("Show frames");
    const frame = rendered.container.querySelector<HTMLInputElement>(
      '[aria-label="Current frame"]',
    )!;
    expect(frame.value).toBe("15");
    stepFrame(">");
    expect(useEditorStore.getState().progress * 1000).toBeCloseTo(500 + 1000 / 30, 10);
    expect(frame.value).toBe("16");
    React.act(() => useTimelineViewSettings.getState().setFps(24));
    const previous = useEditorStore.getState().progress;
    stepFrame(">");
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
