// @vitest-environment happy-dom
import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorStore } from "@/lib/store/editorStore";
import {
  renderEditorComponent,
  type RenderedEditorComponent,
} from "../../__tests__/renderEditorComponent";
import { useEditorKeyboardShortcuts } from "../../hooks/useEditorKeyboardShortcuts";
import { WorldFrameChrome } from "../WorldFrameChrome";

let baseline: ReturnType<typeof useEditorStore.getState>;
let rendered: RenderedEditorComponent;
const onStartDrag = vi.fn();
function Harness() {
  const frames = useEditorStore((state) => state.frames);
  useEditorKeyboardShortcuts();
  return (
    <WorldFrameChrome
      frames={frames}
      viewport={{ x: -10, y: -40, w: 1000, h: 300, scale: 1 }}
      viewportSize={{ w: 1000, h: 300 }}
      hoveredFrameId={null}
      draggingFrameIds={[]}
      isDragging={false}
      onStartDrag={onStartDrag}
    />
  );
}
function title(index: number) {
  const name = useEditorStore.getState().frames[index]!.name;
  return rendered.container.querySelector(`[aria-label="Select frame ${name}"]`)!;
}
function key(target: Element, value: string, shiftKey = false) {
  const event = new KeyboardEvent("keydown", {
    key: value,
    code: value === " " ? "Space" : "Enter",
    bubbles: true,
    cancelable: true,
    shiftKey,
  });
  act(() => {
    (target as HTMLButtonElement).focus();
    target.dispatchEvent(event);
    target.dispatchEvent(
      new KeyboardEvent("keyup", { key: value, code: event.code, bubbles: true, shiftKey }),
    );
  });
  return event;
}
beforeEach(() => {
  baseline = useEditorStore.getState();
  useEditorStore.getState().resetProject();
  const state = useEditorStore.getState();
  useEditorStore.setState({
    frames: state.frames.map((frame, index) => ({
      ...frame,
      name: `Frame ${index}`,
      x: index * 100,
      y: 0,
    })),
    selectedFrameId: state.frames[0]!.id,
    selectedFrameIds: [state.frames[0]!.id],
    hasCanvasSelection: true,
    selectionKind: "frame",
    history: [],
    future: [],
    dragState: null,
    isPlaying: false,
    spacePanActive: false,
  });
  onStartDrag.mockClear();
  rendered = renderEditorComponent(<Harness />);
});
afterEach(() => {
  rendered.unmount();
  useEditorStore.setState(baseline, true);
});

describe("world frame title controls", () => {
  it.each(["Enter", " "])(
    "selects the correct owner with %s without starting a drag or playback",
    (value) => {
      const id = useEditorStore.getState().frames[1]!.id;
      const event = key(title(1), value);
      const state = useEditorStore.getState();
      expect(event.defaultPrevented).toBe(true);
      expect(state.selectedFrameId).toBe(id);
      expect(state.selectedFrameIds).toEqual([id]);
      expect(state.selectionKind).toBe("frame");
      expect(state.isPlaying).toBe(false);
      expect(state.spacePanActive).toBe(false);
      expect(state.dragState).toBeNull();
      expect(state.history).toHaveLength(0);
      expect(onStartDrag).not.toHaveBeenCalled();
      expect(title(1).getAttribute("aria-pressed")).toBe("true");
    },
  );

  it("adds and removes frames with Shift Space", () => {
    const ids = useEditorStore
      .getState()
      .frames.slice(0, 2)
      .map((frame) => frame.id);
    key(title(1), " ", true);
    expect(useEditorStore.getState().selectedFrameIds).toEqual(ids);
    key(title(1), " ", true);
    expect(useEditorStore.getState().selectedFrameIds).toEqual([ids[0]]);
    expect(onStartDrag).not.toHaveBeenCalled();
  });

  it("supports assistive activation with a click that has no pointer detail", () => {
    const id = useEditorStore.getState().frames[1]!.id;
    act(() => title(1).dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 })));
    expect(useEditorStore.getState().selectedFrameId).toBe(id);
    expect(onStartDrag).not.toHaveBeenCalled();
  });

  it("ignores a secondary pointer and starts a primary title drag once", () => {
    const current = useEditorStore.getState().selectedFrameId;
    const id = useEditorStore.getState().frames[1]!.id;
    act(() =>
      title(1).dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, isPrimary: false }),
      ),
    );
    expect(useEditorStore.getState().selectedFrameId).toBe(current);
    expect(onStartDrag).not.toHaveBeenCalled();
    act(() => {
      title(1).dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          isPrimary: true,
          clientX: 15,
          clientY: 25,
        }),
      );
      title(1).dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    });
    expect(useEditorStore.getState().selectedFrameId).toBe(id);
    expect(onStartDrag).toHaveBeenCalledExactlyOnceWith(15, 25, [id]);
  });
});
