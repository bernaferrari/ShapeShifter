import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorStore } from "../editorStore";
import { parsePath } from "../../pathshift/pathUtils";
import { primitivePath } from "../../pathshift/primitiveShapes";
import { evaluateAndroidScene } from "../../pathshift/scene/evaluate";
import { inverseAffine, transformPointWithMatrix } from "../../pathshift/scene/layerTransform";
import { isPointInPath, distanceToPath } from "../../pathshift/path/pathGeometry";
import * as curveClient from "../../pathshift/path/curveBooleanClient";
import type { Layer } from "../../pathshift/types";
const path = (id: string, d: string, patch: Partial<Layer> = {}): Layer => ({
  id,
  name: id,
  type: "path",
  from: parsePath(d),
  visible: true,
  locked: false,
  fillColor: "#f00",
  ...patch,
});
function select(
  layers: Layer[],
  ids = layers.filter((item) => item.type === "path").map((item) => item.id),
) {
  const state = useEditorStore.getState();
  useEditorStore.setState({
    layers,
    animation: { ...state.animation, blocks: [] },
    selectedLayerRefs: ids.map((layerId) => ({ ownerId: state.selectedFrameId, layerId })),
    selectedLayerIds: ids,
    selectedLayerId: ids.at(-1)!,
    hasCanvasSelection: true,
    selectionKind: "layer",
    hiddenLayerIds: [],
    history: [],
    future: [],
    canUndo: false,
    canRedo: false,
    historyGestureActive: false,
    dragState: null,
    isActionMode: false,
    isPlaying: false,
  });
}
beforeEach(() => {
  useEditorStore.getState().resetProject();
  select([path("back", "M0 0H20V20H0Z"), path("front", "M10 0H30V20H10Z", { fillColor: "#00f" })]);
});
const current = () => useEditorStore.getState();
describe("curve Boolean authoring command", () => {
  it("refuses active trimmed paths instead of combining hidden geometry and trimming it twice", async () => {
    const layers = current().layers;
    select([{ ...layers[0]!, trimPathEnd: 0.5 }, layers[1]!]);
    const before = structuredClone(current().layers);
    const result = await current().booleanCombine("union");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/trim/);
    expect(current().layers).toEqual(before);
    expect(current().history).toHaveLength(0);
  });
  it("subtracts front geometry from the back path regardless of selection order and creates one Undo", async () => {
    select(current().layers, ["front", "back"]);
    const before = structuredClone(current().layers);
    expect(await current().booleanCombine("subtract")).toEqual({ ok: true, empty: false });
    const result = current().layers[0]!;
    expect(current().layers).toHaveLength(1);
    expect(result).toMatchObject({
      id: "back",
      fillColor: "#f00",
      fillType: "nonZero",
      to: undefined,
    });
    expect(isPointInPath({ x: 5, y: 10 }, result.from)).toBe(true);
    expect(isPointInPath({ x: 15, y: 10 }, result.from)).toBe(false);
    expect(isPointInPath({ x: 25, y: 10 }, result.from)).toBe(false);
    expect(current().selectedLayerRefs).toEqual([
      { ownerId: current().selectedFrameId, layerId: "back" },
    ]);
    expect(current().history).toHaveLength(1);
    current().undo();
    expect(current().layers).toMatchObject(before);
    current().redo();
    expect(current().layers).toHaveLength(1);
  });
  it("uses edited pathData and unions every explicit operand", async () => {
    const a = path("a", "M0 0H5V5H0Z", { pathData: parsePath("M0 0H10V10H0Z") });
    select([a, path("b", "M5 0H15V10H5Z"), path("c", "M12 0H20V10H12Z")]);
    expect((await current().booleanCombine("union")).ok).toBe(true);
    expect(current().layers).toHaveLength(1);
    expect(isPointInPath({ x: 2, y: 8 }, current().layers[0]!.from)).toBe(true);
    expect(isPointInPath({ x: 18, y: 8 }, current().layers[0]!.from)).toBe(true);
  });
  it("preserves curves, holes, and complete static transforms across different parent groups", async () => {
    const a = path("a", primitivePath("ellipse", { x: -10, y: -7, w: 20, h: 14 }), {
      parentId: "ga",
      rotation: -10,
      pivotX: 2,
      scaleX: -1,
    });
    const b = path("b", primitivePath("ellipse", { x: -9, y: -6, w: 18, h: 12 }), {
      parentId: "gb",
      translateX: 1,
      pivotY: -1,
    });
    const ga = path("ga", "", {
      type: "group",
      translateX: 20,
      translateY: 20,
      rotation: 25,
      scaleX: 1.3,
      scaleY: 0.7,
      pivotX: 1,
    });
    const gb = path("gb", "", {
      type: "group",
      translateX: 30,
      translateY: 22,
      rotation: -20,
      scaleX: 0.7,
      scaleY: 1.4,
    });
    select([ga, a, gb, b], [a.id, b.id]);
    const before = evaluateAndroidScene(current().layers, current().animation, 0, false);
    expect((await current().booleanCombine("union")).ok).toBe(true);
    const after = evaluateAndroidScene(current().layers, current().animation, 0, false);
    const node = after.nodesById.get("a")!;
    expect(node.worldMatrix).toEqual(before.nodesById.get("a")!.worldMatrix);
    expect(
      node
        .path!.subPaths.flatMap((contour) => contour.commands)
        .some((command) => command.type === "C"),
    ).toBe(true);
    let filled = 0;
    for (let x = 0; x <= 55; x += 3)
      for (let y = 0; y <= 45; y += 3) {
        const world = { x, y };
        const sources = [before.nodesById.get("a")!, before.nodesById.get("b")!];
        const local = sources.map((source) =>
          transformPointWithMatrix(world, inverseAffine(source.worldMatrix)!),
        );
        if (sources.some((source, index) => distanceToPath(local[index]!, source.path!) < 0.5))
          continue;
        const expected = sources.some((source, index) =>
          isPointInPath(local[index]!, source.path!),
        );
        const actual = isPointInPath(
          transformPointWithMatrix(world, inverseAffine(node.worldMatrix)!),
          node.path!,
        );
        expect(actual, `world (${x},${y})`).toBe(expected);
        if (actual) filled++;
      }
    expect(filled).toBeGreaterThan(10);
  });
  it.each([
    "morph",
    "motion",
    "ancestor motion",
    "mask",
    "lock",
    "open",
    "stroke only",
    "empty",
    "zero scale",
    "zero area",
  ])("refuses %s inputs without consuming paths or history", async (kind) => {
    let layers = current().layers;
    if (kind === "morph") layers = [{ ...layers[0]!, to: parsePath("M0 0H30V20H0Z") }, layers[1]!];
    if (kind === "lock") layers = [{ ...layers[0]!, locked: true }, layers[1]!];
    if (kind === "open") layers = [{ ...layers[0]!, from: parsePath("M0 0L20 20") }, layers[1]!];
    if (kind === "empty") layers = [{ ...layers[0]!, from: { subPaths: [] } }, layers[1]!];
    if (kind === "zero scale") layers = [layers[0]!, { ...layers[1]!, scaleX: 0 }];
    if (kind === "zero area")
      layers = [{ ...layers[0]!, from: parsePath("M0 0L10 10L20 20Z") }, layers[1]!];
    if (kind === "stroke only")
      layers = [
        { ...layers[0]!, fillColor: "none", strokeColor: "red", strokeWidth: 2 },
        layers[1]!,
      ];
    if (kind === "mask") layers = [path("clip", "M0 0H10V20H0Z", { type: "clipPath" }), ...layers];
    if (kind === "ancestor motion")
      layers = [
        path("group", "", { type: "group" }),
        ...layers.map((layer) => ({ ...layer, parentId: "group" })),
      ];
    select(layers, ["back", "front"]);
    if (kind === "motion" || kind === "ancestor motion")
      useEditorStore.setState({
        animation: {
          ...current().animation,
          blocks: [
            {
              id: "motion",
              layerId: kind === "motion" ? "front" : "group",
              propertyName: "rotation",
              fromValue: 0,
              toValue: 90,
              startTime: 0,
              endTime: 1000,
            },
          ],
        },
      });
    const before = JSON.stringify({ layers: current().layers, animation: current().animation });
    const result = await current().booleanCombine("union");
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(JSON.stringify({ layers: current().layers, animation: current().animation })).toBe(
      before,
    );
    expect(current().history).toHaveLength(0);
  });
  it("reports an empty intersection explicitly, retaining an undoable empty result", async () => {
    select([path("a", "M0 0H5V5H0Z"), path("b", "M20 0H25V5H20Z")]);
    expect(await current().booleanCombine("intersect")).toEqual({ ok: true, empty: true });
    expect(current().layers).toHaveLength(1);
    expect(current().layers[0]!.from.subPaths).toHaveLength(0);
    expect(current().history).toHaveLength(1);
    current().undo();
    expect(current().layers).toHaveLength(2);
  });
  it.each(["document", "selection", "history"])(
    "discards an async result when %s changes during import or worker tracing",
    async (change) => {
      let finish!: (path: ReturnType<typeof parsePath>) => void;
      const spy = vi.spyOn(curveClient, "combineCurveAreasAsync").mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      try {
        const task = current().booleanCombine("union");
        await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
        if (change === "selection") current().selectLayer("front");
        else {
          current().renameOwnedLayer(current().selectedFrameId, "back", "Changed while computing");
          if (change === "history") current().undo();
        }
        finish(parsePath("M0 0H30V20H0Z"));
        expect(await task).toMatchObject({ ok: false, reason: expect.stringContaining("changed") });
        expect(current().layers).toHaveLength(2);
        expect(current().layers[0]!.name).toBe(
          change === "document" ? "Changed while computing" : "back",
        );
        expect(current().history).toHaveLength(change === "document" ? 1 : 0);
      } finally {
        spy.mockRestore();
      }
    },
  );
});
