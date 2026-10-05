import { beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "../editorStore";
import { createPathLayer } from "../defaultWorkspace";
import { parsePath } from "../../shapeshifter/pathUtils";
import { evaluateAndroidScene } from "../../shapeshifter/scene/evaluate";
import { vectorCoordinateResizePolicy } from "../../shapeshifter/vectorSpace";

function worldMatrices(progress: number) {
  const state = useEditorStore.getState();
  const frame = state.frames.find((frame) => frame.id === state.selectedFrameId)!;
  return evaluateAndroidScene(state.layers, state.animation, progress, true).nodes.map((node) => ({
    id: node.id,
    ...node.worldMatrix,
    e: node.worldMatrix.e + frame.x,
    f: node.worldMatrix.f + frame.y,
  }));
}
function expectMatrices(
  actual: ReturnType<typeof worldMatrices>,
  expected: ReturnType<typeof worldMatrices>,
) {
  expect(actual.map((matrix) => matrix.id)).toEqual(expected.map((matrix) => matrix.id));
  for (const [index, matrix] of actual.entries()) {
    for (const axis of ["a", "b", "c", "d", "e", "f"] as const)
      expect(matrix[axis]).toBeCloseTo(expected[index]![axis], 10);
  }
}
beforeEach(() => {
  const state = useEditorStore.getState();
  state.resetProject();
  const frame = useEditorStore.getState().frames[0]!;
  const path = createPathLayer({
    id: "child",
    name: "Child",
    parentId: "group",
    locked: true,
    visible: true,
    from: parsePath("M1 1 C2 8 9 3 12 12 Z"),
    fillColor: "#ff0000",
    rotation: 23,
  });
  useEditorStore.setState({
    selectedFrameId: frame.id,
    selectedFrameIds: [frame.id],
    selectionKind: "frame",
    layers: [
      {
        ...createPathLayer({
          id: "group",
          name: "Group",
          from: { subPaths: [] },
          visible: true,
          locked: false,
        }),
        type: "group",
        translateX: 2,
        translateY: 3,
        rotation: 35,
        scaleX: 1.2,
        scaleY: 0.8,
        alpha: 0.7,
      },
      path,
      {
        ...createPathLayer({
          id: "mask",
          name: "Mask",
          visible: true,
          locked: false,
          from: parsePath("M0 0 L22 0 L22 22 Z"),
        }),
        type: "clipPath",
        translateX: 3,
      },
      createPathLayer({
        id: "root",
        name: "Root",
        visible: true,
        locked: false,
        from: parsePath("M2 2 L16 2 L16 16 Z"),
        translateY: 6,
      }),
    ],
    vector: { ...frame.vector, width: 96, height: 72, viewportWidth: 24, viewportHeight: 24 },
    animation: {
      ...frame.animation,
      duration: 1000,
      blocks: [
        {
          id: "gx",
          layerId: "group",
          propertyName: "translateX",
          type: "number",
          fromValue: 2,
          toValue: 12,
          startTime: 0,
          endTime: 1000,
          interpolator: "cubic-bezier(0.34, 1.56, 0.64, 1)",
        },
        {
          id: "gy",
          layerId: "group",
          propertyName: "translateY",
          type: "number",
          fromValue: 3,
          toValue: 9,
          startTime: 0,
          endTime: 1000,
          interpolator: "LINEAR",
        },
        {
          id: "cy",
          layerId: "child",
          propertyName: "translateY",
          type: "number",
          fromValue: 0,
          toValue: 5,
          startTime: 0,
          endTime: 1000,
          interpolator: "LINEAR",
        },
      ],
    },
    history: [],
    future: [],
    canUndo: false,
    canRedo: false,
  });
  useEditorStore.getState().syncActiveOwner({ includeAnimation: true });
});

describe("frame boundary resizing", () => {
  it("keeps animated, transformed and locked artwork still across the entire timeline, with one-step undo", () => {
    const state = useEditorStore.getState();
    const frame = state.frames.find((frame) => frame.id === state.selectedFrameId)!;
    const times = [0, 0.3, 0.7, 1];
    const before = times.map(worldMatrices);
    const paths = state.layers.map((layer) => layer.from);
    state.resizeFrame(frame.id, { x: frame.x - 5, y: frame.y - 8, w: 29, h: 32 });
    const next = useEditorStore.getState();
    for (const [index, time] of times.entries())
      expectMatrices(worldMatrices(time), before[index]!);
    expect(next.layers.map((layer) => layer.from)).toEqual(paths);
    expect(next.layers.find((layer) => layer.id === "child")!.locked).toBe(true);
    expect(next.animation.blocks[2]).toEqual(state.animation.blocks[2]);
    expect(next.vector).toMatchObject({
      width: 96,
      height: 72,
      viewportWidth: 29,
      viewportHeight: 32,
    });
    expect(next.history).toHaveLength(1);
    next.undo();
    for (const [index, time] of times.entries())
      expectMatrices(worldMatrices(time), before[index]!);
    expect(useEditorStore.getState().frames.find((item) => item.id === frame.id)).toMatchObject({
      x: frame.x,
      y: frame.y,
    });
    expect(useEditorStore.getState().vector.viewportWidth).toBe(24);
    expect(useEditorStore.getState().animation.blocks).toEqual(state.animation.blocks);
  });

  it("uses the captured sizing policy on every drag update without accumulating artwork drift", () => {
    const state = useEditorStore.getState();
    const frame = state.frames.find((frame) => frame.id === state.selectedFrameId)!;
    state.updateVector(
      { viewportWidth: undefined, viewportHeight: undefined, width: 24, height: 24 },
      { recordHistory: false },
    );
    const policy = vectorCoordinateResizePolicy(useEditorStore.getState().vector);
    const original = worldMatrices(0.7);
    state.pushHistory();
    for (let amount = 1; amount <= 20; amount++)
      state.resizeFrame(
        frame.id,
        { x: frame.x - amount, y: frame.y - amount, w: 24 + amount, h: 24 + amount },
        { recordHistory: false, policy },
      );
    expectMatrices(worldMatrices(0.7), original);
    expect(useEditorStore.getState().vector).toMatchObject({
      width: 44,
      height: 44,
      viewportWidth: 44,
      viewportHeight: 44,
    });
    expect(useEditorStore.getState().history).toHaveLength(1);
    state.undo();
    expectMatrices(worldMatrices(0.7), original);
  });
});
