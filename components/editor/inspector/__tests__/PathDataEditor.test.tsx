// @vitest-environment happy-dom
import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PathDataEditor } from "../PathDataEditor";
import { useEditorStore } from "@/lib/store/editorStore";
import { pathToString } from "@/lib/shapeshifter/pathUtils";
import {
  renderEditorComponent,
  type RenderedEditorComponent,
} from "../../__tests__/renderEditorComponent";

let baseline: ReturnType<typeof useEditorStore.getState>;
let rendered: RenderedEditorComponent;
let input: HTMLTextAreaElement;
beforeEach(() => {
  baseline = useEditorStore.getState();
  useEditorStore.getState().resetProject();
  useEditorStore.setState({ history: [], future: [], canUndo: false, canRedo: false });
  function Harness() {
    const path = useEditorStore((state) => state.layers[0]!.from);
    return (
      <PathDataEditor
        path={path}
        onCommit={(next) =>
          useEditorStore.getState().updateSelectedLayer({ from: next, pathData: next })
        }
      />
    );
  }
  rendered = renderEditorComponent(<Harness />);
  input = rendered.container.querySelector("textarea")!;
  act(() => input.focus());
});
afterEach(() => {
  rendered.unmount();
  useEditorStore.setState(baseline, true);
});
function type(value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
describe("Path data drafts", () => {
  it("keeps incomplete commands out of geometry and explains the error on blur", () => {
    const before = pathToString(useEditorStore.getState().layers[0]!.from);
    type("M0 0 C1 2");
    act(() => input.blur());
    expect(pathToString(useEditorStore.getState().layers[0]!.from)).toBe(before);
    expect(useEditorStore.getState().history).toHaveLength(0);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(rendered.container.querySelector('[role="alert"]')?.textContent).toContain("Complete");
  });
  it("commits fractional geometry once on Cmd+Enter and Undo restores the original", () => {
    const before = pathToString(useEditorStore.getState().layers[0]!.from);
    type("M0 0 C1 2 3 4 5.375 6");
    expect(useEditorStore.getState().history).toHaveLength(0);
    act(() =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(useEditorStore.getState().layers[0]!.from.subPaths[0]!.commands[1]!.points[2]!.x).toBe(
      5.375,
    );
    expect(useEditorStore.getState().history).toHaveLength(1);
    act(() => useEditorStore.getState().undo());
    expect(pathToString(useEditorStore.getState().layers[0]!.from)).toBe(before);
  });
  it("Escape cancels a valid replacement without committing on blur", () => {
    const before = input.value;
    type("M0 0 L99 99");
    act(() =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      ),
    );
    expect(input.value).toBe(before);
    expect(useEditorStore.getState().history).toHaveLength(0);
  });
});
