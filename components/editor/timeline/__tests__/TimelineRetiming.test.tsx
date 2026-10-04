// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "@/lib/store/editorStore";
import { createEditorAgent } from "@/lib/agent/editorAgent";
import { TimelinePropertyBlock } from "../TimelinePropertyBlock";
import {
  renderEditorComponent,
  type RenderedEditorComponent,
} from "../../__tests__/renderEditorComponent";

let baseline: ReturnType<typeof useEditorStore.getState>;
let rendered: RenderedEditorComponent | null = null;
beforeEach(() => {
  baseline = useEditorStore.getState();
  const state = useEditorStore.getState();
  state.resetProject();
  const layer = useEditorStore.getState().layers[0];
  const blocks = [
    {
      id: "a",
      layerId: layer.id,
      propertyName: "rotation",
      type: "number" as const,
      startTime: 100.25,
      endTime: 400.25,
      fromValue: 0,
      toValue: 90,
    },
    {
      id: "b",
      layerId: layer.id,
      propertyName: "scaleX",
      type: "number" as const,
      startTime: 200.75,
      endTime: 600.75,
      fromValue: 1,
      toValue: 2,
    },
  ];
  useEditorStore.setState({
    animation: { ...useEditorStore.getState().animation, duration: 1000, blocks },
    layers: [{ ...layer, timeline: blocks }],
    selectedBlockIds: ["a", "b"],
    history: [],
    future: [],
    progress: 0.77725,
    isPlaying: false,
    dragState: null,
  });
});
afterEach(() => {
  rendered?.unmount();
  rendered = null;
  useEditorStore.setState(baseline, true);
});
function mount() {
  function Harness() {
    const blocks = useEditorStore((state) => state.animation.blocks);
    const selected = useEditorStore((state) => state.selectedBlockIds);
    return (
      <>
        {blocks.map((block) => (
          <div data-timeline-row key={block.id}>
            <TimelinePropertyBlock
              block={block}
              duration={1000}
              selected={selected.includes(block.id)}
              gridStep={50}
            />
          </div>
        ))}
      </>
    );
  }
  rendered = renderEditorComponent(<Harness />);
  for (const row of rendered.container.querySelectorAll<HTMLElement>("[data-timeline-row]"))
    row.getBoundingClientRect = () => ({ width: 1000 }) as DOMRect;
  return rendered.container.querySelector('[data-timeline-block-id="a"]')!;
}
function pointer(element: Element, type: string, clientX: number, altKey = true, pointerId = 1) {
  React.act(() =>
    element.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX,
        altKey,
        pointerId,
      }),
    ),
  );
}
const times = () =>
  useEditorStore.getState().animation.blocks.map((block) => [block.startTime, block.endTime]);

describe("owned timeline pointer transactions", () => {
  it("moves selected property segments together with fractional spacing and one Undo", () => {
    const rail = mount();
    pointer(rail, "pointerdown", 0);
    pointer(rail, "pointermove", 75);
    pointer(rail, "pointermove", 125);
    pointer(rail, "pointerup", 125);
    expect(times()).toEqual([
      [225.25, 525.25],
      [325.75, 725.75],
    ]);
    expect(useEditorStore.getState().selectedBlockIds).toEqual(["a", "b"]);
    expect(useEditorStore.getState().history).toHaveLength(1);
    expect(useEditorStore.getState().dragState).toBeNull();
    expect(
      useEditorStore
        .getState()
        .layers[0].timeline?.map((block) => [block.startTime, block.endTime]),
    ).toEqual(times());
    React.act(() => useEditorStore.getState().undo());
    expect(times()).toEqual([
      [100.25, 400.25],
      [200.75, 600.75],
    ]);
  });
  it("snaps either end of the group to the exact fractional playhead", () => {
    const rail = mount();
    pointer(rail, "pointerdown", 0, false);
    pointer(rail, "pointermove", 174, false);
    pointer(rail, "pointerup", 174, false);
    expect(times()).toEqual([
      [276.75, 576.75],
      [377.25, 777.25],
    ]);
  });
  it.each(["pointercancel", "lostpointercapture"])(
    "%s cancels the transaction and releases its live marker",
    (type) => {
      const rail = mount();
      pointer(rail, "pointerdown", 0);
      pointer(rail, "pointermove", 125);
      pointer(rail, type, 125);
      expect(times()).toEqual([
        [100.25, 400.25],
        [200.75, 600.75],
      ]);
      expect(useEditorStore.getState().history).toHaveLength(0);
      expect(useEditorStore.getState().dragState).toBeNull();
    },
  );
  it("Escape cancels and subsequent pointer movement cannot revive the edit", () => {
    const rail = mount();
    pointer(rail, "pointerdown", 0);
    pointer(rail, "pointermove", 125);
    React.act(() =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      ),
    );
    pointer(rail, "pointermove", 200);
    expect(times()).toEqual([
      [100.25, 400.25],
      [200.75, 600.75],
    ]);
    expect(useEditorStore.getState().history).toHaveLength(0);
  });
  it("Undo invalidates the gesture without consuming a different history entry", () => {
    const rail = mount();
    pointer(rail, "pointerdown", 0);
    pointer(rail, "pointermove", 125);
    React.act(() => useEditorStore.getState().undo());
    pointer(rail, "pointermove", 200);
    pointer(rail, "pointercancel", 200);
    expect(times()).toEqual([
      [100.25, 400.25],
      [200.75, 600.75],
    ]);
    expect(useEditorStore.getState().future).toHaveLength(1);
  });
  it("ignores a secondary pointer and cancels safely when the surface unmounts", () => {
    const rail = mount();
    pointer(rail, "pointerdown", 0);
    pointer(rail, "pointermove", 125, true, 2);
    expect(useEditorStore.getState().history).toHaveLength(0);
    pointer(rail, "pointermove", 125);
    rendered!.unmount();
    rendered = null;
    expect(times()).toEqual([
      [100.25, 400.25],
      [200.75, 600.75],
    ]);
    expect(useEditorStore.getState().dragState).toBeNull();
  });
  it("blocks agent writes even before the first document mutation", () => {
    const rail = mount();
    const agent = createEditorAgent();
    const revision = agent.inspect().revision;
    pointer(rail, "pointerdown", 0);
    expect(() =>
      agent.apply({
        expectedRevision: revision,
        commands: [
          {
            type: "renameLayer",
            ownerId: useEditorStore.getState().selectedFrameId,
            layerId: useEditorStore.getState().layers[0].id,
            name: "Competing",
          },
        ],
      }),
    ).toThrow("Finish the current gesture");
    pointer(rail, "pointerup", 0);
    expect(useEditorStore.getState().history).toHaveLength(0);
  });
  it("refuses an entire selection containing an inherited lock without pushing history", () => {
    const state = useEditorStore.getState();
    useEditorStore.setState({
      layers: [
        { ...state.layers[0], parentId: "locked-parent", locked: false },
        {
          ...state.layers[0],
          id: "locked-parent",
          type: "group",
          locked: true,
          from: { subPaths: [] },
          timeline: undefined,
        },
      ],
    });
    const rail = mount();
    pointer(rail, "pointerdown", 0);
    pointer(rail, "pointermove", 125);
    pointer(rail, "pointerup", 125);
    expect(times()).toEqual([
      [100.25, 400.25],
      [200.75, 600.75],
    ]);
    expect(useEditorStore.getState().history).toHaveLength(0);
  });
});
