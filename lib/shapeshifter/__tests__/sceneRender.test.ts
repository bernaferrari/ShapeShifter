import { describe, expect, it } from "vitest";
import { parsePath } from "../pathUtils";
import { resolveWorldLayerDraws } from "../scene/render";
import { evaluateAndroidScene } from "../scene/evaluate";
import type { AnimationState, Layer } from "../types";

const path = parsePath("M0 0 L10 0 L10 10 Z");
const visible: Layer = {
  id: "shape",
  name: "Shape",
  type: "path",
  from: path,
  to: path,
  fillColor: "#123456",
  fillAlpha: 0.8,
  translateX: 2,
  translateY: 3,
} as Layer;
const animation: AnimationState = {
  id: "animation",
  name: "Animation",
  duration: 1000,
  blocks: [
    {
      id: "translate-x",
      layerId: "shape",
      propertyName: "translateX",
      fromValue: 2,
      toValue: 12,
      startTime: 0,
      endTime: 1000,
      type: "number",
    },
  ],
};

describe("world scene rendering", () => {
  it("propagates ordered root masks without leaking a group's local masks into later roots", () => {
    const clip = (id: string, parentId?: string): Layer => ({
      ...visible,
      id,
      type: "clipPath",
      parentId,
    });
    const group: Layer = { ...visible, id: "group", type: "group", from: { subPaths: [] } };
    const layers = [
      { ...visible, id: "before" },
      clip("root-clip"),
      group,
      clip("local-clip", "group"),
      { ...visible, id: "child", parentId: "group" },
      { ...visible, id: "after-group" },
      clip("second-root-clip"),
      { ...visible, id: "after-both" },
    ];
    const scene = evaluateAndroidScene(layers, animation, 0, false);
    const clipsFor = (id: string) => scene.nodesById.get(id)!.clipNodeIds;
    expect(clipsFor("before")).toEqual([]);
    expect(clipsFor("root-clip")).toEqual([]);
    expect(clipsFor("group")).toEqual(["root-clip"]);
    expect(clipsFor("local-clip")).toEqual(["root-clip"]);
    expect(clipsFor("child")).toEqual(["root-clip", "local-clip"]);
    expect(clipsFor("after-group")).toEqual(["root-clip"]);
    expect(clipsFor("second-root-clip")).toEqual(["root-clip"]);
    expect(clipsFor("after-both")).toEqual(["root-clip", "second-root-clip"]);
    expect(
      resolveWorldLayerDraws(layers, animation, 0, false).find((draw) => draw.id === "after-both")!
        .clipNodeIds,
    ).toEqual(["root-clip", "second-root-clip"]);
  });

  it("does not apply hidden root or group-local masks to visible artwork", () => {
    const layers: Layer[] = [
      { ...visible, id: "hidden-root-clip", type: "clipPath", visible: false },
      { ...visible, id: "group", type: "group", from: { subPaths: [] } },
      { ...visible, id: "hidden-local-clip", type: "clipPath", parentId: "group", visible: false },
      { ...visible, id: "child", parentId: "group" },
      { ...visible, id: "after" },
    ];
    const scene = evaluateAndroidScene(layers, animation, 0, false);
    expect(scene.nodesById.get("child")!.clipNodeIds).toEqual([]);
    expect(scene.nodesById.get("after")!.clipNodeIds).toEqual([]);
    expect(
      resolveWorldLayerDraws(layers, animation, 0, false).some((draw) => draw.isClipPath),
    ).toBe(false);
  });

  it("retains authored geometry identities across transform-only playback and refreshes edited geometry", () => {
    const shape = { ...visible, to: undefined };
    const layers = [shape];
    const early = evaluateAndroidScene(layers, animation, 0.25).nodes[0]!;
    const later = evaluateAndroidScene(layers, animation, 0.75).nodes[0]!;
    expect(early.path).toBe(path);
    expect(later.path).toBe(path);
    expect(later.worldMatrix.e).not.toBe(early.worldMatrix.e);
    const edited = parsePath("M0 0 L20 0 Z");
    const next = evaluateAndroidScene([{ ...shape, pathData: edited }], animation, 0.75).nodes[0]!;
    expect(next.path).toBe(edited);
    expect(next.d).toContain("20 0");
  });
  it("resolves static owner layers without UI-specific state", () => {
    expect(resolveWorldLayerDraws([visible], animation, 0, false)[0]).toMatchObject({
      id: "shape",
      fill: "#123456",
      fillOpacity: 0.8,
      translateX: 2,
      translateY: 3,
      scaleX: 1,
      scaleY: 1,
    });
  });

  it("evaluates transforms at the playhead and excludes hidden layers", () => {
    const draws = resolveWorldLayerDraws(
      [visible, { ...visible, id: "hidden", visible: false }],
      animation,
      0.5,
      true,
    );
    expect(draws).toHaveLength(1);
    expect(draws[0].translateX).toBeCloseTo(7);
    expect(draws[0]).toMatchObject({ scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 });
  });
});
