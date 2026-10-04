// @vitest-environment happy-dom
import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BooleanOperationsPanel } from "../BooleanOperations";
import { useEditorStore } from "@/lib/store/editorStore";
import { parsePath } from "@/lib/shapeshifter/pathUtils";
import { renderEditorComponent, type RenderedEditorComponent } from "./renderEditorComponent";
const notification = vi.hoisted(() => ({ error: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast: notification }));
let rendered: RenderedEditorComponent;
let baseline: ReturnType<typeof useEditorStore.getState>;
beforeEach(() => {
  baseline = useEditorStore.getState();
  const ownerId = baseline.selectedFrameId;
  useEditorStore.setState({
    layers: ["a", "b"].map((id, index) => ({
      id,
      name: id,
      type: "path",
      from: parsePath(`M${index * 5} 0H${index * 5 + 10}V10H${index * 5}Z`),
      fillColor: "red",
      visible: true,
      locked: false,
    })),
    animation: { ...baseline.animation, blocks: [] },
    hiddenLayerIds: [],
    selectedLayerIds: ["a", "b"],
    selectedLayerRefs: [
      { ownerId, layerId: "a" },
      { ownerId, layerId: "b" },
    ],
    historyGestureActive: false,
    dragState: null,
    isPlaying: false,
    isActionMode: false,
  });
  notification.error.mockClear();
  notification.message.mockClear();
  rendered = renderEditorComponent(<BooleanOperationsPanel />);
});
afterEach(() => {
  rendered.unmount();
  useEditorStore.setState(baseline, true);
});
const union = () =>
  [...rendered.container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Union",
  )!;
describe("Boolean authoring controls", () => {
  it("offers explicit selected-path operations with visible refusal reasons", () => {
    expect(union().disabled).toBe(false);
    expect(rendered.container.textContent).toContain(
      "Subtract removes the front paths from the back path",
    );
    act(() =>
      useEditorStore.setState({
        layers: useEditorStore.getState().layers.map((layer) => ({
          ...layer,
          fillColor: "none",
          strokeColor: "red",
          strokeWidth: 2,
        })),
      }),
    );
    expect(union().disabled).toBe(true);
    expect(rendered.container.textContent).toContain("Stroke outlines are not combined");
  });
  it("shows progress and explains an empty result after a real button activation", async () => {
    let finish!: (result: { ok: boolean; empty: boolean }) => void;
    const combine = vi.fn(
      () =>
        new Promise<{ ok: boolean; empty: boolean }>((resolve) => {
          finish = resolve;
        }),
    );
    act(() => useEditorStore.setState({ booleanCombine: combine }));
    act(() => union().click());
    expect(combine).toHaveBeenCalledWith("union");
    expect(union().disabled).toBe(true);
    expect(rendered.container.textContent).toContain("Combining paths…");
    await act(async () => finish({ ok: true, empty: true }));
    expect(notification.message).toHaveBeenCalledWith("No filled area remains", expect.any(Object));
    expect(union().disabled).toBe(false);
  });
  it("surfaces a changed-selection failure without claiming success", async () => {
    act(() =>
      useEditorStore.setState({
        booleanCombine: vi
          .fn()
          .mockResolvedValue({ ok: false, reason: "The selection changed. Retry." }),
      }),
    );
    await act(async () => {
      union().click();
    });
    expect(notification.error).toHaveBeenCalledWith("Paths could not be combined", {
      description: "The selection changed. Retry.",
    });
    expect(notification.message).not.toHaveBeenCalled();
  });
});
