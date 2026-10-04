// @vitest-environment happy-dom
import React, { act, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPathLayer } from "@/lib/store/defaultWorkspace";
import { useEditorStore } from "@/lib/store/editorStore";
import { snapshotHistoryEntry } from "@/lib/store/documentRuntime";
import { parsePath } from "@/lib/shapeshifter/pathUtils";
import { evaluateAndroidScene } from "@/lib/shapeshifter/scene/evaluate";
import { PAGE_ROOT_ID } from "@/lib/shapeshifter/scene/owners";
import {
  inverseAffine,
  rotateAffine,
  transformPointWithMatrix,
} from "@/lib/shapeshifter/scene/layerTransform";
import type { AnimationState, Layer, Point } from "@/lib/shapeshifter/types";
import {
  renderEditorComponent,
  type RenderedEditorComponent,
} from "../../__tests__/renderEditorComponent";
import { WorldSelectionOverlay } from "../WorldSelectionOverlay";
import { useWorldLayerTransform } from "../useWorldLayerTransform";

const origin = { x: 100, y: 50 };
const path = parsePath("M0 0 L10 0 L10 10 L0 10 Z");
const emptyPath = { subPaths: [] };
const group: Layer = createPathLayer({
  id: "group",
  name: "Group",
  type: "group",
  from: emptyPath,
  visible: true,
  locked: false,
  rotation: 20,
  scaleX: 2,
  scaleY: 1.5,
  translateX: 10,
  translateY: 4,
});
const child: Layer = createPathLayer({
  id: "child",
  name: "Child",
  from: path,
  visible: true,
  locked: false,
  parentId: group.id,
  rotation: 35,
  scaleX: 1.5,
  scaleY: 0.8,
  pivotX: 3,
  pivotY: 4,
  translateX: 5,
  translateY: 2,
});
const still: AnimationState = { id: "motion", name: "Motion", duration: 1000, blocks: [] };
const modifiers = { preserveAspect: false, bypassSnap: true };
let baseline: ReturnType<typeof useEditorStore.getState>;
let rendered: RenderedEditorComponent;
let editing: ReturnType<typeof useWorldLayerTransform>;

function Harness() {
  const svgRef = useRef<SVGSVGElement>(null);
  const layers = useEditorStore((state) => state.layers);
  const animation = useEditorStore((state) => state.animation);
  const progress = useEditorStore((state) => state.progress);
  const selectedLayerIds = useEditorStore((state) => state.selectedLayerIds);
  editing = useWorldLayerTransform({
    svgRef,
    ownerOrigin: origin,
    snapToGrid: false,
    snapStep: 0.5,
    syncActiveOwner: useEditorStore.getState().syncActiveOwner,
  });
  return (
    <svg ref={svgRef}>
      <WorldSelectionOverlay
        visible
        activeOrigin={origin}
        activeLayers={layers}
        animation={animation}
        progress={progress}
        activeLayerIds={selectedLayerIds}
        selectedOwnerCount={1}
        documentBounds={null}
        worldPerPx={1}
        worldPointFromClient={(x, y) => ({ x, y })}
        onResizeStart={editing.startResize}
        onRotateStart={editing.startRotate}
      />
    </svg>
  );
}

function mount(layers: Layer[], ids: Array<string | number>, animation = still, progress = 0) {
  useEditorStore.setState({
    layers,
    rootLayers: layers,
    animation,
    rootAnimation: animation,
    progress,
    selectedFrameId: PAGE_ROOT_ID,
    selectedFrameIds: [],
    selectedLayerId: ids[0] ?? "",
    selectedLayerIds: ids,
    selectedLayerRefs: ids.map((layerId) => ({ ownerId: PAGE_ROOT_ID, layerId })),
    selectionKind: "layer",
    hasCanvasSelection: true,
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

function begin(element: Element, point: Point) {
  act(() =>
    element.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        isPrimary: true,
        pointerId: 1,
        clientX: point.x,
        clientY: point.y,
      }),
    ),
  );
}

function resizeCorner() {
  const handle = rendered.container.querySelector('[data-resize-handle="se"]')!;
  const rect = handle.querySelectorAll("rect")[1]!;
  return {
    handle,
    point: {
      x: Number(rect.getAttribute("x")) + Number(rect.getAttribute("width")) / 2,
      y: Number(rect.getAttribute("y")) + Number(rect.getAttribute("height")) / 2,
    },
  };
}

function evaluated(id: string | number, progress = useEditorStore.getState().progress) {
  const state = useEditorStore.getState();
  return evaluateAndroidScene(state.layers, state.animation, progress).nodesById.get(String(id))!;
}

function resizedPoint(point: Point, factorX: number, factorY: number, id: string | number) {
  const matrix = evaluated(id).worldMatrix;
  const local = transformPointWithMatrix(
    { x: point.x - origin.x, y: point.y - origin.y },
    inverseAffine(matrix)!,
  );
  const next = transformPointWithMatrix({ x: local.x * factorX, y: local.y * factorY }, matrix);
  return { x: next.x + origin.x, y: next.y + origin.y };
}

function rotationPoint(
  start: Point,
  center: Point,
  parentMatrix: ReturnType<typeof evaluated>["worldMatrix"],
  degrees: number,
) {
  const inverse = inverseAffine(parentMatrix)!;
  const localStart = transformPointWithMatrix(
    { x: start.x - origin.x, y: start.y - origin.y },
    inverse,
  );
  const localCenter = transformPointWithMatrix(
    { x: center.x - origin.x, y: center.y - origin.y },
    inverse,
  );
  const offset = transformPointWithMatrix(
    { x: localStart.x - localCenter.x, y: localStart.y - localCenter.y },
    rotateAffine(degrees),
  );
  const result = transformPointWithMatrix(
    { x: localCenter.x + offset.x, y: localCenter.y + offset.y },
    parentMatrix,
  );
  return { x: result.x + origin.x, y: result.y + origin.y };
}

function rotationHandle() {
  const handle = rendered.container.querySelector("[data-rotate-handle]")!;
  const point = { x: Number(handle.getAttribute("cx")), y: Number(handle.getAttribute("cy")) };
  const rect = rendered.container.querySelector("[data-selection-frame] > rect")!;
  const matrixText = rect.getAttribute("transform")!.slice(7, -1).split(" ").map(Number);
  const matrix = {
    a: matrixText[0]!,
    b: matrixText[1]!,
    c: matrixText[2]!,
    d: matrixText[3]!,
    e: matrixText[4]!,
    f: matrixText[5]!,
  };
  const center = transformPointWithMatrix(
    {
      x: Number(rect.getAttribute("x")) + Number(rect.getAttribute("width")) / 2,
      y: Number(rect.getAttribute("y")) + Number(rect.getAttribute("height")) / 2,
    },
    matrix,
  );
  return { handle, point, center };
}

beforeEach(() => {
  baseline = useEditorStore.getState();
});
afterEach(() => {
  rendered?.unmount();
  useEditorStore.setState(baseline, true);
});

describe("World selection gestures", () => {
  it("displays evaluated group transforms and keys one resize without moving its child twice", () => {
    const motion: AnimationState = {
      ...still,
      blocks: [
        {
          id: "scale",
          layerId: group.id,
          propertyName: "scaleX",
          type: "number",
          fromValue: 2,
          toValue: 4,
          startTime: 0,
          endTime: 1000,
          interpolator: "LINEAR",
        },
      ],
    };
    mount(
      [group, { ...child, rotation: 0, translateX: 0, translateY: 0, pivotX: 0, pivotY: 0 }],
      [group.id, child.id],
      motion,
      0.5,
    );
    const selection = rendered.container.querySelector("[data-selection-frame] > rect")!;
    const expected = evaluated(group.id).worldMatrix;
    expect(selection.getAttribute("transform")).toBe(
      `matrix(${expected.a} ${expected.b} ${expected.c} ${expected.d} ${expected.e + origin.x} ${expected.f + origin.y})`,
    );
    const { handle, point } = resizeCorner();
    const first = resizedPoint(point, 1.5, 2, group.id);
    const second = resizedPoint(point, 2, 2, group.id);
    begin(handle, point);
    act(() => editing.update(first, modifiers));
    act(() => editing.update(second, modifiers));
    act(() => editing.finish());
    expect(evaluated(group.id).transform.scaleX).toBeCloseTo(6);
    expect(evaluated(group.id).transform.scaleY).toBeCloseTo(3);
    expect(useEditorStore.getState().layers[0]!.scaleX).toBe(2);
    expect(useEditorStore.getState().layers[1]!.scaleX).toBe(child.scaleX);
    expect(useEditorStore.getState().rootAnimation).toEqual(useEditorStore.getState().animation);
    expect(useEditorStore.getState().history).toHaveLength(1);
    act(() => useEditorStore.getState().undo());
    expect(evaluated(group.id).transform.scaleX).toBeCloseTo(3);
    expect(useEditorStore.getState().animation).toEqual(motion);
  });

  it("cancels a nested animated resize and restores both artwork and keys", () => {
    mount([group, child], [child.id], still, 0.5);
    const originalLayers = structuredClone(useEditorStore.getState().layers);
    const { handle, point } = resizeCorner();
    const target = resizedPoint(point, 2, 1.5, child.id);
    begin(handle, point);
    act(() => editing.update(target, modifiers));
    expect(useEditorStore.getState().animation.blocks.length).toBeGreaterThan(0);
    act(() => editing.cancel());
    const restored = useEditorStore.getState().layers;
    expect(restored[1]!.from).toEqual(originalLayers[1]!.from);
    for (const [index, layer] of originalLayers.entries()) {
      for (const property of [
        "translateX",
        "translateY",
        "rotation",
        "scaleX",
        "scaleY",
        "pivotX",
        "pivotY",
      ] as const)
        expect(restored[index]![property]).toBe(layer[property]);
    }
    expect(useEditorStore.getState().animation).toEqual(still);
    expect(useEditorStore.getState().rootAnimation).toEqual(still);
    expect(useEditorStore.getState().history).toHaveLength(0);
  });

  it("retains redo after a click or a resize that returns to its starting size", () => {
    mount([group, child], [child.id]);
    const future = [snapshotHistoryEntry(useEditorStore.getState())];
    act(() => useEditorStore.setState({ future, canRedo: true }));
    const { handle, point } = resizeCorner();
    const target = resizedPoint(point, 2, 2, child.id);
    begin(handle, point);
    act(() => editing.update(point, modifiers));
    act(() => editing.finish());
    expect(useEditorStore.getState().history).toHaveLength(0);
    expect(useEditorStore.getState().future).toEqual(future);
    begin(handle, point);
    act(() => editing.update(target, modifiers));
    act(() => editing.update(point, modifiers));
    act(() => editing.finish());
    expect(useEditorStore.getState().history).toHaveLength(0);
    expect(useEditorStore.getState().future).toEqual(future);
    expect(useEditorStore.getState().canRedo).toBe(true);
  });

  it("rotates at the playhead in an anisotropic parent's space and undoes the full gesture", () => {
    const motion: AnimationState = {
      ...still,
      blocks: [
        {
          id: "rotation",
          layerId: child.id,
          propertyName: "rotation",
          type: "number",
          fromValue: 40,
          toValue: 60,
          startTime: 0,
          endTime: 1000,
          interpolator: "LINEAR",
        },
      ],
    };
    mount([group, child], [child.id], motion, 0.5);
    const { handle, point, center } = rotationHandle();
    const parent = evaluated(group.id).worldMatrix;
    begin(handle, point);
    act(() => editing.update(rotationPoint(point, center, parent, 90), modifiers));
    act(() => editing.finish());
    expect(evaluated(child.id).transform.rotation).toBeCloseTo(140);
    expect(evaluated(child.id).transform.scaleX).toBeCloseTo(child.scaleX!);
    expect(evaluated(child.id).transform.scaleY).toBeCloseTo(child.scaleY!);
    expect(useEditorStore.getState().layers[1]!.rotation).toBe(35);
    expect(useEditorStore.getState().history).toHaveLength(1);
    act(() => useEditorStore.getState().undo());
    expect(evaluated(child.id).transform.rotation).toBeCloseTo(50);
    expect(useEditorStore.getState().animation).toEqual(motion);
  });

  it("preserves rotation winding through the angle seam", () => {
    mount([group, child], [child.id]);
    const { handle, point, center } = rotationHandle();
    const parent = evaluated(group.id).worldMatrix;
    begin(handle, point);
    for (const degrees of [110, 220, 330, 420])
      act(() => editing.update(rotationPoint(point, center, parent, degrees), modifiers));
    act(() => editing.finish());
    expect(useEditorStore.getState().layers[1]!.rotation).toBeCloseTo(455);
    expect(useEditorStore.getState().history).toHaveLength(1);
  });

  it("abandons a frozen gesture after an owner switch without restoring the old owner", () => {
    mount([group, child], [child.id]);
    const { handle, point } = resizeCorner();
    const target = resizedPoint(point, 2, 2, child.id);
    begin(handle, point);
    act(() => editing.update(target, modifiers));
    const otherLayers = [
      createPathLayer({ id: "other", name: "Other", from: path, visible: true, locked: false }),
    ];
    act(() => useEditorStore.setState({ selectedFrameId: "other-owner", layers: otherLayers }));
    act(() => {
      expect(editing.update(target, modifiers)).toBe(false);
    });
    expect(useEditorStore.getState().layers).toBe(otherLayers);
    expect(editing.hasTransform()).toBe(false);
    expect(useEditorStore.getState().history).toHaveLength(1);
  });

  it("turns resize cursors with the evaluated selection frame", () => {
    mount([{ ...child, parentId: null, rotation: 90, scaleX: 1, scaleY: 1 }], [child.id]);
    expect(
      (rendered.container.querySelector('[data-resize-handle="e"]') as SVGElement).style.cursor,
    ).toBe("ns-resize");
    expect(
      (rendered.container.querySelector('[data-resize-handle="n"]') as SVGElement).style.cursor,
    ).toBe("ew-resize");
  });

  it("ignores secondary pointers on resize and rotation handles", () => {
    mount([group, child], [child.id]);
    for (const handle of [resizeCorner().handle, rotationHandle().handle]) {
      act(() =>
        handle.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            cancelable: true,
            button: 0,
            pointerId: 2,
            isPrimary: false,
          }),
        ),
      );
      expect(editing.hasTransform()).toBe(false);
    }
    expect(useEditorStore.getState().history).toHaveLength(0);
  });

  it.each([0.01, 0.9891666666666666])(
    "previews a resize precisely at near-endpoint playhead %s",
    (progress) => {
      const motion: AnimationState = {
        ...still,
        blocks: [
          {
            id: "scale",
            layerId: child.id,
            propertyName: "scaleX",
            type: "number",
            fromValue: 1,
            toValue: 3,
            startTime: 0,
            endTime: 1000,
            interpolator: "LINEAR",
          },
        ],
      };
      mount([group, child], [child.id], motion, progress);
      const prior = evaluated(child.id).transform.scaleX;
      const { handle, point } = resizeCorner();
      const target = resizedPoint(point, 2, 1, child.id);
      begin(handle, point);
      act(() => editing.update(target, modifiers));
      act(() => editing.finish());
      expect(evaluated(child.id).transform.scaleX).toBeCloseTo(prior * 2, 8);
      expect(evaluated(child.id, 0).transform.scaleX).toBe(1);
      expect(evaluated(child.id, 1).transform.scaleX).toBe(3);
      expect(
        useEditorStore
          .getState()
          .animation.blocks.some((block) => Math.abs(block.startTime - progress * 1000) < 1e-7),
      ).toBe(true);
    },
  );

  it("retains the resting pose even when recording just after the timeline start", () => {
    mount([group, child], [child.id], still, 0.00005);
    const { handle, point } = resizeCorner();
    const target = resizedPoint(point, 2, 1, child.id);
    begin(handle, point);
    act(() => editing.update(target, modifiers));
    act(() => editing.finish());
    expect(evaluated(child.id).transform.scaleX).toBeCloseTo(child.scaleX! * 2);
    expect(evaluated(child.id, 0).transform.scaleX).toBe(child.scaleX);
    expect(useEditorStore.getState().layers[1]!.scaleX).toBe(child.scaleX);
  });

  it("keeps a changed owner when a transform hook unmounts before another pointer move", () => {
    mount([group, child], [child.id]);
    const { handle, point } = resizeCorner();
    const target = resizedPoint(point, 2, 2, child.id);
    begin(handle, point);
    act(() => editing.update(target, modifiers));
    const otherLayers = [
      createPathLayer({ id: "other", name: "Other", from: path, visible: true, locked: false }),
    ];
    act(() => useEditorStore.setState({ selectedFrameId: "other-owner", layers: otherLayers }));
    rendered.unmount();
    rendered = undefined!;
    expect(useEditorStore.getState().layers).toBe(otherLayers);
    expect(useEditorStore.getState().selectedFrameId).toBe("other-owner");
    expect(useEditorStore.getState().history).toHaveLength(1);
  });
});
