import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "../editorStore";

function freshStore() {
  useEditorStore.getState().resetProject();
  return useEditorStore.getState();
}

function getStore() {
  return useEditorStore.getState();
}

describe("frameActions", () => {
  beforeEach(() => {
    freshStore();
  });

  describe("moveFrame / moveFrames undoability", () => {
    it("moveFrame records history so the move can be undone", () => {
      const frameId = getStore().selectedFrameId;
      const before = getStore().frames.find((frame) => frame.id === frameId)!;

      getStore().moveFrame(frameId, 25, -10);

      expect(getStore().canUndo).toBe(true);
      const moved = getStore().frames.find((frame) => frame.id === frameId)!;
      expect(moved.x).toBe(before.x + 25);
      expect(moved.y).toBe(before.y - 10);

      getStore().undo();

      const restored = getStore().frames.find((frame) => frame.id === frameId)!;
      expect(restored.x).toBe(before.x);
      expect(restored.y).toBe(before.y);
    });

    it("moveFrames records one transaction for a multi-selection", () => {
      const firstFrameId = getStore().selectedFrameId;
      getStore().addFrame();
      const secondFrameId = getStore().selectedFrameId;
      const before = new Map(
        getStore().frames.map((frame) => [frame.id, { x: frame.x, y: frame.y }]),
      );

      getStore().moveFrames([firstFrameId, secondFrameId], 12, -7);

      expect(getStore().canUndo).toBe(true);

      getStore().undo();

      for (const frame of getStore().frames) {
        const snapshot = before.get(frame.id)!;
        expect(frame.x).toBe(snapshot.x);
        expect(frame.y).toBe(snapshot.y);
      }
    });

    it("skips recording when asked (gesture ticks push their own drag-start entry)", () => {
      const frameId = getStore().selectedFrameId;

      getStore().pushHistory();
      const historyLength = getStore().history.length;

      getStore().moveFrames([frameId], 25, -10, { recordHistory: false });
      getStore().moveFrames([frameId], 10, 5, { recordHistory: false });

      expect(getStore().history.length).toBe(historyLength);
      const moved = getStore().frames.find((frame) => frame.id === frameId)!;
      expect(moved.x).toBeGreaterThan(0);
    });
  });
});
