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
});
