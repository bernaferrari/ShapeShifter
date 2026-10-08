import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "../editorStore";
import { numberAtTime } from "../../pathshift/playheadResolve";
import {
  appliedMotionPresets,
  motionPresetSegments,
  motionPresetsForLayer,
} from "../../pathshift/motion/motionPresets";

let baseline: ReturnType<typeof useEditorStore.getState>;
beforeEach(() => {
  baseline = useEditorStore.getState();
  useEditorStore.getState().resetProject();
});
afterEach(() => useEditorStore.setState(baseline, true));

function setup() {
  const state = useEditorStore.getState();
  const layer = { ...state.layers[0]!, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 };
  useEditorStore.setState({
    animation: {
      ...state.animation,
      duration: 1000,
      blocks: [
        {
          id: "old-rotation",
          layerId: layer.id,
          propertyName: "rotation",
          type: "number",
          fromValue: 0,
          toValue: 90,
          startTime: 0,
          endTime: 1000,
        },
        {
          id: "kept-alpha",
          layerId: layer.id,
          propertyName: "alpha",
          type: "number",
          fromValue: 1,
          toValue: 0,
          startTime: 0,
          endTime: 1000,
        },
      ],
    },
    layers: [layer],
    selectedLayerId: layer.id,
    history: [],
    future: [],
  });
  return layer;
}

describe("motion presets", () => {
  it("chains keyframes into back-to-back segments that return to the base pose", () => {
    const segments = motionPresetSegments("tilt", { rotation: 10 }, 1000);
    expect(segments.map((s) => [s.startTime, s.endTime, s.fromValue, s.toValue])).toEqual([
      [0, 250, 10, 25],
      [250, 750, 25, -5],
      [750, 1000, -5, 10],
    ]);
  });

  it("only offers presets whose properties the layer can animate", () => {
    const ids = (type: "path" | "group" | "clipPath") =>
      motionPresetsForLayer({ type }).map((preset) => preset.id);
    expect(ids("path")).toEqual(["spin", "tilt", "pulse", "pop", "fade", "draw"]);
    expect(ids("group")).toEqual(["spin", "tilt", "pulse", "pop"]);
    expect(ids("clipPath")).toEqual([]);
  });

  it("replaces only the preset's tracks, centers the pivot, and undoes in one step", () => {
    const layer = setup();
    useEditorStore.getState().applyMotionPreset(layer.id, "spin", { x: 12, y: 8 });

    const state = useEditorStore.getState();
    const rotation = state.animation.blocks.filter((block) => block.propertyName === "rotation");
    expect(rotation).toHaveLength(1);
    expect(rotation[0]).toMatchObject({ fromValue: 0, toValue: 360, interpolator: "LINEAR" });
    expect(state.animation.blocks.some((block) => block.id === "kept-alpha")).toBe(true);
    expect(numberAtTime(state.layers[0]!, state.animation.blocks, "rotation", 500, 1000)).toBe(180);
    expect(state.layers[0]).toMatchObject({ pivotX: 12, pivotY: 8 });
    expect(state.selectedBlockIds).toEqual([rotation[0]!.id]);
    expect(state.history).toHaveLength(1);

    state.undo();
    const restored = useEditorStore.getState();
    expect(restored.animation.blocks.map((block) => block.id)).toEqual([
      "old-rotation",
      "kept-alpha",
    ]);
    expect(restored.layers[0]).toMatchObject({ pivotX: 0, pivotY: 0 });
  });

  it("leaves an existing pivot alone so the artwork never jumps", () => {
    const layer = setup();
    useEditorStore.setState({ layers: [{ ...layer, rotation: 30 }] });
    useEditorStore.getState().applyMotionPreset(layer.id, "pulse", { x: 12, y: 8 });
    expect(useEditorStore.getState().layers[0]).toMatchObject({ pivotX: 0, pivotY: 0 });
  });

  it("lists applied presets side by side until their keyframes are edited by hand", () => {
    const layer = setup();
    const applied = () => {
      const state = useEditorStore.getState();
      return appliedMotionPresets(
        state.layers[0]!,
        state.animation.blocks,
        state.animation.duration,
      ).map((preset) => preset.id);
    };
    expect(applied()).toEqual([]);

    useEditorStore.getState().applyMotionPreset(layer.id, "spin", null);
    useEditorStore.getState().applyMotionPreset(layer.id, "fade", null);
    expect(applied()).toEqual(["spin", "fade"]);

    const spin = useEditorStore
      .getState()
      .animation.blocks.find((block) => block.propertyName === "rotation")!;
    useEditorStore.getState().updateTimelineBlock(spin.id, { toValue: 180 });
    expect(applied()).toEqual(["fade"]);
  });
});
