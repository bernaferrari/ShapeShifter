import { describe, expect, it } from "vitest";
import { createLayerTreeModel, placeLayerSubtree } from "../scene/layerHierarchy";
import type { Layer } from "../types";

function layer(id: string, parentId?: string, children?: Layer[]): Layer {
  return {
    id,
    parentId,
    children,
    name: id,
    type: children ? "group" : "path",
    visible: true,
    locked: false,
    from: { subPaths: [] },
    pathData: { subPaths: [] },
  };
}

describe("layer hierarchy", () => {
  it("normalizes flat parent links and embedded children into one tree", () => {
    const embedded = layer("embedded");
    const layers = [layer("group", undefined, [embedded]), layer("flat", "group"), layer("root")];
    const tree = createLayerTreeModel(layers);

    expect(tree.roots.map((item) => item.id)).toEqual(["group", "root"]);
    expect(tree.childrenOf(layers[0]).map((item) => item.id)).toEqual(["embedded", "flat"]);
    expect(tree.ancestorsOf("embedded").map((item) => item.id)).toEqual(["group"]);
  });

  it("keeps orphaned and cyclic imported layers visible", () => {
    const layers = [layer("orphan", "missing"), layer("a", "b"), layer("b", "a")];
    const tree = createLayerTreeModel(layers);

    expect(tree.roots.map((item) => item.id)).toEqual(["orphan", "a"]);
    expect(tree.childrenOf(layers[1]).map((item) => item.id)).toEqual(["b"]);
  });

  it("moves a complete subtree and rejects drops into its descendants", () => {
    const layers = [layer("group"), layer("child", "group"), layer("sibling")];

    expect(placeLayerSubtree(layers, "group", { parentId: "child" })).toBeNull();
    expect(
      placeLayerSubtree(layers, "group", { parentId: null, afterId: "sibling" })?.map(
        (item) => item.id,
      ),
    ).toEqual(["sibling", "group", "child"]);
  });
});
