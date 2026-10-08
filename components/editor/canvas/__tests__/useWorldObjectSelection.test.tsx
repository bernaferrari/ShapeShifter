// @vitest-environment happy-dom
import React, { act, useMemo } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "@/lib/store/editorStore";
import { createPathLayer, type CanvasFrame } from "@/lib/store/defaultWorkspace";
import { snapshotHistoryEntry } from "@/lib/store/documentRuntime";
import { parsePath, pathToString } from "@/lib/pathshift/pathUtils";
import { evaluateAndroidScene } from "@/lib/pathshift/scene/evaluate";
import { unionOwnedLayerBounds } from "@/lib/pathshift/scene/selection";
import { PAGE_ROOT_ID } from "@/lib/pathshift/scene/owners";
import type { AnimationState, Layer } from "@/lib/pathshift/types";
import {
  renderEditorComponent,
  type RenderedEditorComponent,
} from "../../__tests__/renderEditorComponent";
import { useWorldObjectSelection } from "../useWorldObjectSelection";
import { WorldDraggedLayers } from "../WorldDraggedLayers";
import { WorldArtboards } from "../WorldArtboards";

const path = parsePath("M0 0 L10 0 L10 10 L0 10 Z");
const group = createPathLayer({
  id: "group",
  name: "Group",
  type: "group",
  from: { subPaths: [] },
  visible: true,
  locked: false,
  translateX: 100,
  translateY: 100,
  rotation: 30,
  scaleX: 2,
  scaleY: 1,
});
const child = createPathLayer({
  id: "child",
  name: "Child",
  from: path,
  visible: true,
  locked: false,
  parentId: group.id,
  translateX: 5,
  translateY: 3,
  rotation: 20,
  fillColor: "#000000",
});
const still: AnimationState = { id: "motion", name: "Motion", duration: 1000, blocks: [] };
const modifiers = { shift: false, alt: false, bypassSnap: true };
const frame = (id: string, x: number, layers: Layer[], animation = still): CanvasFrame => ({
  id,
  name: id,
  x,
  y: 50,
  layers,
  animation,
  vector: { id, name: id, width: 400, height: 400, alpha: 1, tint: "" },
  hiddenLayerIds: [],
});
let baseline: ReturnType<typeof useEditorStore.getState>;
let rendered: RenderedEditorComponent;
let editing: ReturnType<typeof useWorldObjectSelection>;

function Harness() {
  const state = useEditorStore();
  const owners = useMemo(
    () => [
      {
        ownerId: PAGE_ROOT_ID,
        origin: { x: 0, y: 0 },
        layers: state.rootLayers,
        animation: state.rootAnimation,
        progress: state.progress,
        usePlayhead: true,
      },
      ...state.frames.map((frame) => ({
        ownerId: frame.id,
        origin: { x: frame.x, y: frame.y },
        layers: frame.id === state.selectedFrameId ? state.layers : frame.layers,
        animation: frame.id === state.selectedFrameId ? state.animation : frame.animation,
        progress: state.progress,
        usePlayhead: true,
      })),
    ],
    [state],
  );
  const keys = new Set(
    state.selectedLayerRefs.map((ref) => `${ref.ownerId}:${String(ref.layerId)}`),
  );
  editing = useWorldObjectSelection({
    frames: state.frames,
    sceneOwners: owners,
    selectedLayerRefs: state.selectedLayerRefs,
    selectedLayerRefKeys: keys,
    selectionBounds: unionOwnedLayerBounds(owners, state.selectedLayerRefs),
    snapToGrid: false,
    snapStep: 0.5,
    worldPerPixel: 1,
    selectedFrameId: state.selectedFrameId,
    animation: state.animation,
    rootAnimation: state.rootAnimation,
    progress: state.progress,
    syncActiveOwner: state.syncActiveOwner,
  });
  return (
    <svg>
      <WorldArtboards
        frames={state.frames}
        getFrameBounds={(frame) => ({ x: frame.x, y: frame.y, w: 400, h: 400 })}
        activeLayers={state.layers}
        activeAnimation={state.animation}
        rootLayers={state.rootLayers}
        rootAnimation={state.rootAnimation}
        rootVector={{ id: "page", name: "Page", width: 24, height: 24, alpha: 1 }}
        selectedFrameId={state.selectedFrameId}
        selectedFrameIds={[]}
        selectedLayerRefs={state.selectedLayerRefs}
        selectedLayerRefKeys={keys}
        selectionKind="layer"
        hasCanvasSelection
        editingSide="from"
        editPath={null}
        hoveredFrameId={null}
        hoveredLayerKey={null}
        draggingFrameIds={[]}
        isLayerDragging={editing.isDragging}
        isPointTool={false}
        isPlaying={false}
        progress={state.progress}
        worldPerPx={1}
        gridVisibility={{ minorOpacity: 0, majorOpacity: 0 }}
      />
      <WorldDraggedLayers draws={editing.draggedDraws} worldPerPx={1} />
    </svg>
  );
}

function mount(frames: CanvasFrame[], ids: Array<string | number>, progress = 0) {
  const first = frames[0]!;
  useEditorStore.setState({
    frames,
    selectedFrameId: first.id,
    selectedFrameIds: [],
    layers: first.layers,
    animation: first.animation,
    vector: first.vector,
    rootLayers: [],
    rootAnimation: still,
    progress,
    selectedLayerId: ids.at(-1) ?? "",
    selectedLayerIds: ids,
    selectedLayerRefs: ids.map((layerId) => ({ ownerId: first.id, layerId })),
    hasCanvasSelection: true,
    selectionKind: "layer",
    history: [],
    future: [],
    historyCancelFuture: null,
    historyOverflow: null,
    historyGestureActive: false,
    historyGesturePushed: false,
    canUndo: false,
    canRedo: false,
  });
  rendered = renderEditorComponent(<Harness />);
}
function evaluated(ownerId = "frame", id: string | number = child.id) {
  const state = useEditorStore.getState();
  const owner = state.frames.find((frame) => frame.id === ownerId)!;
  return evaluateAndroidScene(
    ownerId === state.selectedFrameId ? state.layers : owner.layers,
    ownerId === state.selectedFrameId ? state.animation : owner.animation,
    state.progress,
  ).nodesById.get(String(id))!;
}
function point() {
  const matrix = evaluated().worldMatrix;
  return { x: matrix.e + 100, y: matrix.f + 50 };
}
beforeEach(() => {
  baseline = useEditorStore.getState();
});
afterEach(() => {
  rendered?.unmount();
  useEditorStore.setState(baseline, true);
});

describe("evaluated world object dragging", () => {
  it("follows a world pointer through rotated/scaled ancestors and commits one undo step", () => {
    mount([frame("frame", 100, [group, child])], [child.id]);
    const before = evaluated().worldMatrix;
    const start = point();
    const end = { x: start.x + 12, y: start.y - 8 };
    act(() => editing.startDrag(start));
    act(() => editing.updateDrag(end, modifiers));
    expect(evaluated().worldMatrix.e).toBeCloseTo(before.e + 12);
    expect(evaluated().worldMatrix.f).toBeCloseTo(before.f - 8);
    expect(evaluated().worldMatrix.a).toBeCloseTo(before.a);
    expect(editing.draggedDraws).toHaveLength(1);
    expect(editing.draggedDraws[0]!.worldMatrix.e).toBeCloseTo(before.e + 12);
    expect(rendered.container.querySelectorAll('[data-dragged-owner="frame"] path')).toHaveLength(
      1,
    );
    act(() => editing.finishDrag(end, modifiers));
    expect(useEditorStore.getState().history).toHaveLength(1);
    expect(useEditorStore.getState().animation.blocks).toHaveLength(0);
    expect(useEditorStore.getState().layers[1]!.from).toBe(child.from);
    act(() => useEditorStore.getState().undo());
    expect(evaluated().worldMatrix.e).toBeCloseTo(before.e);
    expect(evaluated().worldMatrix.f).toBeCloseTo(before.f);
  });

  it("moves group descendants once and excludes their own bounds from smart-guide targets", () => {
    mount([frame("frame", 100, [group, child])], [group.id, child.id]);
    const before = evaluated().worldMatrix;
    const start = point();
    const end = { x: start.x + 3, y: start.y };
    act(() => editing.startDrag(start));
    act(() => editing.updateDrag(end, { ...modifiers, bypassSnap: false }));
    expect(evaluated().worldMatrix.e).toBeCloseTo(before.e + 3);
    expect(useEditorStore.getState().layers[1]!.translateX).toBe(child.translateX);
    expect(editing.draggedDraws.map((draw) => draw.id)).toEqual([child.id]);
    expect(
      rendered.container.querySelectorAll(`path[d="${pathToString(child.from)}"]`),
    ).toHaveLength(1);
    act(() => editing.finishDrag(end, modifiers));
    expect(useEditorStore.getState().history).toHaveLength(1);
  });

  it("previews and keys translation against animated parent and child transforms at a fractional playhead", () => {
    const motion: AnimationState = {
      ...still,
      blocks: [
        {
          id: "parent-rotation",
          layerId: group.id,
          propertyName: "rotation",
          type: "number",
          startTime: 0,
          endTime: 1000,
          fromValue: 30,
          toValue: 70,
          interpolator: "LINEAR",
        },
        {
          id: "child-translation",
          layerId: child.id,
          propertyName: "translateX",
          type: "number",
          startTime: 0,
          endTime: 1000,
          fromValue: 5,
          toValue: 15,
          interpolator: "LINEAR",
        },
      ],
    };
    mount([frame("frame", 100, [group, child], motion)], [child.id], 0.9891666666666666);
    const before = evaluated().worldMatrix;
    const start = point();
    const end = { x: start.x + 10, y: start.y + 7 };
    act(() => editing.startDrag(start));
    act(() => editing.updateDrag(end, modifiers));
    expect(evaluated().worldMatrix.e).toBeCloseTo(before.e + 10, 7);
    expect(evaluated().worldMatrix.f).toBeCloseTo(before.f + 7, 7);
    expect(editing.draggedDraws[0]!.worldMatrix.e).toBeCloseTo(before.e + 10, 7);
    expect(useEditorStore.getState().layers[1]!.translateX).toBe(5);
    expect(
      useEditorStore.getState().animation.blocks.find((block) => block.id === "parent-rotation"),
    ).toEqual(motion.blocks[0]);
    act(() => editing.finishDrag(end, modifiers));
    expect(useEditorStore.getState().history).toHaveLength(1);
    act(() => useEditorStore.getState().undo());
    expect(evaluated().worldMatrix.e).toBeCloseTo(before.e);
    expect(useEditorStore.getState().progress).toBe(0.9891666666666666);
    expect(useEditorStore.getState().animation).toEqual(motion);
  });

  it("moves selections in different owners with the same world delta and keys both owners", () => {
    const otherGroup = { ...group, id: "other-group", rotation: -25, scaleX: 0.8, scaleY: 3 };
    const otherChild = { ...child, id: "other-child", parentId: otherGroup.id };
    mount(
      [frame("frame", 100, [group, child]), frame("other", 700, [otherGroup, otherChild])],
      [child.id],
      0.5,
    );
    act(() =>
      useEditorStore.setState({
        selectedLayerRefs: [
          { ownerId: "frame", layerId: child.id },
          { ownerId: "other", layerId: otherChild.id },
        ],
      }),
    );
    const before = evaluated().worldMatrix;
    const otherBefore = evaluated("other", otherChild.id).worldMatrix;
    const start = point();
    const end = { x: start.x + 18, y: start.y + 9 };
    act(() => editing.startDrag(start));
    act(() => editing.updateDrag(end, modifiers));
    expect(evaluated().worldMatrix.e).toBeCloseTo(before.e + 18);
    expect(evaluated("other", otherChild.id).worldMatrix.e).toBeCloseTo(otherBefore.e + 18);
    expect(evaluated("other", otherChild.id).worldMatrix.f).toBeCloseTo(otherBefore.f + 9);
    expect(useEditorStore.getState().frames[1]!.animation.blocks.length).toBeGreaterThan(0);
    expect(editing.draggedDraws).toHaveLength(2);
    act(() => editing.finishDrag(end, modifiers));
    expect(useEditorStore.getState().selectedFrameId).toBe("frame");
    expect(useEditorStore.getState().history).toHaveLength(1);
  });

  it("Alt-clones an overlapping group selection once while retaining its animated subtree", () => {
    const motion: AnimationState = {
      ...still,
      blocks: [
        {
          id: "parent-rotation",
          layerId: group.id,
          propertyName: "rotation",
          type: "number",
          startTime: 0,
          endTime: 1000,
          fromValue: 30,
          toValue: 70,
          interpolator: "LINEAR",
        },
      ],
    };
    mount([frame("frame", 100, [group, child], motion)], [group.id, child.id], 0.5);
    const before = evaluated().worldMatrix;
    const start = point();
    const end = { x: start.x + 10, y: start.y + 12 };
    act(() => editing.startDrag(start));
    act(() => editing.updateDrag(end, { ...modifiers, alt: true }));
    expect(useEditorStore.getState().layers).toHaveLength(4);
    const clone = useEditorStore
      .getState()
      .layers.find((layer) => layer.type === "path" && layer.id !== child.id)!;
    expect(evaluated().worldMatrix.e).toBeCloseTo(before.e);
    expect(evaluated("frame", clone.id).worldMatrix.e).toBeCloseTo(before.e + 10);
    expect(evaluated("frame", clone.id).worldMatrix.f).toBeCloseTo(before.f + 12);
    expect(editing.draggedDraws.filter((draw) => !draw.isClipPath)).toHaveLength(1);
    act(() => editing.finishDrag(end, { ...modifiers, alt: true }));
    expect(useEditorStore.getState().history).toHaveLength(1);
    act(() => useEditorStore.getState().undo());
    expect(useEditorStore.getState().layers).toHaveLength(2);
    expect(useEditorStore.getState().selectedLayerRefs).toEqual([
      { ownerId: "frame", layerId: group.id },
      { ownerId: "frame", layerId: child.id },
    ]);
  });

  it("cancels animated movement and preserves redo when returning to the original position", () => {
    mount([frame("frame", 100, [group, child])], [child.id], 0.5);
    const future = [snapshotHistoryEntry(useEditorStore.getState())];
    act(() => useEditorStore.setState({ future, canRedo: true }));
    const before = evaluated().worldMatrix;
    const start = point();
    const end = { x: start.x + 10, y: start.y + 12 };
    act(() => editing.startDrag(start));
    act(() => editing.updateDrag(end, modifiers));
    act(() => editing.cancelDrag());
    expect(evaluated().worldMatrix.e).toBeCloseTo(before.e);
    expect(useEditorStore.getState().animation.blocks).toHaveLength(0);
    expect(useEditorStore.getState().future).toEqual(future);
    act(() => editing.startDrag(start));
    act(() => editing.updateDrag(end, modifiers));
    act(() => editing.finishDrag(start, modifiers));
    expect(useEditorStore.getState().history).toHaveLength(0);
    expect(useEditorStore.getState().future).toEqual(future);
  });

  it("renders clipped, trimmed, tinted drag previews with the owner's opacity and no fallback stroke", () => {
    const clip = {
      ...child,
      id: "clip",
      type: "clipPath" as const,
      from: parsePath("M0 0 L8 0 L8 8 Z"),
      translateX: 0,
      translateY: 0,
      rotation: 0,
    };
    const trimmed = {
      ...child,
      strokeColor: "#000000",
      strokeWidth: 0,
      trimPathStart: 0.25,
      trimPathEnd: 0.75,
    };
    const source = frame("frame", 100, [group, clip, trimmed]);
    source.vector = { ...source.vector, alpha: 0.6, tint: "#ff0000" };
    mount([source], [child.id]);
    const start = point();
    act(() => editing.startDrag(start));
    act(() => editing.updateDrag({ x: start.x + 8, y: start.y + 5 }, modifiers));
    const ghost = rendered.container.querySelector('[data-dragged-owner="frame"]')!;
    expect(ghost.querySelector('clipPath[id="android-clip-drag-frame-clip"]')).not.toBeNull();
    expect(ghost.querySelector('[clip-path="url(#android-clip-drag-frame-clip)"]')).not.toBeNull();
    const painted = ghost.querySelector('path[stroke="#000000"]')!;
    expect(painted.getAttribute("stroke-width")).toBe("0");
    expect(painted.hasAttribute("pathLength")).toBe(false);
    expect(painted.hasAttribute("stroke-dasharray")).toBe(false);
    expect(painted.getAttribute("d")).not.toBe(pathToString(child.pathData ?? child.from));
    expect(ghost.querySelector('g[opacity="0.6"] rect[fill="#ff0000"]')).not.toBeNull();
    expect(Number(ghost.querySelector("mask")?.getAttribute("x"))).toBeGreaterThan(0);
  });

  it("transfers a child between frames while retaining its static ancestry and displayed world position", () => {
    mount([frame("frame", 100, [group, child]), frame("other", 700, [])], [child.id]);
    const before = evaluated().worldMatrix;
    const start = point();
    const end = { x: start.x + 600, y: start.y };
    act(() => editing.startDrag(start));
    act(() => editing.updateDrag(end, modifiers));
    expect(editing.dropPreview?.ownerId).toBe("other");
    act(() => editing.finishDrag(end, modifiers));
    expect(useEditorStore.getState().selectedFrameId).toBe("other");
    expect(evaluated("other").worldMatrix.e + 700).toBeCloseTo(before.e + 100 + 600);
    expect(evaluated("other").worldMatrix.f + 50).toBeCloseTo(before.f + 50);
    expect(useEditorStore.getState().layers.some((layer) => layer.type === "group")).toBe(true);
    expect(useEditorStore.getState().history).toHaveLength(1);
  });

  it("explains and retains ownership when crossing frames with an animated ancestor", () => {
    const motion: AnimationState = {
      ...still,
      blocks: [
        {
          id: "parent-rotation",
          layerId: group.id,
          propertyName: "rotation",
          type: "number",
          startTime: 0,
          endTime: 1000,
          fromValue: 30,
          toValue: 70,
          interpolator: "LINEAR",
        },
      ],
    };
    mount([frame("frame", 100, [group, child], motion), frame("other", 700, [])], [child.id], 0.5);
    const before = evaluated().worldMatrix;
    const start = point();
    const end = { x: start.x + 600, y: start.y };
    act(() => editing.startDrag(start));
    act(() => editing.updateDrag(end, modifiers));
    expect(editing.dropPreview?.label).toContain("Animated parent");
    act(() => editing.finishDrag(end, modifiers));
    expect(useEditorStore.getState().selectedFrameId).toBe("frame");
    expect(evaluated().worldMatrix.e).toBeCloseTo(before.e + 600);
    expect(useEditorStore.getState().frames[1]!.layers).toHaveLength(0);
  });

  it("does not roll an owner switch or an external undo back to a frozen drag", () => {
    mount([frame("frame", 100, [group, child]), frame("other", 700, [])], [child.id]);
    const start = point();
    const end = { x: start.x + 12, y: start.y };
    act(() => editing.startDrag(start));
    act(() => editing.updateDrag(end, modifiers));
    act(() => useEditorStore.getState().selectFrame("other"));
    act(() => editing.cancelDrag());
    expect(useEditorStore.getState().selectedFrameId).toBe("other");
    expect(useEditorStore.getState().layers).toHaveLength(0);
    act(() => useEditorStore.getState().undo());
    const restored = evaluated().worldMatrix;
    act(() => editing.startDrag(start));
    act(() => editing.updateDrag(end, modifiers));
    act(() => useEditorStore.getState().undo());
    act(() => {
      expect(editing.updateDrag(end, modifiers)).toBe(false);
    });
    expect(evaluated().worldMatrix.e).toBeCloseTo(restored.e);
    expect(useEditorStore.getState().history).toHaveLength(0);
  });
});
