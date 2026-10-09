// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "@/lib/store/editorStore";
import { LayersPanel } from "../../LayersPanel";
import { LayerTimeline } from "../../LayerTimeline";
import { useLayerTreeExpansion } from "../layerTreeExpansion";
import {
  renderEditorComponent,
  type RenderedEditorComponent,
} from "../../__tests__/renderEditorComponent";

let baseline: ReturnType<typeof useEditorStore.getState>;
let rendered: RenderedEditorComponent | null = null;
beforeEach(() => {
  baseline = useEditorStore.getState();
  useEditorStore.getState().resetProject();
  useLayerTreeExpansion.setState({ collapsedOwners: new Set(), collapsedGroups: new Set() });
  // The Layers panel auto-expands to reveal a selected layer, so start from the artboard.
  useEditorStore.getState().selectFrame(useEditorStore.getState().selectedFrameId);
});
afterEach(() => {
  rendered?.unmount();
  rendered = null;
  useEditorStore.setState(baseline, true);
});

const toggles = (name: string) =>
  Array.from(
    rendered!.container.querySelectorAll<HTMLButtonElement>(
      `[aria-label="Collapse ${name}"], [aria-label="Expand ${name}"]`,
    ),
  );
const labels = (name: string) => toggles(name).map((button) => button.getAttribute("aria-label"));

describe("one outline for the Layers panel and the timeline", () => {
  it("collapses an artboard in both lists from either one", () => {
    rendered = renderEditorComponent(
      <>
        <LayersPanel />
        <LayerTimeline />
      </>,
    );
    const name = useEditorStore.getState().frames[0]!.name;
    expect(labels(name)).toEqual([`Collapse ${name}`, `Collapse ${name}`]);

    React.act(() => toggles(name)[0]!.click());
    expect(labels(name)).toEqual([`Expand ${name}`, `Expand ${name}`]);

    React.act(() => toggles(name)[1]!.click());
    expect(labels(name)).toEqual([`Collapse ${name}`, `Collapse ${name}`]);
  });
});
