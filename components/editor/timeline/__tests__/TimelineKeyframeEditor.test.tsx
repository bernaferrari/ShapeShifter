// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "@/lib/store/editorStore";
import { TimelinePropertyBlock } from "../TimelinePropertyBlock";
import {
  renderEditorComponent,
  type RenderedEditorComponent,
} from "../../__tests__/renderEditorComponent";
import { useEditorKeyboardShortcuts } from "../../hooks/useEditorKeyboardShortcuts";

let baseline: ReturnType<typeof useEditorStore.getState>;
let rendered: RenderedEditorComponent | null = null;
beforeEach(() => {
  baseline = useEditorStore.getState();
  useEditorStore.getState().resetProject();
});
afterEach(() => {
  rendered?.unmount();
  rendered = null;
  useEditorStore.setState(baseline, true);
});
function setup(propertyName = "rotation", type: "number" | "color" | "path" = "number") {
  const state = useEditorStore.getState();
  const layer = state.layers[0];
  const from = type === "path" ? "M0 0 L10 10" : type === "color" ? "#ff0000" : 0;
  const middle = type === "path" ? "M5 0 L15 10" : type === "color" ? "#00ff00" : 0.5;
  const to = type === "path" ? "M10 0 L20 10" : type === "color" ? "#0000ff" : 1;
  const blocks = [
    {
      id: "left",
      layerId: layer.id,
      propertyName,
      type,
      startTime: 0,
      endTime: 500,
      fromValue: from,
      toValue: middle,
    },
    {
      id: "right",
      layerId: layer.id,
      propertyName,
      type,
      startTime: 500,
      endTime: 1000,
      fromValue: middle,
      toValue: to,
    },
  ];
  useEditorStore.setState({
    layers: [layer],
    animation: { ...state.animation, duration: 1000, blocks },
    selectedBlockIds: ["right"],
    history: [],
    future: [],
  });
  function Harness() {
    useEditorKeyboardShortcuts();
    const block = useEditorStore((state) =>
      state.animation.blocks.find((item) => item.id === "right"),
    );
    return (
      <section>
        <div aria-label="Animation tracks" tabIndex={-1}>
          <div data-timeline-row>
            {block && <TimelinePropertyBlock block={block} duration={1000} selected />}
          </div>
        </div>
      </section>
    );
  }
  rendered = renderEditorComponent(<Harness />);
  return rendered.container.querySelector('[data-timeline-keyframe-edge="start"]')!;
}
async function open(element: Element, type = "dblclick") {
  await React.act(async () =>
    element.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, detail: type === "click" ? 0 : 2 }),
    ),
  );
}
function field(label: string) {
  return document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!;
}
function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  React.act(() => input.focus());
  React.act(() => {
    const prototype =
      input instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function key(element: Element, key: string) {
  React.act(() =>
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })),
  );
}
const blocks = () => useEditorStore.getState().animation.blocks;

describe("direct keyframe editing", () => {
  it.each(["dblclick", "contextmenu", "click"])(
    "opens through %s without removing a segment",
    async (method) => {
      const trigger = setup();
      await open(trigger, method);
      expect(field("Rotation keyframe time")?.value).toBe("500");
      expect(blocks()).toHaveLength(2);
      expect(useEditorStore.getState().history).toHaveLength(0);
    },
  );
  it("commits precise linked timing as one transaction and previews that endpoint", async () => {
    await open(setup());
    type(field("Rotation keyframe time"), "517.25");
    key(field("Rotation keyframe time"), "Enter");
    expect([blocks()[0].endTime, blocks()[1].startTime]).toEqual([517.25, 517.25]);
    expect(useEditorStore.getState().progress).toBe(0.51725);
    expect(useEditorStore.getState().history).toHaveLength(1);
    React.act(() => useEditorStore.getState().undo());
    expect([blocks()[0].endTime, blocks()[1].startTime]).toEqual([500, 500]);
  });
  it("keeps invalid time out of history and Escape discards the draft", async () => {
    await open(setup());
    const input = field("Rotation keyframe time");
    type(input, "1001");
    key(input, "Enter");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(blocks()[1].startTime).toBe(500);
    expect(useEditorStore.getState().history).toHaveLength(0);
    key(input, "Escape");
    // Base UI 1.8 unmounts a dismissed popover after its exit transition settles.
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(field("Rotation keyframe time")).toBeNull();
    expect(blocks()[1].startTime).toBe(500);
  });
  it.each([
    ["rotation", "number", "Rotation", "67.125", 67.125],
    ["scaleX", "number", "Scale X", "125", 1.25],
    ["fillColor", "color", "Fill", "#123456", "#123456"],
    ["pathData", "path", "Path", "M7.125 0 L17.125 10", "M7.125 0 L17.125 10"],
  ] as const)(
    "edits %s values and their linked neighbors",
    async (property, kind, label, draft, value) => {
      await open(setup(property, kind));
      type(field(`${label} keyframe value`), draft);
      key(field(`${label} keyframe value`), "Enter");
      expect([blocks()[0].toValue, blocks()[1].fromValue]).toEqual([value, value]);
      expect(useEditorStore.getState().history).toHaveLength(1);
    },
  );
  it("joins segments only through explicit deletion and restores them with Undo", async () => {
    await open(setup());
    const remove = document.querySelector<HTMLButtonElement>(
      '[aria-label="Delete Rotation start keyframe"]',
    )!;
    await React.act(async () => remove.click());
    expect(blocks()).toHaveLength(1);
    expect([blocks()[0].startTime, blocks()[0].endTime]).toEqual([0, 1000]);
    React.act(() => useEditorStore.getState().undo());
    expect(blocks()).toHaveLength(2);
  });
});
