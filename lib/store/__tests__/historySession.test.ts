import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "../editorStore";

let baseline: ReturnType<typeof useEditorStore.getState>;
beforeEach(() => {
  baseline = useEditorStore.getState();
  useEditorStore.getState().resetProject();
});
afterEach(() => useEditorStore.setState(baseline, true));

describe("history session restoration", () => {
  it.each(["undo", "cancelLastHistoryTransaction"] as const)(
    "%s keeps the current playhead and cameras, pauses, and restores selection in its owner",
    (restore) => {
      const first = useEditorStore.getState().frames[0]!;
      const second = useEditorStore.getState().frames[1]!;
      const selectedId = first.layers[0]!.id;
      useEditorStore.getState().selectFrame(first.id);
      useEditorStore.getState().selectLayer(selectedId);
      useEditorStore.getState().pushHistory();
      useEditorStore.getState().translateSelectedLayer(10, 0, { recordHistory: false });
      useEditorStore.getState().selectFrame(second.id);
      const worldViewport = { x: -12, y: 30, w: 300, h: 180, scale: 2 };
      const detailViewport = { x: 5, y: 8, w: 50, h: 70, scale: 3 };
      useEditorStore.setState({ progress: 0.675, isPlaying: true, worldViewport, detailViewport });

      useEditorStore.getState()[restore]();

      const state = useEditorStore.getState();
      expect(state.progress).toBe(0.675);
      expect(state.isPlaying).toBe(false);
      expect(state.worldViewport).toBe(worldViewport);
      expect(state.detailViewport).toBe(detailViewport);
      expect(state.selectedFrameId).toBe(first.id);
      expect(state.selectedLayerId).toBe(selectedId);
      expect(state.selectedLayerRefs).toEqual([{ ownerId: first.id, layerId: selectedId }]);
      expect(state.layers.some((layer) => layer.id === selectedId)).toBe(true);
      expect(state.layers[0]!.translateX).toBe(first.layers[0]!.translateX);
    },
  );

  it("redo also previews its restored motion at the user's current playhead", () => {
    const state = useEditorStore.getState();
    const selectedId = state.layers[0]!.id;
    state.selectLayer(selectedId);
    state.translateSelectedLayer(10, 0);
    useEditorStore.getState().undo();
    useEditorStore.setState({ progress: 0.825, isPlaying: true });

    useEditorStore.getState().redo();

    expect(useEditorStore.getState().progress).toBe(0.825);
    expect(useEditorStore.getState().isPlaying).toBe(false);
    expect(useEditorStore.getState().layers[0]!.translateX).toBe(10);
  });
});
