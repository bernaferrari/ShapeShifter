// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "@/lib/store/editorStore";
import { parsePath } from "@/lib/shapeshifter/pathUtils";
import type { LayerType } from "@/lib/shapeshifter/types";
import { MotionPanel } from "../InspectorPanels";
import { Inspector } from "../../Inspector";
import {
  click,
  renderEditorComponent,
  type RenderedEditorComponent,
} from "../../__tests__/renderEditorComponent";

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
function layer(type: LayerType = "path") {
  const store = useEditorStore.getState();
  store.addLayer(type);
  store.updateSelectedLayer({
    from: parsePath("M 0 0 L 10 10"),
    pathData: parsePath("M 0 0 L 10 10"),
  });
  return useEditorStore
    .getState()
    .layers.find((item) => item.id === useEditorStore.getState().selectedLayerId)!;
}
function mount(type: LayerType = "path") {
  const current = layer(type);
  rendered = renderEditorComponent(
    <MotionPanel
      layer={current}
      selectionCount={1}
      onEditMorph={() => useEditorStore.getState().beginTimelineMorphEditing()}
    />,
  );
  return current;
}
function button(label: string) {
  const result = rendered!.container.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  expect(result).toBeInstanceOf(HTMLButtonElement);
  return result!;
}

describe("supported motion authoring", () => {
  it("makes the generic inspector path action create a visible selected morph track", () => {
    const current = layer();
    rendered = renderEditorComponent(<Inspector />);
    click(button("Edit start and end paths"));
    const state = useEditorStore.getState();
    expect(
      state.animation.blocks.find((item) => item.id === state.selectedBlockIds[0]),
    ).toMatchObject({
      layerId: current.id,
      propertyName: "pathData",
      type: "path",
    });
    expect(state.isActionMode).toBe(true);
    expect(rendered.container.textContent).toContain("Path keyframes");
  });

  it.each([
    ["Opacity", "alpha", 1],
    ["Fill opacity", "fillAlpha", 1],
    ["Stroke opacity", "strokeAlpha", 1],
    ["Trim start", "trimPathStart", 0],
    ["Trim end", "trimPathEnd", 1],
    ["Trim offset", "trimPathOffset", 0],
    ["Pivot X", "pivotX", 0],
    ["Pivot Y", "pivotY", 0],
  ])("authors %s through the Motion UI", (label, property, base) => {
    const current = mount();
    click(button(`Animate ${label}`));
    const state = useEditorStore.getState();
    const track = state.animation.blocks.find((item) => item.id === state.selectedBlockIds[0]);
    expect(track).toMatchObject({
      layerId: current.id,
      propertyName: property,
      type: "number",
      fromValue: base,
    });
    expect(
      rendered!.container.querySelector(`input[aria-label="${label} to value"]`),
    ).toBeInstanceOf(HTMLInputElement);
  });

  it("offers transforms and pivots for groups, and only geometry for clip paths", () => {
    mount("group");
    button("Animate Pivot X");
    expect(rendered!.container.querySelector('[aria-label="Animate Fill"]')).toBeNull();
    expect(rendered!.container.querySelector('[aria-label="Animate Opacity"]')).toBeNull();
    expect(rendered!.container.textContent).not.toContain("Vector morph");
    rendered!.unmount();
    rendered = null;
    mount("clipPath");
    button("Animate Path");
    expect(rendered!.container.querySelector('[aria-label="Animate Rotation"]')).toBeNull();
    expect(rendered!.container.querySelector('[aria-label="Animate Fill"]')).toBeNull();
  });

  it("shows percent domains, rejects invalid opacity drafts and accepts exact fractional trim values", () => {
    mount();
    click(button("Animate Opacity"));
    const input = () =>
      rendered!.container.querySelector<HTMLInputElement>('input[aria-label="Opacity to value"]')!;
    const edit = (field: HTMLInputElement, value: string) =>
      React.act(() => {
        field.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          field,
          value,
        );
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
    const enter = (field: HTMLInputElement) =>
      React.act(() =>
        field.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
        ),
      );
    edit(input(), "101");
    enter(input());
    expect(input().getAttribute("aria-invalid")).toBe("true");
    expect(rendered!.container.querySelector('[role="alert"]')?.textContent).toBe("Use 0–100 %.");
    edit(input(), "37.125");
    enter(input());
    expect(
      useEditorStore
        .getState()
        .animation.blocks.find(
          (block) => block.id === useEditorStore.getState().selectedBlockIds[0],
        )?.toValue,
    ).toBe(0.37125);
    click(button("Animate Trim end"));
    const trim = rendered!.container.querySelector<HTMLInputElement>(
      'input[aria-label="Trim end to value"]',
    )!;
    edit(trim, "62.125");
    enter(trim);
    expect(
      useEditorStore
        .getState()
        .animation.blocks.find(
          (block) => block.id === useEditorStore.getState().selectedBlockIds[0],
        )?.toValue,
    ).toBe(0.62125);
  });
});
