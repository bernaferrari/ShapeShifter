import { describe, expect, it } from "vitest";
import {
  canMoveLayerRootsBetweenOwners,
  moveLayersBetweenOwners,
} from "../commands/moveLayersBetweenOwners";
import { parsePath } from "../../pathshift/pathUtils";
import { evaluateAndroidScene } from "../../pathshift/scene/evaluate";
import {
  multiplyAffine,
  translateAffine,
  transformPointWithMatrix,
} from "../../pathshift/scene/layerTransform";
import type { AnimationState, Layer } from "../../pathshift/types";
import type { CanvasFrame } from "../defaultWorkspace";
import { layerReparentIssue, reparentLayerPreservingAppearance } from "../commands/reparentLayer";
import { useEditorStore } from "../editorStore";

const layer = (id: string, patch: Partial<Layer> = {}): Layer => ({
  id,
  name: id,
  type: "path",
  from: parsePath("M0 0 H10 V10 H0 Z"),
  visible: true,
  locked: false,
  fillColor: "red",
  ...patch,
});

describe("same-owner hierarchy appearance", () => {
  it("keeps static ancestry, masks, opacity, and child motion when detaching onto the frame", () => {
    const group = layer("group", {
      type: "group",
      translateX: 8,
      rotation: 35,
      scaleX: 2,
      scaleY: 0.6,
      pivotX: 3,
      alpha: 0.4,
    });
    const clip = layer("clip", { type: "clipPath", parentId: group.id, translateY: 2 });
    const child = layer("child", { parentId: group.id, translateX: 3, alpha: 0.7 });
    const sibling = layer("sibling");
    const block = {
      id: "child-x",
      layerId: child.id,
      propertyName: "translateX",
      fromValue: 3,
      toValue: 10,
      startTime: 0,
      endTime: 1000,
    };
    const source = frame("source", [group, clip, child, sibling], [block]);
    const next = reparentLayerPreservingAppearance(source.layers, source.animation, [], child.id, {
      parentId: null,
      beforeId: sibling.id,
    })!;
    const after = { ...source, layers: next };
    expectSamePose(source, after, "child");
    const pose = worldPose(after, "child", 0.5);
    expect(pose.clips).toHaveLength(1);
    const clonedClip = worldPose(after, String(pose.clips[0]!), 0.5);
    const originalClip = worldPose(source, "clip", 0.5);
    expect(clonedClip.point.x).toBeCloseTo(originalClip.point.x, 10);
    expect(clonedClip.point.y).toBeCloseTo(originalClip.point.y, 10);
    expect(next.find((item) => item.id === child.id)!.translateX).toBe(3);
    expect(next.findIndex((item) => item.id === child.id)).toBeLessThan(
      next.findIndex((item) => item.id === sibling.id),
    );
  });
  it("moves into identity groups and keeps descendant locks and embedded geometry intact", () => {
    const child = layer("child", { locked: true, translateX: 3 });
    const group = layer("group", { type: "group", rotation: 25, children: [child] });
    const destination = layer("destination", { type: "group" });
    const source = frame("source", [group, destination]);
    const next = reparentLayerPreservingAppearance(source.layers, source.animation, [], group.id, {
      parentId: destination.id,
    })!;
    expectSamePose(source, { ...source, layers: next }, "child");
    expect(next.find((item) => item.id === child.id)).toMatchObject({
      locked: true,
      parentId: group.id,
    });
    expect(next.find((item) => item.id === group.id)!.parentId).toBe(destination.id);
  });
  it("allows sibling reorder under animated ancestry while refusing destructive detachment and transformed destinations", () => {
    const group = layer("group", { type: "group", rotation: 20 });
    const child = layer("child", { parentId: group.id });
    const sibling = layer("sibling", { parentId: group.id });
    const destination = layer("destination", { type: "group", rotation: 10 });
    const source = frame(
      "source",
      [group, child, sibling, destination],
      [
        {
          id: "group-r",
          layerId: group.id,
          propertyName: "rotation",
          fromValue: 20,
          toValue: 90,
          startTime: 0,
          endTime: 1000,
        },
      ],
    );
    const before = structuredClone(source);
    const reordered = reparentLayerPreservingAppearance(
      source.layers,
      source.animation,
      [],
      child.id,
      { parentId: group.id, afterId: sibling.id },
    )!;
    expect(reordered.map((item) => item.id)).toEqual(["group", "sibling", "child", "destination"]);
    expectSamePose(source, { ...source, layers: reordered }, "child");
    expect(
      layerReparentIssue(source.layers, source.animation, [], child.id, { parentId: null }),
    ).toContain("animated groups or masks");
    expect(
      reparentLayerPreservingAppearance(source.layers, source.animation, [], child.id, {
        parentId: null,
      }),
    ).toBeNull();
    expect(
      layerReparentIssue(source.layers, animation(), [], child.id, { parentId: destination.id }),
    ).toContain("destination group");
    expect(source).toEqual(before);
  });
  it("records one atomic undo when preserving a nested child's artwork in the live store", () => {
    const baseline = useEditorStore.getState();
    try {
      const group = layer("group", { type: "group", rotation: 30, translateX: 12 });
      const child = layer("child", { parentId: group.id, translateY: 3 });
      useEditorStore.setState({
        layers: [group, child],
        animation: animation(),
        history: [],
        future: [],
        canUndo: false,
        canRedo: false,
        historyGestureActive: false,
      });
      const state = useEditorStore.getState();
      expect(state.reparentOwnedLayer(state.selectedFrameId, child.id, { parentId: null })).toBe(
        true,
      );
      expect(useEditorStore.getState().history).toHaveLength(1);
      expectSamePose(
        frame("owner", [group, child]),
        frame("owner", useEditorStore.getState().layers),
        "child",
      );
      useEditorStore.getState().undo();
      expect(useEditorStore.getState().layers.map((item) => item.id)).toEqual(["group", "child"]);
      expect(useEditorStore.getState().layers.find((item) => item.id === child.id)!.parentId).toBe(
        group.id,
      );
    } finally {
      useEditorStore.setState(baseline, true);
    }
  });
});
const animation = (blocks: AnimationState["blocks"] = []): AnimationState => ({
  id: "motion",
  name: "Motion",
  duration: 1000,
  blocks,
});
const frame = (
  id: string,
  layers: Layer[],
  blocks: AnimationState["blocks"] = [],
  x = 0,
  y = 0,
): CanvasFrame => ({
  id,
  name: id,
  x,
  y,
  layers,
  animation: animation(blocks),
  vector: { id, name: id, width: 24, height: 24, alpha: 1 },
  hiddenLayerIds: [],
});
const root = {
  layers: [] as Layer[],
  animation: animation(),
  vector: { id: "page", name: "Page", width: 24, height: 24, alpha: 1 },
  hiddenLayerIds: [],
};
function worldPose(owner: CanvasFrame, id: string, progress: number) {
  const scene = evaluateAndroidScene(owner.layers, owner.animation, progress);
  const node = scene.nodesById.get(id)!;
  return {
    point: transformPointWithMatrix(
      { x: 2, y: 3 },
      multiplyAffine(translateAffine(owner.x, owner.y), node.worldMatrix),
    ),
    alpha: node.alpha,
    d: node.d,
    visible: node.visible,
    clips: node.clipNodeIds,
  };
}
function expectSamePose(before: CanvasFrame, after: CanvasFrame, id: string) {
  for (const progress of [0, 0.5, 1]) {
    const source = worldPose(before, id, progress);
    const target = worldPose(after, id, progress);
    expect(target.point.x).toBeCloseTo(source.point.x, 10);
    expect(target.point.y).toBeCloseTo(source.point.y, 10);
    expect(target.alpha).toBeCloseTo(source.alpha, 10);
    expect(target.d).toBe(source.d);
    expect(target.visible).toBe(source.visible);
  }
}

describe("cross-owner layer hierarchy transforms", () => {
  it("offsets a moved group once, deduplicates selected descendants, and preserves descendant animation", () => {
    const group = layer("group", {
      type: "group",
      translateX: 3,
      translateY: 4,
      rotation: 90,
      scaleX: 2,
      scaleY: 0.5,
      pivotX: 2,
      pivotY: 3,
    });
    const child = layer("child", { parentId: "group", translateX: 5, translateY: 6, locked: true });
    const block = {
      id: "child-x",
      layerId: "child",
      propertyName: "translateX",
      fromValue: 5,
      toValue: 12,
      startTime: 0,
      endTime: 1000,
      interpolator: "LINEAR",
    };
    const source = frame("source", [group, child], [block], 100, 50);
    const target = frame("target", [], [], 300, -20);
    const result = moveLayersBetweenOwners({
      frames: [source, target],
      root,
      sourceOwnerId: source.id,
      targetOwnerId: target.id,
      selectedIds: [group.id, child.id],
    })!;
    expect(result.target.layers).toHaveLength(2);
    expect(result.target.layers.find((item) => item.id === child.id)).toMatchObject({
      translateX: 5,
      translateY: 6,
      parentId: "group",
      locked: true,
    });
    expect(result.target.animation.blocks).toEqual([block]);
    expect(result.selectedIds).toEqual(["group", "child"]);
    expectSamePose(source, result.target, "child");
  });

  it("preserves a detached child's static ancestor transforms, opacity, clipping, and its own motion", () => {
    const outer = layer("outer", {
      type: "group",
      translateX: 6,
      rotation: 25,
      scaleX: 2,
      scaleY: 0.7,
      alpha: 0.5,
    });
    const inner = layer("inner", {
      type: "group",
      parentId: outer.id,
      translateY: 5,
      rotation: -35,
      scaleX: 0.7,
      scaleY: 1.6,
      pivotX: 2,
      alpha: 0.8,
    });
    const clip = layer("clip", {
      type: "clipPath",
      parentId: inner.id,
      translateX: 1,
      fillType: "evenOdd",
    });
    const child = layer("child", { parentId: inner.id, translateX: 3, alpha: 0.6 });
    const block = {
      id: "own-x",
      layerId: child.id,
      propertyName: "translateX",
      fromValue: 3,
      toValue: 10,
      startTime: 0,
      endTime: 1000,
      interpolator: "LINEAR",
    };
    const source = frame("source", [outer, inner, clip, child], [block], 100, 50);
    const target = frame("target", [], [], 300, -20);
    const result = moveLayersBetweenOwners({
      frames: [source, target],
      root,
      sourceOwnerId: source.id,
      targetOwnerId: target.id,
      selectedIds: [child.id],
    })!;
    expectSamePose(source, result.target, "child");
    expect(result.target.animation.blocks).toEqual([block]);
    const targetPose = worldPose(result.target, "child", 0.5);
    expect(targetPose.clips).toHaveLength(1);
    const clone = result.target.layers.find(
      (item) => String(item.id) === String(targetPose.clips[0]),
    )!;
    expect(clone).toMatchObject({ type: "clipPath", fillType: "evenOdd", translateX: 1 });
    const originalClip = worldPose(source, "clip", 0.5);
    const copiedClip = worldPose(result.target, String(clone.id), 0.5);
    expect(copiedClip.point.x).toBeCloseTo(originalClip.point.x, 10);
    expect(copiedClip.point.y).toBeCloseTo(originalClip.point.y, 10);
    expectSamePose(source, result.target, "child");
    expect(
      result.frames.find((owner) => owner.id === source.id)!.layers.map((item) => item.id),
    ).toEqual(["outer", "inner", "clip"]);
  });

  it("moves an animated top-level root with adjusted numeric-string translation endpoints", () => {
    const child = layer("child", { translateX: 3, translateY: 4 });
    const block = {
      id: "x",
      layerId: child.id,
      propertyName: "translateX",
      fromValue: "3",
      toValue: "10",
      startTime: 0,
      endTime: 1000,
      interpolator: "LINEAR",
    };
    const source = frame("source", [child], [block], 100, 50);
    const target = frame("target", [], [], 300, -20);
    const result = moveLayersBetweenOwners({
      frames: [source, target],
      root,
      sourceOwnerId: source.id,
      targetOwnerId: target.id,
      selectedIds: [child.id],
    })!;
    expect(result.target.animation.blocks[0]).toMatchObject({ fromValue: -197, toValue: -190 });
    expectSamePose(source, result.target, "child");
  });

  it("rejects detaching from an animated or locked ancestor and keeps inputs unchanged", () => {
    const group = layer("group", { type: "group", rotation: 20 });
    const child = layer("child", { parentId: group.id });
    const block = {
      id: "group-rotation",
      layerId: group.id,
      propertyName: "rotation",
      fromValue: 20,
      toValue: 90,
      startTime: 0,
      endTime: 1000,
    };
    const source = frame("source", [group, child], [block]);
    const target = frame("target", []);
    const before = structuredClone([source, target]);
    expect(canMoveLayerRootsBetweenOwners(source.layers, source.animation, [child.id])).toBe(false);
    expect(
      moveLayersBetweenOwners({
        frames: [source, target],
        root,
        sourceOwnerId: source.id,
        targetOwnerId: target.id,
        selectedIds: [child.id],
      }),
    ).toBeNull();
    expect([source, target]).toEqual(before);
    expect(canMoveLayerRootsBetweenOwners(source.layers, source.animation, [group.id])).toBe(true);
    group.locked = true;
    expect(canMoveLayerRootsBetweenOwners(source.layers, animation(), [child.id])).toBe(false);
  });

  it("rejects an animated inherited mask and a transformed destination parent", () => {
    const group = layer("group", { type: "group" });
    const clip = layer("clip", { type: "clipPath", parentId: group.id });
    const child = layer("child", { parentId: group.id });
    const source = frame(
      "source",
      [group, clip, child],
      [
        {
          id: "clip-path",
          layerId: clip.id,
          propertyName: "pathData",
          fromValue: "M0 0L1 0",
          toValue: "M0 0L2 0",
          startTime: 0,
          endTime: 1000,
        },
      ],
    );
    expect(canMoveLayerRootsBetweenOwners(source.layers, source.animation, [child.id])).toBe(false);
    const target = frame("target", [layer("destination", { type: "group", rotation: 25 })]);
    source.animation = animation();
    expect(
      moveLayersBetweenOwners({
        frames: [source, target],
        root,
        sourceOwnerId: source.id,
        targetOwnerId: target.id,
        selectedIds: [child.id],
        placement: { parentId: "destination" },
      }),
    ).toBeNull();
  });

  it("retains wrappers when placing into an identity destination group and removes embedded source children", () => {
    const child = layer("child", { translateX: 3 });
    const group = layer("group", { type: "group", rotation: 25, children: [child] });
    const source = frame("source", [group], [], 100, 50);
    const target = frame("target", [layer("destination", { type: "group" })], [], 300, -20);
    const result = moveLayersBetweenOwners({
      frames: [source, target],
      root,
      sourceOwnerId: source.id,
      targetOwnerId: target.id,
      selectedIds: [child.id],
      placement: { parentId: "destination" },
    })!;
    expectSamePose(source, result.target, "child");
    const moved = result.target.layers.find((item) => item.id === child.id)!;
    expect(moved.parentId).not.toBe("destination");
    expect(result.target.layers.find((item) => item.id === moved.parentId)!.parentId).toBe(
      "destination",
    );
    const remaining = result.frames.find((owner) => owner.id === source.id)!.layers;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.children).toBeUndefined();
    expect(result.selectedIds).toEqual([child.id]);
  });
});
