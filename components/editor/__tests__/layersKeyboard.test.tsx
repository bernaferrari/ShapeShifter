// @vitest-environment happy-dom
import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LayersPanel } from "../LayersPanel";
import { useEditorKeyboardShortcuts } from "../hooks/useEditorKeyboardShortcuts";
import { useEditorStore } from "@/lib/store/editorStore";
import { createPathLayer } from "@/lib/store/defaultWorkspace";
import { parsePath } from "@/lib/shapeshifter/pathUtils";
import { renderEditorComponent, type RenderedEditorComponent } from "./renderEditorComponent";

let rendered: RenderedEditorComponent;
let baseline: ReturnType<typeof useEditorStore.getState>;
const key = (target: Element, value: string, shiftKey = false) =>
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true }),
    );
  });
beforeEach(() => {
  baseline = useEditorStore.getState();
  useEditorStore.setState({
    layers: [
      createPathLayer({
        id: "group",
        name: "Group",
        type: "group",
        from: parsePath(""),
        visible: true,
        locked: false,
      }),
      createPathLayer({
        id: "one",
        name: "Alpha",
        parentId: "group",
        from: parsePath("M0 0L10 10"),
        visible: true,
        locked: false,
      }),
      createPathLayer({
        id: "two",
        name: "Beta",
        parentId: "group",
        from: parsePath("M0 0L10 10"),
        visible: true,
        locked: false,
      }),
    ],
    selectedLayerRefs: [],
    selectionKind: "none",
    selectedLayerIds: [],
    toolMode: "select",
  });
  function Harness() {
    useEditorKeyboardShortcuts();
    return <LayersPanel onCollapse={() => {}} />;
  }
  rendered = renderEditorComponent(<Harness />);
});
afterEach(() => {
  rendered.unmount();
  useEditorStore.setState(baseline, true);
});
const row = (id: string) =>
  rendered.container.querySelector<HTMLElement>(`[data-layer-id="${id}"]`)!;

describe("Layers keyboard workflow", () => {
  it("navigates hierarchy, collapses it, and restores focus to the parent", () => {
    act(() => row("group").focus());
    key(row("group"), "ArrowRight");
    expect(document.activeElement).toBe(row("one"));
    expect(useEditorStore.getState().selectedLayerId).toBe("one");
    key(row("one"), "ArrowLeft");
    expect(document.activeElement).toBe(row("group"));
    key(row("group"), "ArrowLeft");
    expect(row("one")).toBeNull();
    key(row("group"), "ArrowRight");
    expect(row("one")).not.toBeNull();
  });
  it("selects a contiguous range without allowing global arrow nudging", () => {
    act(() => row("one").focus());
    key(row("one"), "Enter");
    key(row("one"), "ArrowDown", true);
    expect(useEditorStore.getState().selectedLayerRefs.map((ref) => ref.layerId)).toEqual([
      "one",
      "two",
    ]);
    expect(useEditorStore.getState().layers[1]!.translateY ?? 0).toBe(0);
    expect(document.activeElement).toBe(row("two"));
  });
  it("cancels F2 rename and keeps layer focus", () => {
    act(() => row("one").focus());
    key(row("one"), "F2");
    const input = rendered.container.querySelector<HTMLInputElement>(
      '[aria-label="Rename Alpha"]',
    )!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "Changed",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    key(input, "Escape");
    expect(useEditorStore.getState().layers[1]!.name).toBe("Alpha");
    expect(document.activeElement).toBe(row("one"));
    expect(rendered.container.querySelectorAll('[role="treeitem"][tabindex="0"]')).toHaveLength(1);
  });
  it("leaves native keyboard activation available on selected row controls", () => {
    key(row("one"), "Enter");
    const controls = ["Lock Alpha", "Hide Alpha", "Move Alpha to another frame"];
    for (const label of controls) {
      const button = row("one").querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
      expect(button.tabIndex).toBe(0);
      for (const key of ["Enter", " "]) {
        const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
        act(() => button.dispatchEvent(event));
        expect(event.defaultPrevented).toBe(false);
      }
    }
    act(() => row("one").querySelector<HTMLButtonElement>('[aria-label="Lock Alpha"]')!.click());
    expect(useEditorStore.getState().layers.find((layer) => layer.id === "one")!.locked).toBe(true);
    act(() => row("one").querySelector<HTMLButtonElement>('[aria-label="Hide Alpha"]')!.click());
    expect(useEditorStore.getState().layers.find((layer) => layer.id === "one")!.visible).toBe(
      false,
    );
  });
  it("accepts an inside drop on an empty group", () => {
    act(() =>
      useEditorStore.setState({
        layers: [
          ...useEditorStore.getState().layers,
          createPathLayer({
            id: "empty",
            name: "Empty group",
            type: "group",
            from: parsePath(""),
            visible: true,
            locked: false,
          }),
        ],
      }),
    );
    const dataTransfer = { effectAllowed: "", dropEffect: "", setData() {} };
    const drag = (target: Element, type: string) =>
      act(() => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
        target.dispatchEvent(event);
      });
    drag(row("one"), "dragstart");
    drag(row("empty"), "dragover");
    drag(row("empty"), "drop");
    expect(useEditorStore.getState().layers.find((layer) => layer.id === "one")!.parentId).toBe(
      "empty",
    );
  });
});
