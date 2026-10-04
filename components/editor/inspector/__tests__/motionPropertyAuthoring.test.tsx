// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "@/lib/store/editorStore";
import { parsePath } from "@/lib/shapeshifter/pathUtils";
import type { LayerType } from "@/lib/shapeshifter/types";
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
  rendered = renderEditorComponent(<Inspector />);
  return current;
}
function openSection(title: string) {
  const header = Array.from(rendered!.container.querySelectorAll("button[aria-expanded]")).find(
    (candidate) => candidate.textContent === title,
  ) as HTMLButtonElement;
  if (header.getAttribute("aria-expanded") === "false") click(header);
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
    expect(state.toolMode).toBe("direct");
  });

  it.each([
    ["Opacity", "alpha", 1],
    ["Fill opacity", "fillAlpha", 1],
    ["Stroke opacity", "strokeAlpha", 1],
    ["Trim start", "trimPathStart", 0],
    ["Trim end", "trimPathEnd", 1],
    ["Trim offset", "trimPathOffset", 0],
  ])("authors %s from its inline keyframe toggle", (label, property, base) => {
    const current = mount();
    if (property.startsWith("trimPath")) openSection("Trim path");
    click(button(`Animate ${label}`));
    const state = useEditorStore.getState();
    const track = state.animation.blocks.find((item) => item.id === state.selectedBlockIds[0]);
    expect(track).toMatchObject({
      layerId: current.id,
      propertyName: property,
      type: "number",
      fromValue: base,
    });
    expect(button(`Remove ${label} animation`)).toBeInstanceOf(HTMLButtonElement);
  });

  it("offers transforms and pivots for groups, and only geometry for clip paths", () => {
    mount("group");
    button("Animate Rotation center");
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

  it("keys an animated property at the playhead when its field is edited", () => {
    const current = mount();
    click(button("Animate Opacity"));
    React.act(() => useEditorStore.getState().setProgress(0.5));
    const opacity = rendered!.container.querySelector<HTMLInputElement>(
      '[aria-label="Opacity"]:not([role="slider"])',
    )!;
    React.act(() => {
      opacity.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        opacity,
        "40",
      );
      opacity.dispatchEvent(new Event("input", { bubbles: true }));
    });
    React.act(() => opacity.blur());
    const track = useEditorStore
      .getState()
      .animation.blocks.filter(
        (block) => String(block.layerId) === String(current.id) && block.propertyName === "alpha",
      )
      .sort((a, b) => a.startTime - b.startTime);
    const duration = useEditorStore.getState().animation.duration;
    expect(track).toHaveLength(2);
    expect(track[0]!.endTime).toBe(duration / 2);
    expect(track[0]!.toValue).toBe(0.4);
    expect(track[1]!.fromValue).toBe(0.4);
    // The base value is untouched: the property is animated.
    expect(
      useEditorStore.getState().layers.find((layer) => layer.id === current.id)?.alpha ?? 1,
    ).toBe(1);
  });
});
