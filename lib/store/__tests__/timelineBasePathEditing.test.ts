import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "../editorStore";
import { compileLiveAndroidArtboard, serializeLiveProject } from "../exportDocument";
import { legacySnapshotFromDocumentV2 } from "../../shapeshifter/documentModel";
import { parsePath, pathToString } from "../../shapeshifter/pathUtils";
import { evaluateAndroidScene } from "../../shapeshifter/scene/evaluate";
import { blocksFor } from "../../shapeshifter/playheadResolve";
import { syncLayerPathEndpoints } from "../timelinePathEditing";
import type { TimelineBlock } from "../../shapeshifter/types";

let baseline: ReturnType<typeof useEditorStore.getState>;
beforeEach(() => {
  baseline = useEditorStore.getState();
  useEditorStore.getState().resetProject();
});
afterEach(() => useEditorStore.setState(baseline, true));
function selectedDefault() {
  const store = useEditorStore.getState();
  const layer = store.layers[0];
  store.selectLayer(layer.id);
  store.setToolMode("direct");
  useEditorStore.setState({ history: [], future: [], isActionMode: false, selectedBlockIds: [] });
  return layer;
}
function tracks(id: string | number) {
  return blocksFor(useEditorStore.getState().animation.blocks, id, "pathData");
}
function preview(id: string | number, progress = 0) {
  const state = useEditorStore.getState();
  return evaluateAndroidScene(state.layers, state.animation, progress, true).nodesById.get(
    String(id),
  )!.d;
}

describe("world base path and motion parity", () => {
  it("syncs a default animated layer's direct point edit into its initial keyframe with one Undo", () => {
    const layer = selectedDefault();
    const store = useEditorStore.getState();
    const previous = tracks(layer.id)[0].fromValue;
    const otherOwner = store.frames[1].animation;
    store.selectPoint({
      layerId: layer.id,
      side: "from",
      subPathIndex: 0,
      commandIndex: 0,
      pointIndex: 0,
    });
    store.updateSelectedPoint({ x: 6.25, y: 4.5 });
    const after = useEditorStore.getState();
    const authored = pathToString(after.layers[0].from);
    expect(tracks(layer.id)[0].fromValue).toBe(authored);
    expect(preview(layer.id)).toBe(authored);
    expect(after.frames[1].animation).toBe(otherOwner);
    expect(after.history).toHaveLength(1);
    store.undo();
    expect(tracks(layer.id)[0].fromValue).toBe(previous);
    expect(preview(layer.id)).toBe(pathToString(parsePath(String(previous))));
    store.redo();
    expect(preview(layer.id)).toBe(authored);
  });

  it("keeps raw base geometry, evaluated time zero, AVD endpoints and a saved/reloaded project in agreement", () => {
    const layer = selectedDefault();
    const store = useEditorStore.getState();
    const from = structuredClone(layer.from);
    from.subPaths[0].commands[0].points[0] = { x: 6.25, y: 4.5 };
    store.updateSelectedLayer({ from, pathData: from });
    const d = pathToString(from);
    expect(preview(layer.id)).toBe(d);
    const android = compileLiveAndroidArtboard();
    expect(android.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
    expect(
      android.files.some(
        (file) =>
          file.path.startsWith("res/animator/") &&
          file.content.includes(`android:valueFrom="${d}"`),
      ),
    ).toBe(true);
    expect(android.files[0].content).toContain(`android:pathData="${d}"`);
    const saved = serializeLiveProject();
    store.loadDocument(legacySnapshotFromDocumentV2(saved.documentV2));
    expect(tracks(layer.id)[0].fromValue).toBe(d);
    expect(preview(layer.id)).toBe(d);
    expect(
      pathToString(
        useEditorStore.getState().layers.find((item) => String(item.id) === String(layer.id))!.from,
      ),
    ).toBe(d);
  });

  it("updates only outer keyframes across several segments even when an intermediate segment is selected", () => {
    const layer = selectedDefault();
    const store = useEditorStore.getState();
    store.insertTimelineKeyframe(tracks(layer.id)[0].id, 500);
    const original = tracks(layer.id);
    const from = structuredClone(layer.from);
    from.subPaths[0].commands[0].points[0].x = 6.25;
    const to = structuredClone(layer.to!);
    to.subPaths[0].commands[0].points[0].y = 7.25;
    store.updateSelectedLayer({ from, pathData: from, to });
    const current = tracks(layer.id);
    expect(current[0].fromValue).toBe(pathToString(from));
    expect(current[0].toValue).toBe(original[0].toValue);
    expect(current[1].fromValue).toBe(original[1].fromValue);
    expect(current[1].toValue).toBe(pathToString(to));
    expect(preview(layer.id, 1)).toBe(pathToString(to));
  });

  it("accepts pathData-only edits and explicit reauthoring of unchanged base geometry into a stale track", () => {
    const layer = selectedDefault();
    const store = useEditorStore.getState();
    const pathData = structuredClone(layer.from);
    pathData.subPaths[0].commands[0].points[0].x = 6.25;
    store.updateSelectedLayer({ pathData });
    expect(preview(layer.id)).toBe(pathToString(pathData));
    store.updateSelectedLayer({
      from: structuredClone(layer.from),
      pathData: structuredClone(layer.from),
    });
    expect(preview(layer.id)).toBe(pathToString(layer.from));
  });

  it("leaves explicit overrides intact for transform edits and complete graph/animation replacement", () => {
    const layer = selectedDefault();
    const store = useEditorStore.getState();
    const original = useEditorStore.getState().animation.blocks;
    store.updateSelectedLayer({ translateX: 12.25, rotation: 35 });
    expect(useEditorStore.getState().animation.blocks).toBe(original);
    const changed = {
      ...useEditorStore.getState().layers[0],
      from: parsePath("M0 0 L12 7 L0 7 Z"),
    };
    useEditorStore.setState({
      layers: [changed, ...store.layers.slice(1)],
      animation: useEditorStore.getState().animation,
    });
    expect(useEditorStore.getState().animation.blocks).toBe(original);
    useEditorStore.setState({
      layers: [changed, ...store.layers.slice(1)],
      documentV2: useEditorStore.getState().documentV2,
    });
    expect(useEditorStore.getState().animation.blocks).toBe(original);
    expect(tracks(layer.id)[0].fromValue).not.toBe(pathToString(changed.from));
  });

  it("uses deterministic evaluator ordering for ties and lets staged commands name only the authored side", () => {
    const layer = selectedDefault();
    const block: TimelineBlock = {
      ...tracks(layer.id)[0],
      id: "later",
      startTime: 0,
      endTime: 900,
      fromValue: "M0 0 L1 1",
      toValue: "M1 1 L2 2",
    };
    const shorter = { ...block, id: "first", endTime: 500 };
    const blocks = [block, shorter];
    const authored = syncLayerPathEndpoints(layer, layer, blocks, undefined, "from");
    expect(authored[0]).toBe(block);
    expect(authored[1].fromValue).toBe(pathToString(layer.from));
    expect(authored[1].toValue).toBe(shorter.toValue);
    const authoredTo = syncLayerPathEndpoints(layer, layer, blocks, undefined, "to");
    expect(authoredTo[0].toValue).toBe(pathToString(layer.to!));
    expect(authoredTo[0].fromValue).toBe(block.fromValue);
    expect(authoredTo[1]).toBe(shorter);
  });
});
