// @vitest-environment happy-dom
import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "@/lib/store/editorStore";
import { parsePath } from "@/lib/pathshift/pathUtils";
import type { SceneOwner } from "@/lib/pathshift/scene/selection";
import { useTimelineViewSettings } from "../../timeline/timelineViewSettings";
import { LayerTimeline } from "../../LayerTimeline";
import {
  chooseMenuItem,
  renderEditorComponent,
  type RenderedEditorComponent,
} from "../../__tests__/renderEditorComponent";
import { WorldNextPose } from "../WorldNextPose";

const owner: SceneOwner = {
  ownerId: "frame",
  origin: { x: 40, y: 60 },
  progress: 0,
  layers: [
    {
      id: "path",
      name: "Path",
      type: "path",
      visible: true,
      locked: false,
      from: parsePath("M0 0 L10 10"),
      strokeColor: "#123456",
      strokeWidth: 2,
    },
  ],
  animation: {
    id: "motion",
    name: "Motion",
    duration: 1000,
    blocks: [
      {
        id: "x",
        layerId: "path",
        propertyName: "translateX",
        startTime: 0,
        endTime: 1000,
        fromValue: 0,
        toValue: 20,
        type: "number",
      },
    ],
  },
};
let baseline: ReturnType<typeof useEditorStore.getState>;
let rendered: RenderedEditorComponent | undefined;
beforeEach(() => {
  baseline = useEditorStore.getState();
  useEditorStore.setState({ isPlaying: false, hasCanvasSelection: true, selectionKind: "layer" });
  useTimelineViewSettings.setState({ showNextPose: false, unit: "milliseconds", fps: 30 });
});
afterEach(() => {
  rendered?.unmount();
  rendered = undefined;
  useEditorStore.setState(baseline, true);
  useTimelineViewSettings.setState({ showNextPose: false, unit: "milliseconds", fps: 30 });
});
function mount(sceneOwner = owner) {
  rendered = renderEditorComponent(
    <svg>
      <WorldNextPose
        owners={[sceneOwner]}
        selection={[{ ownerId: "frame", layerId: "path" }]}
        worldPerPx={0.5}
      />
    </svg>,
  );
  return rendered.container;
}
const ghost = (container: HTMLElement) => container.querySelector('[data-next-pose-owner="frame"]');

describe("next pose canvas guide", () => {
  it("is optional, non-interactive and uses the owner's origin and future transform", () => {
    const container = mount();
    expect(ghost(container)).toBeNull();
    act(() => useTimelineViewSettings.getState().setShowNextPose(true));
    const preview = ghost(container)!;
    expect(preview.getAttribute("transform")).toBe("translate(40 60)");
    expect(preview.getAttribute("pointer-events")).toBe("none");
    expect(preview.getAttribute("aria-hidden")).toBe("true");
    expect(preview.getAttribute("data-next-pose-time")).toBe("1000");
    expect(preview.querySelector("g")!.getAttribute("transform")).toContain("20");
    expect(preview.querySelector('path[stroke="#123456"]')!.getAttribute("opacity")).toBe("0.16");
    expect(preview.querySelector('path[stroke-dasharray="4 3"]')).not.toBeNull();
    expect(preview.textContent).toBe("Next · 1000 ms");
    act(() => useTimelineViewSettings.getState().setUnit("frames"));
    expect(preview.textContent).toBe("Next · 30 f");
    act(() => useTimelineViewSettings.getState().setShowNextPose(false));
    expect(ghost(container)).toBeNull();
  });

  it("hides during playback and when the object is no longer selected", () => {
    useTimelineViewSettings.getState().setShowNextPose(true);
    const container = mount();
    expect(ghost(container)).not.toBeNull();
    act(() => useEditorStore.setState({ isPlaying: true }));
    expect(ghost(container)).toBeNull();
    act(() => useEditorStore.setState({ isPlaying: false }));
    expect(ghost(container)).not.toBeNull();
    act(() => useEditorStore.setState({ selectionKind: "frame" }));
    expect(ghost(container)).toBeNull();
    act(() => useEditorStore.setState({ selectionKind: "layer", hasCanvasSelection: false }));
    expect(ghost(container)).toBeNull();
  });

  it("does not invent another pose at the final keyframe", () => {
    useTimelineViewSettings.getState().setShowNextPose(true);
    expect(ghost(mount({ ...owner, progress: 1 }))).toBeNull();
  });

  it("isolates future clip definitions from the current artwork", () => {
    useTimelineViewSettings.getState().setShowNextPose(true);
    const clip = { ...owner.layers[0], id: "clip", type: "clipPath" as const };
    const container = mount({ ...owner, layers: [clip, ...owner.layers] });
    expect(
      container.querySelector('clipPath[id="android-clip-next-pose-frame-clip"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('g[clip-path="url(#android-clip-next-pose-frame-clip)"]'),
    ).not.toBeNull();
  });

  it.each([false, true])(
    "toggles from the actual %s compact Motion options without editing the document",
    async (compact) => {
      useEditorStore.getState().resetProject();
      rendered = renderEditorComponent(<LayerTimeline compact={compact} />);
      const state = useEditorStore.getState();
      const trigger = rendered.container.querySelector('[aria-label="Timeline options"]')!;
      await chooseMenuItem(trigger, "Show next pose");
      expect(useTimelineViewSettings.getState().showNextPose).toBe(true);
      expect(useEditorStore.getState()).toMatchObject({
        layers: state.layers,
        animation: state.animation,
        history: state.history,
        future: state.future,
      });
      expect(JSON.parse(localStorage.getItem("pathshift:timeline-view")!).state.showNextPose).toBe(
        true,
      );
    },
  );
});
