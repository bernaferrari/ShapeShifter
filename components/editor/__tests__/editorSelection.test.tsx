// @vitest-environment happy-dom

import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Inspector } from "../Inspector";
import { LayersPanel } from "../LayersPanel";
import { useEditorKeyboardShortcuts } from "../hooks/useEditorKeyboardShortcuts";
import { useEditorStore } from "@/lib/store/editorStore";
import {
  buttonWithText,
  click,
  renderEditorComponent,
  type RenderedEditorComponent,
} from "./renderEditorComponent";

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

describe("editor selection contracts", () => {
  it("only lists loose canvas layers once there are some", () => {
    useEditorStore.setState({ rootLayers: [] });
    rendered = renderEditorComponent(<LayersPanel onCollapse={() => {}} />);
    expect(rendered.container.textContent).not.toContain("Canvas");
  });

  it("selects an artboard from the left scene navigator without selecting its children", () => {
    const target = useEditorStore.getState().frames[1]!;
    rendered = renderEditorComponent(<LayersPanel onCollapse={() => {}} />);

    click(buttonWithText(rendered.container, target.name));

    const state = useEditorStore.getState();
    expect(state.selectedFrameId).toBe(target.id);
    expect(state.selectedFrameIds).toEqual([target.id]);
    expect(state.selectionKind).toBe("frame");
    expect(state.selectedLayerRefs).toEqual([]);
  });

  it("adds animation directly from a transform property and reveals its timeline track", () => {
    const layer = useEditorStore.getState().layers[0]!;
    useEditorStore.setState((state) => ({
      animation: {
        ...state.animation,
        blocks: state.animation.blocks.filter(
          (block) =>
            String(block.layerId) !== String(layer.id) || block.propertyName !== "rotation",
        ),
      },
      timelineCollapsed: true,
    }));
    useEditorStore.getState().selectLayer(layer.id);
    rendered = renderEditorComponent(<Inspector />);

    const animateRotation = rendered.container.querySelector('[aria-label="Animate Rotation"]');
    expect(animateRotation).toBeInstanceOf(HTMLButtonElement);
    click(animateRotation!);

    const state = useEditorStore.getState();
    const block = state.animation.blocks.find(
      (candidate) =>
        String(candidate.layerId) === String(layer.id) && candidate.propertyName === "rotation",
    );
    expect(block).toBeDefined();
    expect(state.selectedBlockIds).toEqual([block!.id]);
    expect(state.timelineCollapsed).toBe(false);
    expect(
      rendered.container.querySelector('[aria-label="Select Rotation keyframe"]'),
    ).not.toBeNull();
  });

  it("selects a transform keyframe without removing its animation", () => {
    const layer = useEditorStore.getState().layers[0]!;
    useEditorStore.getState().addTimelineBlock(layer.id, "rotation");
    useEditorStore.getState().selectLayer(layer.id);
    rendered = renderEditorComponent(<Inspector />);

    const removeRotation = rendered.container.querySelector(
      '[aria-label="Select Rotation keyframe"]',
    );
    expect(removeRotation).toBeInstanceOf(HTMLButtonElement);
    click(removeRotation!);

    expect(
      useEditorStore
        .getState()
        .animation.blocks.some(
          (candidate) =>
            String(candidate.layerId) === String(layer.id) && candidate.propertyName === "rotation",
        ),
    ).toBe(true);
  });

  it("deletes selected timeline blocks before considering the selected layer", () => {
    function KeyboardHarness() {
      useEditorKeyboardShortcuts();
      return null;
    }
    const state = useEditorStore.getState();
    const block = state.animation.blocks[0]!;
    const layerCount = state.layers.length;
    state.selectBlocks([block.id]);
    rendered = renderEditorComponent(<KeyboardHarness />);

    React.act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    });

    expect(useEditorStore.getState().animation.blocks.some((item) => item.id === block.id)).toBe(
      false,
    );
    expect(useEditorStore.getState().layers).toHaveLength(layerCount);
  });
});
