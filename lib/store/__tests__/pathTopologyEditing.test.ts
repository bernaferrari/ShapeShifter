import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "../editorStore";
import { parsePath, androidPathMorphSignature } from "../../shapeshifter/pathUtils";
let baseline: ReturnType<typeof useEditorStore.getState>;
beforeEach(() => {
  baseline = useEditorStore.getState();
  useEditorStore.getState().resetProject();
});
afterEach(() => useEditorStore.setState(baseline, true));
function setup() {
  const state = useEditorStore.getState();
  const layer = state.layers[0];
  const poses = [
    "M0 0 L10 0 L10 10 Z",
    "M0 0 L15 0 L15 15 Z",
    "M0 0 L20 0 L20 20 Z",
    "M0 0 L25 0 L25 25 Z",
  ];
  state.updateSelectedLayer({
    from: parsePath(poses[0]),
    to: parsePath(poses[3]),
    pathData: parsePath(poses[0]),
  });
  useEditorStore.setState({
    animation: {
      ...state.animation,
      blocks: [0, 1, 2].map((i) => ({
        id: `pose-${i}`,
        layerId: layer.id,
        propertyName: "pathData",
        type: "path" as const,
        startTime: i * 300,
        endTime: (i + 1) * 300,
        fromValue: poses[i],
        toValue: poses[i + 1],
      })),
    },
    history: [],
    future: [],
    progress: 0,
    isActionMode: false,
    selectedBlockIds: [],
    toolMode: "direct",
  });
  useEditorStore.getState().selectPoint({
    layerId: layer.id,
    side: "from",
    subPathIndex: 0,
    commandIndex: 1,
    pointIndex: 0,
  });
  return layer.id;
}
function signatures() {
  return useEditorStore
    .getState()
    .animation.blocks.flatMap((block) => [block.fromValue, block.toValue])
    .map((value) => androidPathMorphSignature(parsePath(String(value))));
}
describe("one topology across authored path poses", () => {
  it("splits corresponding edges across all keyframes in one undo step", () => {
    setup();
    const before = useEditorStore.getState().animation;
    useEditorStore.getState().splitSelectedCommand();
    const expected = androidPathMorphSignature(parsePath("M0 0 L5 0 L10 0 L10 10 Z"));
    expect(signatures()).toEqual(Array(6).fill(expected));
    expect(useEditorStore.getState().history).toHaveLength(1);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().animation).toEqual(before);
  });
  it("keeps deleted-point indices aligned in every pose and clears selection", () => {
    setup();
    useEditorStore.getState().deleteSelectedPoint();
    const expected = androidPathMorphSignature(parsePath("M0 0 L10 10 Z"));
    expect(signatures()).toEqual(Array(6).fill(expected));
    expect(useEditorStore.getState().selectedPoints).toEqual([]);
  });
});

describe("conversion, remapping, and recovery of path poses", () => {
  it("converts all poses, remaps the selected anchor, and keeps strings in path tracks", () => {
    setup();
    expect(useEditorStore.getState().changeSelectedPathCommand(0, 1, "C")).toBe(true);
    expect(useEditorStore.getState().selection?.pointIndex).toBe(2);
    expect(new Set(signatures()).size).toBe(1);
    expect(useEditorStore.getState().history).toHaveLength(1);
    expect(useEditorStore.getState().changeSelectedPathCommand(0, 1, "L")).toBe(true);
    expect(useEditorStore.getState().selection?.pointIndex).toBe(0);
    expect(useEditorStore.getState().editSelectedPathPoint(0, 1, 0, { x: 17, y: 3 })).toBe(true);
    expect(
      useEditorStore
        .getState()
        .animation.blocks.every(
          (block) => typeof block.fromValue === "string" && typeof block.toValue === "string",
        ),
    ).toBe(true);
  });
  it("matches a larger intermediate pose as well as the outer pair, then adds more anchors", () => {
    setup();
    useEditorStore.setState((state) => ({
      animation: {
        ...state.animation,
        blocks: state.animation.blocks.map((block, i) =>
          i === 1
            ? { ...block, toValue: "M0 0 L20 0 L20 20 L0 20 Z" }
            : i === 2
              ? { ...block, fromValue: "M0 0 L20 0 L20 20 L0 20 Z" }
              : block,
        ),
      },
    }));
    const before = useEditorStore.getState().animation;
    expect(useEditorStore.getState().previewPrepareForMorph()).toBe(true);
    expect(useEditorStore.getState().commitMorphPreview()).toBe(true);
    expect(new Set(signatures()).size).toBe(1);
    expect(useEditorStore.getState().history).toHaveLength(1);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().animation).toEqual(before);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().addSelectedPathPoint(0, 1)).toBe(true);
    expect(new Set(signatures()).size).toBe(1);
  });
  it("discards a mapping preview after a newer point edit", () => {
    setup();
    useEditorStore.getState().previewPrepareForMorph();
    useEditorStore.getState().editSelectedPathPoint(0, 1, 0, { x: 13, y: 2 });
    const before = useEditorStore.getState().document;
    expect(useEditorStore.getState().commitMorphPreview()).toBe(false);
    expect(useEditorStore.getState().document).toBe(before);
  });
  it("refuses stale indices, invalid coordinates, and inherited locks without history", () => {
    const id = setup();
    expect(useEditorStore.getState().addSelectedPathPoint(99, 99)).toBe(false);
    expect(useEditorStore.getState().editSelectedPathPoint(0, 1, 0, { x: Infinity, y: 0 })).toBe(
      false,
    );
    useEditorStore.setState((state) => ({
      layers: [
        { ...state.layers[0], parentId: "locked" },
        { ...state.layers[0], id: "locked", parentId: null, type: "group", locked: true },
      ],
    }));
    expect(useEditorStore.getState().selectedLayerId).toBe(id);
    expect(useEditorStore.getState().changeSelectedPathCommand(0, 1, "C")).toBe(false);
    expect(useEditorStore.getState().history).toEqual([]);
  });
  it("deletes a selected handle without deleting its anchor or breaking pose compatibility", () => {
    setup();
    useEditorStore.getState().changeSelectedPathCommand(0, 1, "C");
    const state = useEditorStore.getState();
    state.selectPoint({ ...state.selection!, pointIndex: 0 });
    state.deleteSelectedPoint();
    const path = useEditorStore.getState().layers[0].from;
    expect(path.subPaths[0].commands[1].points).toHaveLength(3);
    expect(path.subPaths[0].commands[1].points[0]).toEqual(path.subPaths[0].commands[0].points[0]);
    expect(new Set(signatures()).size).toBe(1);
  });
  it("extracts an independent contour with its parent, transforms and every animation track", () => {
    setup();
    const state = useEditorStore.getState();
    const path = "M0 0 L10 0 L10 10 Z M30 0 L40 0 L40 10 Z";
    state.updateSelectedLayer({
      from: parsePath(path),
      to: parsePath(path),
      pathData: parsePath(path),
      translateX: 12,
    });
    useEditorStore.setState((current) => ({
      history: [],
      future: [],
      animation: {
        ...current.animation,
        blocks: [
          { ...current.animation.blocks[0], fromValue: path, toValue: path },
          {
            ...current.animation.blocks[0],
            id: "move",
            type: "number",
            propertyName: "translateX",
            fromValue: 12,
            toValue: 20,
          },
        ],
      },
    }));
    const before = useEditorStore.getState().document;
    useEditorStore.getState().extractSelectedSubPathToNewLayer();
    const current = useEditorStore.getState();
    const extracted = current.layers.find((layer) => layer.id === current.selectedLayerId)!;
    expect(extracted.translateX).toBe(12);
    expect(extracted.from.subPaths).toHaveLength(1);
    expect(current.animation.blocks.filter((block) => block.layerId === extracted.id)).toHaveLength(
      2,
    );
    expect(current.history).toHaveLength(1);
    current.undo();
    expect(useEditorStore.getState().document).toEqual(before);
  });
});

describe("bending keeps every morph pose compatible", () => {
  it.each(["bend", "flex"])(
    "promotes corresponding lines before a %s, with one undo step",
    (tool) => {
      const id = setup();
      const before = useEditorStore.getState().document;
      const segment = { layerId: id, side: "from" as const, subPathIndex: 0, commandIndex: 1 };
      if (tool === "bend")
        useEditorStore.getState().bendSelectedLayerSegment(segment, { x: 5, y: 3 });
      else useEditorStore.getState().flexSelectedLayerSegment(segment, { x: 0, y: 3 });
      if (tool === "bend") {
        const points = useEditorStore.getState().layers[0].from.subPaths[0].commands[1].points;
        expect((3 / 8) * (points[0].y + points[1].y) + points[2].y / 8).toBeCloseTo(3);
      }
      expect(new Set(signatures()).size).toBe(1);
      expect(useEditorStore.getState().history).toHaveLength(1);
      useEditorStore.getState().undo();
      expect(useEditorStore.getState().document).toEqual(before);
    },
  );
});
