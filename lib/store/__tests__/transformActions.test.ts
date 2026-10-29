import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "../editorStore";

function freshStore() {
  useEditorStore.getState().resetProject();
  return useEditorStore.getState();
}

function getStore() {
  return useEditorStore.getState();
}

describe("transformActions", () => {
  beforeEach(() => {
    freshStore();
  });

  describe("recordLayerTranslationAtPlayhead", () => {
    it("seeds a fresh track recorded mid-timeline from the layer's base value, not 0", () => {
      const layer = getStore().layers[0]!;
      getStore().selectLayer(layer.id);
      // Move the layer away from its authored resting pose before recording.
      getStore().translateSelectedLayer(40, 30, { recordHistory: false });
      // Record at 50% — nowhere near the track edges.
      getStore().setProgress(0.5);

      getStore().recordLayerTranslationAtPlayhead();

      const state = getStore();
      for (const propertyName of ["translateX", "translateY"] as const) {
        const block = state.animation.blocks.find(
          (candidate) =>
            String(candidate.layerId) === String(layer.id) &&
            candidate.propertyName === propertyName,
        )!;
        expect(block).toBeDefined();
        expect(Number(block.fromValue)).toBe(propertyName === "translateX" ? 40 : 30);
        expect(Number(block.toValue)).toBe(propertyName === "translateX" ? 40 : 30);
      }
    });

    it("seeds the same fresh-track values as the pure helper used by other scene owners", () => {
      const first = getStore().frames[0]!;
      const second = getStore().frames[1]!;
      const firstLayer = first.layers[0]!;
      const secondLayer = second.layers[0]!;
      getStore().selectLayerRefs([
        { ownerId: first.id, layerId: firstLayer.id },
        { ownerId: second.id, layerId: secondLayer.id },
      ]);
      getStore().translateSelectedLayer(12, -5, { recordHistory: false });
      getStore().setProgress(0.6);

      getStore().recordLayerTranslationAtPlayhead();

      const activeFrame = getStore().frames.find((frame) => frame.id === first.id)!;
      const otherFrame = getStore().frames.find((frame) => frame.id === second.id)!;
      for (const propertyName of ["translateX", "translateY"] as const) {
        const expected = propertyName === "translateX" ? 12 : -5;
        const activeBlock = activeFrame.animation.blocks.find(
          (candidate) =>
            String(candidate.layerId) === String(firstLayer.id) &&
            candidate.propertyName === propertyName,
        )!;
        const otherBlock = otherFrame.animation.blocks.find(
          (candidate) =>
            String(candidate.layerId) === String(secondLayer.id) &&
            candidate.propertyName === propertyName,
        )!;
        expect(activeBlock).toBeDefined();
        expect(otherBlock).toBeDefined();
        expect(Number(activeBlock.fromValue)).toBe(expected);
        expect(Number(activeBlock.toValue)).toBe(expected);
        expect(Number(otherBlock.fromValue)).toBe(expected);
        expect(Number(otherBlock.toValue)).toBe(expected);
      }
    });
  });
});

describe("hierarchical keyboard movement", () => {
  it("moves only selected subtree roots and respects ancestor locks", () => {
    const store = freshStore();
    const child = store.layers[0];
    const group = {
      ...child,
      id: "regression-group",
      type: "group" as const,
      parentId: null,
      translateX: 0,
    };
    useEditorStore.setState({
      layers: [group, { ...child, parentId: group.id, translateX: 0 }],
      selectedLayerRefs: [
        { ownerId: store.selectedFrameId, layerId: group.id },
        { ownerId: store.selectedFrameId, layerId: child.id },
      ],
    });
    getStore().translateSelectedLayer(1, 0);
    expect(getStore().layers[0].translateX).toBe(1);
    expect(getStore().layers[1].translateX).toBe(0);
    useEditorStore.setState({
      layers: getStore().layers.map((l) => (l.id === group.id ? { ...l, locked: true } : l)),
      selectedLayerRefs: [{ ownerId: store.selectedFrameId, layerId: child.id }],
    });
    getStore().translateSelectedLayer(1, 0);
    expect(getStore().layers[1].translateX).toBe(0);
  });
});

it("rescales adjacent segments without overlaps when shortening duration", () => {
  const store = freshStore();
  const layerId = store.layers[0].id;
  useEditorStore.setState({
    animation: {
      ...getStore().animation,
      duration: 1000,
      blocks: [
        {
          id: "a",
          layerId,
          propertyName: "translateX",
          fromValue: 0,
          toValue: 5,
          startTime: 0,
          endTime: 500,
        },
        {
          id: "b",
          layerId,
          propertyName: "translateX",
          fromValue: 5,
          toValue: 10,
          startTime: 500,
          endTime: 1000,
        },
      ],
    },
  });
  getStore().setAnimationDuration(200);
  expect(getStore().animation.blocks.map((b) => [b.startTime, b.endTime])).toEqual([
    [0, 100],
    [100, 200],
  ]);
  getStore().undo();
  expect(getStore().animation.duration).toBe(1000);
});
