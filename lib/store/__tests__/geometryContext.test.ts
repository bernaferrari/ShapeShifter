import { beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "../editorStore";

beforeEach(() => useEditorStore.getState().resetProject());
describe("World geometry and motion context", () => {
  it("keeps vector editing and the playhead independent", () => {
    useEditorStore.setState({ progress: 0.5, isPlaying: true });
    useEditorStore.getState().setToolMode("direct");
    expect(useEditorStore.getState()).toMatchObject({
      progress: 0.5,
      isPlaying: false,
      toolMode: "direct",
    });
    useEditorStore.getState().setProgress(0.25);
    expect(useEditorStore.getState()).toMatchObject({ progress: 0.25, toolMode: "direct" });
  });
  it("keeps the explicit morph editing context when changing time", () => {
    useEditorStore.getState().startActionMode();
    useEditorStore.getState().setProgress(0.5);
    expect(useEditorStore.getState()).toMatchObject({
      progress: 0.5,
      toolMode: "direct",
      isActionMode: true,
    });
    useEditorStore.getState().setToolMode("pen");
    expect(useEditorStore.getState().progress).toBe(0.5);
  });
  it("returns to the visible base endpoint when leaving To morph editing for world Pen", () => {
    useEditorStore.getState().startActionMode();
    useEditorStore.getState().setEditingSide("to");
    useEditorStore.getState().setToolMode("pen");
    expect(useEditorStore.getState().editingSide).toBe("to");
    useEditorStore.getState().closeActionMode();
    useEditorStore.getState().setToolMode("pen");
    expect(useEditorStore.getState()).toMatchObject({
      isActionMode: false,
      editingSide: "from",
      progress: 0,
      toolMode: "pen",
      selectedPoints: [],
    });
  });
  it("plays without changing the tool and preserves playhead positions", () => {
    useEditorStore.getState().setToolMode("pen");
    useEditorStore.getState().togglePlayback();
    expect(useEditorStore.getState()).toMatchObject({ isPlaying: true, toolMode: "pen" });
    useEditorStore.getState().togglePlayback();
    useEditorStore.getState().setProgress(0.6);
    useEditorStore.getState().setToolMode("select");
    expect(useEditorStore.getState().progress).toBe(0.6);
  });
});
