import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "../editorStore";
import { parsePath, pathToString } from "../../shapeshifter/pathUtils";

let baseline: ReturnType<typeof useEditorStore.getState>;
beforeEach(() => {
  baseline = useEditorStore.getState();
  useEditorStore.getState().resetProject();
});
afterEach(() => useEditorStore.setState(baseline, true));

const START = "M 0 0 L 10 0 L 10 10 Z";
const END = "M 0 0 L 20 0 L 20 20 Z";

/** A path layer whose shape morphs START → END over the whole animation. */
function morphingLayer() {
  const store = useEditorStore.getState();
  store.addLayer("path");
  store.updateSelectedLayer({
    from: parsePath(START),
    pathData: parsePath(START),
    to: parsePath(END),
  });
  store.beginTimelineMorphEditing();
  const state = useEditorStore.getState();
  state.updateTimelineBlock(state.selectedBlockIds[0]!, { interpolator: "LINEAR" });
  useEditorStore.getState().closeActionMode();
  useEditorStore.setState({ toolMode: "direct", isPlaying: false });
  return useEditorStore.getState().selectedLayerId;
}

const tracks = (id: string | number) =>
  useEditorStore
    .getState()
    .animation.blocks.filter(
      (block) => String(block.layerId) === String(id) && block.propertyName === "pathData",
    )
    .sort((a, b) => a.startTime - b.startTime);

const layer = (id: string | number) =>
  useEditorStore.getState().layers.find((item) => String(item.id) === String(id))!;

describe("editing the shape at the playhead", () => {
  it("edits the keyframe under the playhead and follows the playhead to the next keyframe", () => {
    const id = morphingLayer();
    const store = useEditorStore.getState();
    store.setProgress(0);
    store.syncPathEditingWithPlayhead();
    expect(useEditorStore.getState()).toMatchObject({ isActionMode: true, editingSide: "from" });
    expect(pathToString(layer(id).from)).toBe(tracks(id)[0]!.fromValue);

    useEditorStore.getState().setProgress(1);
    useEditorStore.getState().syncPathEditingWithPlayhead();
    expect(useEditorStore.getState()).toMatchObject({ isActionMode: true, editingSide: "to" });
  });

  it("inserts a keyframe on the first edit between keyframes and writes the edit into it", () => {
    const id = morphingLayer();
    useEditorStore.getState().setProgress(0.5);
    useEditorStore.getState().syncPathEditingWithPlayhead();
    expect(useEditorStore.getState().isActionMode).toBe(false);

    expect(useEditorStore.getState().ensurePathKeyframeAtPlayhead()).toBe(true);
    const [left, right] = tracks(id);
    expect(tracks(id)).toHaveLength(2);
    expect(left!.endTime).toBe(right!.startTime);
    expect(useEditorStore.getState()).toMatchObject({
      isActionMode: true,
      editingSide: "from",
      selectedBlockIds: [right!.id],
    });

    const edited = parsePath("M 0 0 L 30 0 L 30 30 Z");
    useEditorStore.getState().updateSelectedLayer({ from: edited, pathData: edited });
    const [nextLeft, nextRight] = tracks(id);
    expect(nextRight!.fromValue).toBe(pathToString(edited));
    // The linked neighbour shares the edited keyframe.
    expect(nextLeft!.toValue).toBe(pathToString(edited));
  });

  it("returns the layer to its base artwork when leaving keyframe editing", () => {
    const id = morphingLayer();
    useEditorStore.getState().setProgress(0.5);
    useEditorStore.getState().ensurePathKeyframeAtPlayhead();
    expect(pathToString(layer(id).from)).not.toBe(pathToString(parsePath(START)));

    useEditorStore.getState().setToolMode("select");
    useEditorStore.getState().syncPathEditingWithPlayhead();
    expect(useEditorStore.getState().isActionMode).toBe(false);
    expect(pathToString(layer(id).from)).toBe(tracks(id)[0]!.fromValue);
    expect(pathToString(layer(id).to!)).toBe(tracks(id).at(-1)!.toValue);
  });
});

describe("setting animated properties at the playhead", () => {
  it("keys animated properties at the playhead and returns static ones for base edits", () => {
    const store = useEditorStore.getState();
    const id = store.layers[0]!.id;
    useEditorStore.setState((state) => ({
      animation: {
        ...state.animation,
        blocks: state.animation.blocks.filter((block) => String(block.layerId) !== String(id)),
      },
    }));
    useEditorStore.getState().addTimelineBlock(id, "rotation");
    useEditorStore.getState().setProgress(0.5);
    const rest = useEditorStore.getState().setPropertiesAtPlayhead(id, { rotation: 90, alpha: 0.5 });
    expect(rest).toEqual({ alpha: 0.5 });
    const rotation = useEditorStore
      .getState()
      .animation.blocks.filter((block) => String(block.layerId) === String(id))
      .sort((a, b) => a.startTime - b.startTime);
    expect(rotation).toHaveLength(2);
    expect(rotation[0]!.toValue).toBe(90);
    expect(rotation[1]!.fromValue).toBe(90);
    expect(rotation[0]!.endTime).toBe(rotation[1]!.startTime);
  });
});
