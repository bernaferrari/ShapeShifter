// @vitest-environment happy-dom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimelineLayersPane } from "../TimelineLayersPane";
import { LayerTimeline } from "../../LayerTimeline";
import type { TimelineRow } from "../timelineProjection";
import { useEditorKeyboardShortcuts } from "../../hooks/useEditorKeyboardShortcuts";
import { useEditorStore, type CanvasFrame } from "@/lib/store/editorStore";
import { createPathLayer } from "@/lib/store/defaultWorkspace";
import { parsePath } from "@/lib/shapeshifter/pathUtils";
import type { TimelineBlock } from "@/lib/shapeshifter/types";
import {
  renderEditorComponent,
  click,
  type RenderedEditorComponent,
} from "../../__tests__/renderEditorComponent";

let rendered: RenderedEditorComponent | null = null;
let baseline: ReturnType<typeof useEditorStore.getState>;
let otherFrame: CanvasFrame;

beforeEach(() => {
  baseline = useEditorStore.getState();
  useEditorStore.getState().resetProject();
  const state = useEditorStore.getState();
  const layer = createPathLayer({
    id: "shared-layer-id",
    name: "Other owner artwork",
    from: parsePath("M 0 0 L 10 0 L 10 10 Z"),
    visible: true,
    locked: false,
  });
  const block: TimelineBlock = {
    id: "other-owner-rotation",
    layerId: layer.id,
    propertyName: "rotation",
    type: "number",
    fromValue: 0,
    toValue: 90,
    startTime: 500,
    endTime: 1500,
    interpolator: "linear",
  };
  otherFrame = {
    ...state.frames[1]!,
    layers: [layer],
    animation: { ...state.frames[1]!.animation, duration: 2000, blocks: [block] },
  };
  useEditorStore.setState({
    frames: state.frames.map((frame) => (frame.id === otherFrame.id ? otherFrame : frame)),
    isPlaying: false,
    selectedBlockIds: [],
  });
  useEditorStore.getState().selectFrame(state.frames[0]!.id);
});

afterEach(() => {
  rendered?.unmount();
  rendered = null;
  useEditorStore.setState(baseline, true);
});

function mount(rows: TimelineRow[]) {
  const onToggleFrame = vi.fn();
  function Harness() {
    useEditorKeyboardShortcuts();
    return (
      <TimelineLayersPane
        rows={rows}
        width={260}
        onToggleFrame={onToggleFrame}
        onToggleGroup={() => {}}
        blocksForLayer={(frameId, layerId) =>
          frameId === otherFrame.id
            ? otherFrame.animation.blocks.filter(
                (block) => String(block.layerId) === String(layerId),
              )
            : []
        }
        blocksForProperty={(frameId, layerId, propertyName) =>
          frameId === otherFrame.id
            ? otherFrame.animation.blocks.filter(
                (block) =>
                  String(block.layerId) === String(layerId) && block.propertyName === propertyName,
              )
            : []
        }
      />
    );
  }
  rendered = renderEditorComponent(<Harness />);
  return onToggleFrame;
}

function key(target: Element, value: string) {
  const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true });
  React.act(() => target.dispatchEvent(event));
  return event;
}

function objectRow(): TimelineRow {
  return {
    kind: "object",
    key: "other-object",
    frameId: otherFrame.id,
    layer: otherFrame.layers[0]!,
    name: otherFrame.layers[0]!.name,
    depth: 1,
  };
}

describe("timeline navigator keyboard ownership", () => {
  it("selects the correct owner and object with Enter", () => {
    mount([objectRow()]);
    const event = key(rendered!.container.querySelector('[role="button"]')!, "Enter");
    const state = useEditorStore.getState();
    expect(event.defaultPrevented).toBe(true);
    expect(state.selectedFrameId).toBe(otherFrame.id);
    expect(state.selectedLayerRefs).toEqual([
      { ownerId: otherFrame.id, layerId: otherFrame.layers[0]!.id },
    ]);
    expect(state.selectionKind).toBe("layer");
  });

  it("selects a property and its blocks with Space without toggling playback", () => {
    mount([
      {
        kind: "property",
        key: "other-property",
        frameId: otherFrame.id,
        layer: otherFrame.layers[0]!,
        propertyName: "rotation",
        depth: 2,
      },
    ]);
    const row = rendered!.container.querySelector(
      '[aria-label="Select Rotation track for Other owner artwork"]',
    )!;
    expect(row).not.toBeNull();
    const event = key(row, " ");
    React.act(() =>
      row.dispatchEvent(new KeyboardEvent("keyup", { key: " ", code: "Space", bubbles: true })),
    );
    const state = useEditorStore.getState();
    expect(event.defaultPrevented).toBe(true);
    expect(state.selectedFrameId).toBe(otherFrame.id);
    expect(state.selectedBlockIds).toEqual(["other-owner-rotation"]);
    expect(state.isPlaying).toBe(false);
    expect(state.spacePanActive).toBe(false);
  });

  it("jumps to another owner's keyframe using its duration and pauses playback", () => {
    mount([
      {
        kind: "property",
        key: "other-property",
        frameId: otherFrame.id,
        layer: otherFrame.layers[0]!,
        propertyName: "rotation",
        depth: 2,
      },
    ]);
    React.act(() => useEditorStore.setState({ isPlaying: true, progress: 0.9 }));
    const button = rendered!.container.querySelector(
      '[aria-label="Next Rotation for Other owner artwork keyframe"]',
    )!;
    React.act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(useEditorStore.getState().selectedFrameId).toBe(otherFrame.id);
    expect(useEditorStore.getState().progress).toBe(0.25);
    expect(useEditorStore.getState().isPlaying).toBe(false);
  });

  it("lets the frame disclosure button expand without selecting its owner", () => {
    const onToggleFrame = mount([
      {
        kind: "frame",
        key: "other-frame",
        frameId: otherFrame.id,
        name: otherFrame.name,
        depth: 0,
        expanded: true,
      },
    ]);
    const beforeOwner = useEditorStore.getState().selectedFrameId;
    const button = rendered!.container.querySelector("button")!;
    key(button, "Enter");
    React.act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onToggleFrame).toHaveBeenCalledExactlyOnceWith(otherFrame.id);
    expect(useEditorStore.getState().selectedFrameId).toBe(beforeOwner);
  });

  it("discards a layer rename with Escape and preserves undo history", () => {
    mount([objectRow()]);
    const name = Array.from(rendered!.container.querySelectorAll("span")).find(
      (element) => element.textContent === "Other owner artwork",
    )!;
    React.act(() =>
      name.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true })),
    );
    const input = rendered!.container.querySelector("input")!;
    expect(input).not.toBeNull();
    const historyLength = useEditorStore.getState().history.length;
    input.value = "Discard this rename";
    key(input, "Escape");
    const state = useEditorStore.getState();
    expect(rendered!.container.querySelector("input")).toBeNull();
    expect(state.layers[0]!.name).toBe("Other owner artwork");
    expect(state.frames.find((frame) => frame.id === otherFrame.id)!.layers[0]!.name).toBe(
      "Other owner artwork",
    );
    expect(state.history.length).toBe(historyLength);
  });
});

describe("timeline row keyframe controls", () => {
  function mountMorph() {
    const state = useEditorStore.getState();
    const layer = state.layers[0]!;
    const from = "M0 0 L10 0 L10 10 Z";
    const to = "M0 0 L20 0 L20 20 Z";
    useEditorStore.setState({
      progress: 0,
      animation: {
        ...state.animation,
        duration: 1000,
        blocks: [
          {
            id: "morph-left",
            layerId: layer.id,
            propertyName: "pathData",
            type: "path",
            fromValue: from,
            toValue: to,
            startTime: 0,
            endTime: 400,
            interpolator: "LINEAR",
          },
          {
            id: "morph-right",
            layerId: layer.id,
            propertyName: "pathData",
            type: "path",
            fromValue: to,
            toValue: from,
            startTime: 400,
            endTime: 1000,
            interpolator: "LINEAR",
          },
        ],
      },
    });
    rendered = renderEditorComponent(<LayerTimeline />);
    return layer;
  }
  function control(label: string) {
    const button = rendered!.container.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    );
    expect(button).not.toBeNull();
    return button!;
  }

  it("puts controls on a morph's layer row and seeks adjacent keys without editing", () => {
    const layer = mountMorph();
    const before = useEditorStore.getState().animation.blocks;
    expect(control(`Previous ${layer.name} keyframe`).disabled).toBe(true);
    React.act(() => useEditorStore.setState({ isPlaying: true }));
    click(control(`Next ${layer.name} keyframe`));
    expect(useEditorStore.getState().progress).toBe(0.4);
    expect(useEditorStore.getState().isPlaying).toBe(false);
    click(control(`Next ${layer.name} keyframe`));
    expect(useEditorStore.getState().progress).toBe(1);
    expect(control(`Next ${layer.name} keyframe`).disabled).toBe(true);
    click(control(`Previous ${layer.name} keyframe`));
    expect(useEditorStore.getState().progress).toBe(0.4);
    expect(useEditorStore.getState().animation.blocks).toEqual(before);
  });

  it("adds a pose between keys, removes it, and undoes each operation in one step", () => {
    const layer = mountMorph();
    React.act(() => useEditorStore.getState().setProgress(0.2));
    const before = useEditorStore.getState().animation.blocks;
    click(control(`Add ${layer.name} keyframe`));
    const inserted = useEditorStore.getState().animation.blocks;
    expect(inserted).toHaveLength(3);
    expect(
      inserted.filter((block) => block.startTime === 200 || block.endTime === 200),
    ).toHaveLength(2);
    expect(control(`Remove ${layer.name} keyframe`).getAttribute("aria-pressed")).toBe("true");
    click(control(`Remove ${layer.name} keyframe`));
    expect(useEditorStore.getState().animation.blocks).toHaveLength(2);
    expect(control(`Add ${layer.name} keyframe`).getAttribute("aria-pressed")).toBe("false");
    React.act(() => useEditorStore.getState().undo());
    expect(useEditorStore.getState().animation.blocks).toEqual(inserted);
    React.act(() => useEditorStore.getState().undo());
    expect(useEditorStore.getState().animation.blocks).toEqual(before);
  });

  it("starts a path animation from an empty diamond", () => {
    const layer = mountMorph();
    React.act(() =>
      useEditorStore.setState({
        animation: { ...useEditorStore.getState().animation, blocks: [] },
      }),
    );
    click(control(`Animate ${layer.name}`));
    expect(useEditorStore.getState().animation.blocks).toHaveLength(1);
    expect(useEditorStore.getState().animation.blocks[0]).toMatchObject({
      layerId: layer.id,
      propertyName: "pathData",
    });
    control(`Remove ${layer.name} keyframe`);
  });
});
