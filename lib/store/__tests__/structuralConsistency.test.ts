import { beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "../editorStore";
import { createPathLayer } from "../defaultWorkspace";
import { layerTransformToMatrix, multiplyAffine } from "../../pathshift/scene/layerTransform";
import type { Layer, TimelineBlock } from "../../pathshift/types";
const store = () => useEditorStore.getState();
const layer = (id: string, patch: Partial<Layer> = {}) =>
  createPathLayer({ id, name: id, from: { subPaths: [] }, visible: true, locked: false, ...patch });
const track = (id: string): TimelineBlock => ({
  id: `track-${id}`,
  layerId: id,
  propertyName: "translateX",
  startTime: 0,
  endTime: 1000,
  fromValue: 10,
  toValue: 20,
  interpolator: "linear",
});
function setup(layers: Layer[], selected: string[], blocks: TimelineBlock[] = []) {
  useEditorStore.setState({
    layers,
    selectedLayerId: selected[0]!,
    selectedLayerIds: selected,
    selectedLayerRefs: selected.map((layerId) => ({ ownerId: store().selectedFrameId, layerId })),
    animation: { ...store().animation, blocks },
    hasCanvasSelection: true,
    selectionKind: "layer",
  });
}
beforeEach(() => store().resetProject());
describe("structural consistency", () => {
  it("ungroups static translation without moving the child and undoes once", () => {
    setup(
      [
        layer("g", { type: "group", translateX: 100 }),
        layer("c", { parentId: "g", translateX: 10 }),
      ],
      ["g"],
    );
    store().ungroupSelectedLayer();
    expect(store().layers.find((l) => l.id === "c")?.translateX).toBe(110);
    store().undo();
    expect(store().layers.find((l) => l.id === "c")?.parentId).toBe("g");
  });
  it("composes rotation, scale, and pivots when ungrouping", () => {
    const g = layer("g", {
      type: "group",
      rotation: 30,
      scaleX: 2,
      scaleY: 2,
      pivotX: 8,
      translateY: 7,
    });
    const c = layer("c", { parentId: "g", rotation: 12, pivotY: 3, translateX: 10 });
    const before = multiplyAffine(layerTransformToMatrix(g), layerTransformToMatrix(c));
    setup([g, c], ["g"]);
    store().ungroupSelectedLayer();
    const after = layerTransformToMatrix(store().layers.find((l) => l.id === "c")!);
    for (const key of Object.keys(before) as (keyof typeof before)[])
      expect(after[key]).toBeCloseTo(before[key], 8);
  });
  it("refuses ungrouping animated groups without dropping motion", () => {
    setup([layer("g", { type: "group" }), layer("c", { parentId: "g" })], ["g"], [track("g")]);
    const before = store().layers;
    store().ungroupSelectedLayer();
    expect(store().layers).toEqual(before);
    expect(store().animation.blocks).toHaveLength(1);
  });
  it("refuses deletion of a group with a locked descendant atomically", () => {
    setup(
      [layer("g", { type: "group" }), layer("c", { parentId: "g", locked: true })],
      ["g"],
      [track("c")],
    );
    const before = store().layers;
    store().deleteSelectedLayers();
    expect(store().layers).toEqual(before);
    expect(store().animation.blocks).toHaveLength(1);
  });
  it("shares lock validation with cut and single-layer delete and retains the clipboard", () => {
    setup(
      [layer("g", { type: "group" }), layer("c", { parentId: "g", locked: true })],
      ["g"],
      [track("c")],
    );
    store().copyLayers(["c"]);
    const before = store().document;
    const clipboard = store().clipboard;
    const history = store().history.length;
    store().cutLayers(["g"]);
    store().deleteLayer("g");
    expect(store().document).toBe(before);
    expect(store().clipboard).toEqual(clipboard);
    expect(store().history).toHaveLength(history);
  });
  it("refuses noncontiguous grouping, masks, shared opacity, and skew without creating undo steps", () => {
    setup([layer("a"), layer("b"), layer("c")], ["a", "c"]);
    const before = store().document;
    const history = store().history.length;
    store().groupSelectedLayers();
    expect(store().document).toBe(before);
    expect(store().history).toHaveLength(history);
    for (const [groupPatch, childPatch] of [
      [{ alpha: 0.5 }, {}],
      [{}, { type: "clipPath" }],
      [{ scaleX: 2 }, { rotation: 45 }],
    ] as [Partial<Layer>, Partial<Layer>][]) {
      setup(
        [
          layer("g", { type: "group", ...groupPatch }),
          layer("c", { parentId: "g", ...childPatch }),
        ],
        ["g"],
      );
      const before = store().document;
      store().ungroupSelectedLayer();
      expect(store().document).toBe(before);
    }
  });
  it("duplicates a child in its parent, offsets motion, preserves hidden state, and deduplicates repeated refs", () => {
    setup(
      [
        layer("p", { type: "group", translateX: 100 }),
        layer("c", { parentId: "p", translateX: 10 }),
      ],
      ["c"],
      [track("c")],
    );
    useEditorStore.setState({
      hiddenLayerIds: ["c"],
      selectedLayerRefs: [...store().selectedLayerRefs, ...store().selectedLayerRefs],
    });
    store().duplicateSelectedLayersOffset(2, 3);
    const clone = store().layers.find(
      (layer) => String(layer.id) !== "c" && layer.type === "path",
    )!;
    expect(store().layers).toHaveLength(3);
    expect(clone.parentId).toBe("p");
    expect(clone.translateX).toBe(12);
    expect(clone.visible).toBe(false);
    expect(store().animation.blocks.find((block) => block.layerId === clone.id)).toMatchObject({
      fromValue: 12,
      toValue: 22,
    });
    store().undo();
    expect(store().layers).toHaveLength(2);
  });
  it("groups siblings within their existing transformed parent", () => {
    setup(
      [
        layer("p", { type: "group", translateX: 100 }),
        layer("a", { parentId: "p" }),
        layer("b", { parentId: "p" }),
      ],
      ["a", "b"],
    );
    store().groupSelectedLayers();
    const group = store().layers.find((l) => l.id === store().selectedLayerId)!;
    expect(group.parentId).toBe("p");
  });
  it("clears the source motion selection when duplicating so Delete affects the clone", () => {
    setup([layer("a")], ["a"], [track("a")]);
    useEditorStore.setState({ selectedBlockIds: ["track-a"] });
    store().duplicateSelectedLayersOffset(2, 2);
    expect(store().selectedBlockIds).toEqual([]);
    store().deleteSelectedLayers();
    expect(store().layers.map((layer) => layer.id)).toEqual(["a"]);
    expect(store().animation.blocks).toEqual([track("a")]);
    store().undo();
    expect(store().layers).toHaveLength(2);
    store().undo();
    expect(store().layers).toHaveLength(1);
  });
  it("normalizes group-plus-child duplicate selection, preserves the clipboard and insertion order", () => {
    setup(
      [layer("a"), layer("g", { type: "group" }), layer("c", { parentId: "g" }), layer("z")],
      ["a"],
      [track("c")],
    );
    store().copyLayers(["a"]);
    const clipboard = store().clipboard;
    setup(store().layers, ["g", "c"], store().animation.blocks);
    store().duplicateSelectedLayersOffset(0, 0);
    expect(store().clipboard).toEqual(clipboard);
    expect(store().layers.filter((l) => l.name === "c")).toHaveLength(2);
    expect(store().selectedLayerIds).toHaveLength(1);
    expect(store().layers.at(-1)?.id).toBe("z");
    expect(store().animation.blocks).toHaveLength(2);
    store().undo();
    expect(store().layers).toHaveLength(4);
    store().pasteLayers();
    expect(store().layers.at(-1)?.name).toContain("a");
  });
});
