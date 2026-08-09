// @vitest-environment happy-dom

import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Inspector } from "../Inspector";
import { LayersPanel } from "../LayersPanel";
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
  it("always exposes the page-root layer destination, even when it is empty", () => {
    useEditorStore.setState({ rootLayers: [] });
    rendered = renderEditorComponent(<LayersPanel onCollapse={() => {}} />);

    expect(buttonWithText(rendered.container, "Page vectors")).toBeDefined();
    expect(rendered.container.textContent).toContain("No vectors");
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

  it("opening Motion from a selected artboard reveals the timeline without changing selection", () => {
    const target = useEditorStore.getState().frames[1]!;
    useEditorStore.getState().selectFrame(target.id);
    useEditorStore.getState().setTimelineCollapsed(true);
    rendered = renderEditorComponent(<Inspector />);

    click(buttonWithText(rendered.container, "motion"));

    const state = useEditorStore.getState();
    expect(state.timelineCollapsed).toBe(false);
    expect(state.selectedFrameId).toBe(target.id);
    expect(state.selectionKind).toBe("frame");
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
  });
});
