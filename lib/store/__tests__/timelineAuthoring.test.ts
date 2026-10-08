import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "../editorStore";
import {
  buildEditorDocument,
  workspaceFromDocument,
  documentEditingIssues,
} from "../../pathshift/documentModel";
import { workspaceFromEditor } from "../documentRuntime";
import { numberAtTime } from "../../pathshift/playheadResolve";
import { parsePath, pathToString } from "../../pathshift/pathUtils";
import type { TimelineBlock } from "../../pathshift/types";

let baseline: ReturnType<typeof useEditorStore.getState>;
beforeEach(() => {
  baseline = useEditorStore.getState();
  useEditorStore.getState().resetProject();
});
afterEach(() => useEditorStore.setState(baseline, true));

function setup(propertyName = "rotation") {
  const state = useEditorStore.getState();
  const layer = state.layers[0]!;
  const blocks: TimelineBlock[] = [
    {
      id: "left",
      layerId: layer.id,
      propertyName,
      type: propertyName === "pathData" ? "path" : "number",
      fromValue: propertyName === "pathData" ? "M 0 0 L 10 10" : 0,
      toValue: propertyName === "pathData" ? "M 5 0 L 15 10" : 50,
      startTime: 0,
      endTime: 500,
      interpolator: "LINEAR",
    },
    {
      id: "right",
      layerId: layer.id,
      propertyName,
      type: propertyName === "pathData" ? "path" : "number",
      fromValue: propertyName === "pathData" ? "M 5 0 L 15 10" : 50,
      toValue: propertyName === "pathData" ? "M 10 0 L 20 10" : 100,
      startTime: 500,
      endTime: 1000,
      interpolator: "LINEAR",
    },
  ];
  useEditorStore.setState({
    animation: { ...state.animation, duration: 1000, blocks },
    layers: [layer],
    selectedLayerId: layer.id,
    selectedLayerIds: [layer.id],
    selectedLayerRefs: [{ ownerId: state.selectedFrameId, layerId: layer.id }],
    selectedBlockIds: ["right"],
    history: [],
    future: [],
    isActionMode: false,
  });
  return layer;
}
const blocks = () => useEditorStore.getState().animation.blocks;

describe("timeline authoring actions", () => {
  it("moves a selected chain atomically, including per-layer metadata and one Undo", () => {
    setup();
    const store = useEditorStore.getState();
    useEditorStore.setState({
      animation: { ...useEditorStore.getState().animation, duration: 1500 },
    });
    store.selectBlocks(["left", "right"]);
    const historyLength = useEditorStore.getState().history.length;
    store.moveTimelineBlocks(["left", "right"], 125.25);
    expect(blocks().map((block) => [block.startTime, block.endTime])).toEqual([
      [125.25, 625.25],
      [625.25, 1125.25],
    ]);
    expect(useEditorStore.getState().animation.blocks).toEqual(blocks());
    expect(useEditorStore.getState().history).toHaveLength(historyLength + 1);
    store.undo();
    expect(blocks().map((block) => [block.startTime, block.endTime])).toEqual([
      [0, 500],
      [500, 1000],
    ]);
    expect(useEditorStore.getState().selectedBlockIds).toEqual(["left", "right"]);
  });
  it("deletes one endpoint without deleting its animation, persists the remaining pose, and adds a new pose", () => {
    const layer = setup();
    const store = useEditorStore.getState();
    store.removeTimelineBlocks(["right"]);
    store.removeTimelineKeyframe("left", "start");
    expect(blocks()).toHaveLength(1);
    expect(blocks()[0]).toMatchObject({ startTime: 500, endTime: 500, fromValue: 50, toValue: 50 });
    const document = buildEditorDocument(workspaceFromEditor(useEditorStore.getState()));
    expect(Object.values(document.tracks)[0].keyframeIds).toHaveLength(1);
    expect(documentEditingIssues(document)).toEqual([]);
    expect(workspaceFromDocument(document).frames[0].animation.blocks).toEqual(blocks());
    expect(numberAtTime(layer, blocks(), "rotation", 200, 1000)).toBe(50);
    expect(numberAtTime(layer, blocks(), "rotation", 900, 1000)).toBe(50);
    store.updateTimelineKeyframe("left", "start", { time: 517.25, value: 60 });
    expect(blocks()[0]).toMatchObject({
      startTime: 517.25,
      endTime: 517.25,
      fromValue: 60,
      toValue: 60,
    });
    store.setProgress(0.8);
    store.setPropertiesAtPlayhead(layer.id, { rotation: 100 });
    expect(blocks()).toHaveLength(1);
    expect(blocks()[0]).toMatchObject({
      startTime: 517.25,
      endTime: 800,
      fromValue: 60,
      toValue: 100,
    });
    store.undo();
    expect(blocks()[0]).toMatchObject({ startTime: 517.25, endTime: 517.25 });
    store.removeTimelineKeyframe("left", "start");
    expect(blocks()).toHaveLength(1);
    store.removeTimelineProperty(layer.id, "rotation");
    expect(blocks()).toHaveLength(0);
  });
  it("authors a pose in a gap without creating a backwards segment", () => {
    const layer = setup();
    const store = useEditorStore.getState();
    store.updateTimelineBlock("right", { startTime: 700, fromValue: 75 });
    store.setProgress(0.6);
    store.setPropertiesAtPlayhead(layer.id, { rotation: 65 });
    expect(blocks().find((block) => block.endTime === 600)).toMatchObject({
      startTime: 500,
      fromValue: 50,
      toValue: 65,
    });
    expect(blocks().every((block) => block.endTime >= block.startTime)).toBe(true);
  });
  it("clamps an endpoint before an unrelated segment and refuses locked endpoint edits", () => {
    setup();
    const store = useEditorStore.getState();
    store.updateTimelineBlock("right", { startTime: 700, fromValue: 75 });
    store.updateTimelineKeyframe("left", "end", { time: 900 });
    expect(blocks()[0].endTime).toBe(700);
    const state = useEditorStore.getState();
    useEditorStore.setState({ layers: state.layers.map((layer) => ({ ...layer, locked: true })) });
    const before = blocks();
    const history = useEditorStore.getState().history.length;
    store.updateTimelineKeyframe("left", "end", { time: 600, value: 99 });
    store.moveTimelineBlocks(["left", "right"], 100);
    store.removeTimelineKeyframe("left", "end");
    expect(blocks()).toBe(before);
    expect(useEditorStore.getState().history).toHaveLength(history);
  });
  it("preserves layer identities when a canonical timeline edit changes no per-layer metadata", () => {
    setup();
    useEditorStore.setState((state) => ({
      layers: state.layers.map((layer) => layer),
    }));
    const layers = useEditorStore.getState().layers;
    useEditorStore.getState().updateTimelineKeyframe("right", "start", { value: 75 });
    expect(useEditorStore.getState().layers).toBe(layers);
  });
  it.each([
    ["strokeWidth", 0],
    ["fillAlpha", 1],
    ["strokeAlpha", 1],
    ["pivotX", 0],
  ])("seeds editable numeric %s tracks with their semantic defaults", (property, value) => {
    setup();
    const store = useEditorStore.getState();
    store.addTimelineBlock(store.layers[0].id, property as string);
    const block = blocks().at(-1)!;
    expect(block.type).toBe("number");
    expect(block.fromValue).toBe(value);
  });
  it("inserts a sampled keyframe, selects its next segment, and undoes in one step", () => {
    setup();
    const store = useEditorStore.getState();
    expect(store.insertTimelineKeyframe("right", 750)).toBe(true);
    expect(blocks()).toHaveLength(3);
    expect(blocks()[1].toValue).toBe(75);
    expect(blocks()[2].fromValue).toBe(75);
    expect(store.getCurrentSelectedPoint()).toBeNull();
    expect(useEditorStore.getState().selectedBlockIds).toEqual([blocks()[2].id]);
    expect(useEditorStore.getState().animation.blocks).toHaveLength(3);
    store.undo();
    expect(blocks()).toHaveLength(2);
    expect(useEditorStore.getState().selectedBlockIds).toEqual(["right"]);
    store.redo();
    expect(useEditorStore.getState().selectedBlockIds).toEqual([blocks()[2].id]);
  });

  it("edits both representations of a shared keyframe with exact time and value", () => {
    setup();
    useEditorStore
      .getState()
      .updateTimelineKeyframe("right", "start", { time: 517.25, value: 67.125 });
    expect([blocks()[0].endTime, blocks()[1].startTime]).toEqual([517.25, 517.25]);
    expect([blocks()[0].toValue, blocks()[1].fromValue]).toEqual([67.125, 67.125]);
    expect(useEditorStore.getState().history).toHaveLength(1);
    useEditorStore.getState().undo();
    expect([blocks()[0].endTime, blocks()[1].startTime]).toEqual([500, 500]);
    expect([blocks()[0].toValue, blocks()[1].fromValue]).toEqual([50, 50]);
  });

  it("clamps shared timing to keep the adjacent segments editable", () => {
    setup();
    useEditorStore.getState().updateTimelineKeyframe("right", "start", { time: -10 });
    expect(blocks()[0].endTime).toBe(blocks()[1].startTime);
    expect(blocks()[0].endTime).toBeGreaterThan(0);
    expect(blocks()[0].endTime).toBeLessThan(1);
    useEditorStore.getState().updateTimelineKeyframe("right", "start", { time: 2000 });
    expect(blocks()[0].endTime).toBe(blocks()[1].startTime);
    expect(blocks()[0].endTime).toBeLessThan(1000);
    expect(blocks()[0].endTime).toBeGreaterThan(999);
  });

  it("moves a segment while preserving shared endpoints and its span", () => {
    setup();
    useEditorStore.getState().moveTimelineBlock("right", -125.5);
    expect([blocks()[0].endTime, blocks()[1].startTime, blocks()[1].endTime]).toEqual([
      374.5, 374.5, 874.5,
    ]);
    expect(useEditorStore.getState().history).toHaveLength(1);
    useEditorStore.getState().undo();
    expect([blocks()[0].endTime, blocks()[1].startTime, blocks()[1].endTime]).toEqual([
      500, 500, 1000,
    ]);
  });

  it("keeps subframe authoring intact when changing duration and skips unchanged duration history", () => {
    setup();
    const store = useEditorStore.getState();
    store.updateTimelineBlock("right", { startTime: 998.5 });
    const historyLength = useEditorStore.getState().history.length;
    store.setAnimationDuration(1000);
    expect(useEditorStore.getState().history).toHaveLength(historyLength);
    store.setAnimationDuration(999.75);
    expect(blocks()[1].startTime).toBe(998.5);
    expect(blocks()[1].endTime).toBe(999.75);
    store.setAnimationDuration(999);
    expect(blocks()[1].startTime).toBe(998);
    expect(blocks()[1].endTime).toBe(999);
  });
});

describe("motion clipboard", () => {
  it("copies segments without history and pastes exact offsets onto another active-owner layer in one undo", () => {
    const layer = setup();
    const store = useEditorStore.getState();
    store.updateTimelineBlock("left", { startTime: 17.25, endTime: 317.25 });
    store.updateTimelineBlock("right", { startTime: 443.75, endTime: 843.75 });
    store.selectBlocks(["left", "right"]);
    const beforeCopyHistory = useEditorStore.getState().history.length;
    expect(store.copyTimelineBlocks()).toBe(true);
    expect(useEditorStore.getState().history).toHaveLength(beforeCopyHistory);
    store.addLayer("path");
    const target = useEditorStore.getState().selectedLayerId;
    const historyLength = useEditorStore.getState().history.length;
    const result = store.pasteTimelineBlocks(target, 200.125);
    expect(result.ok).toBe(true);
    const pasted = blocks().filter((block) => block.layerId === target);
    expect(pasted.map((block) => [block.startTime, block.endTime])).toEqual([
      [200.125, 500.125],
      [626.625, 1026.625],
    ]);
    expect(pasted.map((block) => block.id)).not.toEqual(["left", "right"]);
    expect(useEditorStore.getState().animation.duration).toBe(1026.625);
    expect(blocks().filter((block) => block.layerId === layer.id)).toHaveLength(2);
    expect(useEditorStore.getState().history).toHaveLength(historyLength + 1);
    store.undo();
    expect(blocks().filter((block) => block.layerId === target)).toHaveLength(0);
    expect(useEditorStore.getState().animation.duration).toBe(1000);
  });

  it("repeats motion after its last keyframe and extends duration without stretching the original", () => {
    setup();
    const store = useEditorStore.getState();
    store.copyTimelineBlocks(["left", "right"]);
    const result = store.pasteTimelineBlocks(undefined, 1000);
    expect(result.ok).toBe(true);
    expect(blocks().map((block) => [block.startTime, block.endTime])).toEqual([
      [0, 500],
      [500, 1000],
      [1000, 1500],
      [1500, 2000],
    ]);
    expect(useEditorStore.getState().animation.duration).toBe(2000);
    expect(useEditorStore.getState().progress).toBe(0.5);
  });

  it("rejects overlapping or incompatible motion atomically without changing history", () => {
    setup();
    const store = useEditorStore.getState();
    store.copyTimelineBlocks(["left", "right"]);
    const before = blocks();
    const history = useEditorStore.getState().history.length;
    expect(store.pasteTimelineBlocks(undefined, 250)).toMatchObject({
      ok: false,
      message: expect.stringContaining("already"),
    });
    expect(blocks()).toBe(before);
    expect(useEditorStore.getState().history).toHaveLength(history);
    store.addLayer("clipPath");
    const afterAdding = blocks();
    const newHistory = useEditorStore.getState().history.length;
    expect(store.pasteTimelineBlocks()).toMatchObject({
      ok: false,
      message: expect.stringContaining("incompatible"),
    });
    expect(blocks()).toBe(afterAdding);
    expect(useEditorStore.getState().history).toHaveLength(newHistory);
  });

  it("remaps both color and path blocks and respects target locks", () => {
    const layer = setup("pathData");
    const store = useEditorStore.getState();
    store.addTimelineBlock(layer.id, "fillColor");
    const color = useEditorStore.getState().selectedBlockIds[0];
    store.updateTimelineBlock(color, { fromValue: "#ff000080", toValue: "#0000ff" });
    store.copyTimelineBlocks(["left", "right", color]);
    store.addLayer("path");
    const target = useEditorStore.getState().selectedLayerId;
    store.updateSelectedLayer({ locked: true });
    expect(store.pasteTimelineBlocks(target, 0)).toMatchObject({
      ok: false,
      message: expect.stringContaining("Unlock"),
    });
    useEditorStore.setState((state) => ({
      layers: state.layers.map((item) => (item.id === target ? { ...item, locked: false } : item)),
    }));
    expect(store.pasteTimelineBlocks(target, 0).ok).toBe(true);
    expect(
      blocks()
        .filter((block) => block.layerId === target)
        .map((block) => block.type),
    ).toEqual(["path", "path", "color"]);
  });
});

describe("selected explicit path track editing", () => {
  it("loads the selected segment and updates its tracked endpoint from a canvas point edit", () => {
    setup("pathData");
    const store = useEditorStore.getState();
    store.startTimelinePathEditing("right");
    const current = useEditorStore.getState();
    expect(current.isActionMode).toBe(true);
    expect(pathToString(current.layers[0].from)).toBe(
      pathToString(parsePath(String(blocks()[1].fromValue))),
    );
    expect(pathToString(current.layers[0].to!)).toBe(
      pathToString(parsePath(String(blocks()[1].toValue))),
    );
    store.selectPoint({
      layerId: current.layers[0].id,
      side: "from",
      subPathIndex: 0,
      commandIndex: 0,
      pointIndex: 0,
    });
    const previous = blocks()[1].fromValue;
    store.updateSelectedPoint({ x: 7.5, y: 3.25 });
    const value = pathToString(useEditorStore.getState().layers[0].from);
    expect(blocks()[1].fromValue).toBe(value);
    expect(blocks()[0].toValue).toBe(value);
    expect(parsePath(value).subPaths[0].commands[0].points[0]).toMatchObject({ x: 7.5, y: 3.25 });
    store.undo();
    expect(pathToString(parsePath(String(blocks()[1].fromValue)))).toBe(
      pathToString(parsePath(String(previous))),
    );
    expect(useEditorStore.getState().selectedBlockIds).toEqual(["right"]);
    expect(useEditorStore.getState().isActionMode).toBe(true);
    store.updateSelectedPoint({ x: 8, y: 4 });
    expect(
      parsePath(String(blocks()[1].fromValue)).subPaths[0].commands[0].points[0],
    ).toMatchObject({ x: 8, y: 4 });
  });

  it("updates both track paths for structural geometry edits", () => {
    const layer = setup("pathData");
    const store = useEditorStore.getState();
    store.startTimelinePathEditing("right");
    store.splitSelectedLayerSegment({
      layerId: layer.id,
      side: "from",
      subPathIndex: 0,
      commandIndex: 1,
    });
    for (const value of [blocks()[1].fromValue, blocks()[1].toValue]) {
      expect(parsePath(String(value)).subPaths[0].commands).toHaveLength(3);
    }
  });

  it("syncs world base editing but leaves tracks alone for changed selection and graph replacement", () => {
    const layer = setup("pathData");
    const original = blocks();
    useEditorStore.getState().updateSelectedLayer({ from: parsePath("M 9 9 L 10 10") });
    expect(blocks()[0].fromValue).toBe(pathToString(parsePath("M 9 9 L 10 10")));
    expect(blocks()[1]).toBe(original[1]);
    useEditorStore.getState().startTimelinePathEditing("right");
    const selected = blocks();
    useEditorStore.setState({
      layers: [{ ...useEditorStore.getState().layers[0], from: parsePath("M 99 99 L 100 100") }],
      selectedLayerId: "new-layer",
      selectedLayerIds: ["new-layer"],
    });
    expect(blocks()).toBe(selected);
    useEditorStore.setState({
      layers: [{ ...layer, from: parsePath("M 22 22 L 30 30") }],
      selectedLayerId: layer.id,
      document: useEditorStore.getState().document,
    });
    expect(blocks()).toBe(selected);
  });
});
