import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "../editorStore";
import { compileLiveAndroidArtboard } from "../exportDocument";
import { parsePath, pathToString } from "../../shapeshifter/pathUtils";

let baseline: ReturnType<typeof useEditorStore.getState>;
beforeEach(() => {
  baseline = useEditorStore.getState();
  useEditorStore.getState().resetProject();
});
afterEach(() => useEditorStore.setState(baseline, true));

function staticPath(withEnd = false) {
  const store = useEditorStore.getState();
  store.addLayer("path");
  store.updateSelectedLayer({
    from: parsePath("M 0 0 L 10 10"),
    pathData: parsePath("M 0 0 L 10 10"),
    ...(withEnd && { to: parsePath("M 5 0 L 15 10") }),
    fillColor: "#ff0000",
  });
  useEditorStore.setState({
    history: [],
    future: [],
    selectedBlockIds: [],
    isActionMode: false,
    isPlaying: true,
    timelineCollapsed: true,
  });
  return useEditorStore.getState().selectedLayerId;
}
const pathBlocks = (id: string | number) =>
  useEditorStore
    .getState()
    .animation.blocks.filter(
      (block) => String(block.layerId) === String(id) && block.propertyName === "pathData",
    );

describe("first morph track entry", () => {
  it("creates one exportable selected path track and preserves the canvas bridge through Undo/Redo", () => {
    const id = staticPath();
    const store = useEditorStore.getState();
    expect(store.beginTimelineMorphEditing()).toBe(true);
    const block = pathBlocks(id)[0]!;
    expect(block).toMatchObject({ type: "path", startTime: 0, endTime: store.animation.duration });
    expect(useEditorStore.getState()).toMatchObject({
      selectedBlockIds: [block.id],
      isActionMode: true,
      isPlaying: false,
      timelineCollapsed: false,
      editingSide: "from",
    });
    expect(useEditorStore.getState().history).toHaveLength(1);
    store.setEditingSide("to");
    store.updateSelectedLayer({ to: parsePath("M 5 0 L 15 10") });
    expect(pathToString(parsePath(String(pathBlocks(id)[0].toValue)))).toBe(
      pathToString(parsePath("M 5 0 L 15 10")),
    );
    const compiled = compileLiveAndroidArtboard();
    expect(compiled.files.some((file) => file.path.endsWith("_animated.xml"))).toBe(true);
    expect(
      compiled.files.some(
        (file) =>
          file.path.startsWith("res/animator/") &&
          file.content.includes('android:propertyName="pathData"') &&
          file.content.includes(`android:valueTo="${pathToString(parsePath("M 5 0 L 15 10"))}"`),
      ),
    ).toBe(true);
    store.undo();
    expect(pathBlocks(id)[0].toValue).toBe(block.toValue);
    expect(useEditorStore.getState().selectedBlockIds).toEqual([block.id]);
    store.undo();
    expect(pathBlocks(id)).toHaveLength(0);
    expect(useEditorStore.getState().isActionMode).toBe(false);
    expect(useEditorStore.getState().layers.find((layer) => layer.id === id)?.to).toBeUndefined();
    store.redo();
    expect(pathBlocks(id)).toHaveLength(1);
    expect(useEditorStore.getState().selectedBlockIds).toEqual([block.id]);
    expect(useEditorStore.getState().isActionMode).toBe(true);
  });

  it("preserves existing implicit endpoints and their linear transition when making the morph explicit", () => {
    const id = staticPath(true);
    const store = useEditorStore.getState();
    expect(store.beginTimelineMorphEditing()).toBe(true);
    const block = pathBlocks(id)[0]!;
    expect(block.interpolator).toBe("LINEAR");
    expect(pathToString(parsePath(String(block.fromValue)))).toBe(
      pathToString(parsePath("M 0 0 L 10 10")),
    );
    expect(pathToString(parsePath(String(block.toValue)))).toBe(
      pathToString(parsePath("M 5 0 L 15 10")),
    );
    const history = useEditorStore.getState().history.length;
    expect(store.beginTimelineMorphEditing()).toBe(true);
    expect(pathBlocks(id)).toHaveLength(1);
    expect(useEditorStore.getState().history).toHaveLength(history);
  });

  it("chooses the segment at the playhead unless an explicit path segment is already selected", () => {
    const id = staticPath(true);
    const store = useEditorStore.getState();
    store.beginTimelineMorphEditing();
    const first = pathBlocks(id)[0]!;
    store.insertTimelineKeyframe(first.id, 500);
    const second = pathBlocks(id)[1]!;
    store.closeActionMode();
    useEditorStore.setState({ selectedBlockIds: [], progress: 0.75 });
    store.beginTimelineMorphEditing();
    expect(useEditorStore.getState().selectedBlockIds).toEqual([second.id]);
    store.selectBlocks([first.id]);
    store.beginTimelineMorphEditing();
    expect(useEditorStore.getState().selectedBlockIds).toEqual([first.id]);
    expect(pathBlocks(id)).toHaveLength(2);
  });

  it("rejects locked layers, groups and multiple layers without document or history writes", () => {
    staticPath();
    const store = useEditorStore.getState();
    const unchanged = () => {
      const state = useEditorStore.getState();
      const history = state.history.length;
      const animation = state.animation;
      expect(store.beginTimelineMorphEditing()).toBe(false);
      expect(useEditorStore.getState().animation).toBe(animation);
      expect(useEditorStore.getState().history).toHaveLength(history);
    };
    store.updateSelectedLayer({ locked: true });
    unchanged();
    store.addLayer("group");
    unchanged();
    store.selectLayers(store.layers.map((layer) => layer.id));
    unchanged();
  });

  it.each([
    ["alpha", -0.1],
    ["fillAlpha", 1.01],
    ["strokeAlpha", 1.01],
    ["trimPathStart", -0.01],
    ["trimPathEnd", 1.01],
    ["strokeWidth", -1],
  ])("rejects an invalid %s endpoint without history", (property, value) => {
    const id = staticPath();
    const store = useEditorStore.getState();
    store.addTimelineBlock(id, property as string);
    const blockId = useEditorStore.getState().selectedBlockIds[0];
    const previous = useEditorStore.getState().animation;
    const history = useEditorStore.getState().history.length;
    store.updateTimelineKeyframe(blockId, "end", { value: value as number });
    expect(useEditorStore.getState().animation).toBe(previous);
    expect(useEditorStore.getState().history).toHaveLength(history);
  });
});
