// @vitest-environment happy-dom
import React, { act, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEditorAgent } from "@/lib/agent/editorAgent";
import { useEditorStore } from "@/lib/store/editorStore";
import { beginLiveGesture, endLiveGesture, ownsLiveGesture } from "@/lib/store/liveGesture";
import { snapshotHistoryEntry } from "@/lib/store/documentRuntime";
import { createPathLayer, type CanvasFrame } from "@/lib/store/defaultWorkspace";
import { parsePath } from "@/lib/shapeshifter/pathUtils";
import { unionOwnedLayerBounds } from "@/lib/shapeshifter/scene/selection";
import {
  renderEditorComponent,
  type RenderedEditorComponent,
} from "../../__tests__/renderEditorComponent";
import { WorldSelectionOverlay } from "../WorldSelectionOverlay";
import { useWorldLayerTransform } from "../useWorldLayerTransform";
import { useWorldObjectSelection } from "../useWorldObjectSelection";
import { useWorldFrameResize } from "../useWorldFrameResize";
import { useArtboardDrag } from "../useArtboardDrag";

let baseline: ReturnType<typeof useEditorStore.getState>;
let rendered: RenderedEditorComponent;
let transform: ReturnType<typeof useWorldLayerTransform>;
let object: ReturnType<typeof useWorldObjectSelection>;
let frameResize: ReturnType<typeof useWorldFrameResize>;
let artboard: ReturnType<typeof useArtboardDrag>;
const modifiers = { shift: false, alt: false, bypassSnap: true };
const transformModifiers = { preserveAspect: false, bypassSnap: true };
const source = (): CanvasFrame => ({
  id: "frame",
  name: "Frame",
  x: 0,
  y: 0,
  vector: { id: "frame", name: "Frame", width: 24, height: 24, alpha: 1 },
  animation: { id: "motion", name: "Motion", duration: 1000, blocks: [] },
  hiddenLayerIds: [],
  layers: [
    createPathLayer({
      id: "path",
      name: "Shape",
      from: parsePath("M1 1 L5 1 L5 5 L1 5 Z"),
      visible: true,
      locked: false,
      fillColor: "#000000",
    }),
  ],
});
function Harness() {
  const state = useEditorStore();
  const svgRef = useRef<SVGSVGElement>(null);
  const frame = state.frames[0]!;
  const owners = [
    {
      ownerId: frame.id,
      origin: { x: frame.x, y: frame.y },
      layers: state.layers,
      animation: state.animation,
      progress: state.progress,
      usePlayhead: true,
    },
  ];
  transform = useWorldLayerTransform({
    svgRef,
    ownerOrigin: { x: 0, y: 0 },
    snapToGrid: false,
    snapStep: 0.5,
    syncActiveOwner: state.syncActiveOwner,
  });
  object = useWorldObjectSelection({
    frames: state.frames,
    sceneOwners: owners,
    selectedLayerRefs: state.selectedLayerRefs,
    selectedLayerRefKeys: new Set(["frame:path"]),
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
  frameResize = useWorldFrameResize({ svgRef, frame, worldPointFromClient: (x, y) => ({ x, y }) });
  artboard = useArtboardDrag({ snapToGrid: false, worldPointFromClient: (x, y) => ({ x, y }) });
  return (
    <svg ref={svgRef}>
      <WorldSelectionOverlay
        visible
        activeOrigin={{ x: 0, y: 0 }}
        activeLayers={state.layers}
        animation={state.animation}
        progress={state.progress}
        activeLayerIds={["path"]}
        selectedOwnerCount={1}
        documentBounds={null}
        worldPerPx={1}
        worldPointFromClient={(x, y) => ({ x, y })}
        onResizeStart={transform.startResize}
        onRotateStart={transform.startRotate}
      />
    </svg>
  );
}
function pointer(x: number, y: number) {
  return new PointerEvent("pointerdown", {
    bubbles: true,
    cancelable: true,
    button: 0,
    isPrimary: true,
    pointerId: 1,
    clientX: x,
    clientY: y,
  });
}
const kinds = ["object", "resize", "rotate", "frame-resize", "artboard"] as const;
function gesture(kind: (typeof kinds)[number]) {
  if (kind === "object")
    return {
      start: () => object.startDrag({ x: 1, y: 1 }),
      move: () => object.updateDrag({ x: 3, y: 3 }, modifiers),
      finish: () => object.finishDrag({ x: 1, y: 1 }, modifiers),
      cancel: () => object.cancelDrag(),
    };
  if (kind === "artboard")
    return {
      start: () => artboard.start(0, 0, ["frame"]),
      move: () => artboard.update(10, 5, modifiers),
      finish: () => artboard.finish(0, 0, modifiers),
      cancel: () => artboard.cancel(),
    };
  if (kind === "frame-resize")
    return {
      start: () => frameResize.start(pointer(24, 24) as unknown as ReactPointerEvent, "se"),
      move: () => frameResize.update({ x: 30, y: 30 }, true),
      finish: () => frameResize.finish(),
      cancel: () => frameResize.cancel(),
    };
  if (kind === "resize")
    return {
      start: () =>
        rendered.container.querySelector('[data-resize-handle="se"]')!.dispatchEvent(pointer(5, 5)),
      move: () => transform.update({ x: 8, y: 8 }, transformModifiers),
      finish: () => transform.finish(),
      cancel: () => transform.cancel(),
    };
  return {
    start: () => {
      const handle = rendered.container.querySelector("[data-rotate-handle]")!;
      handle.dispatchEvent(
        pointer(Number(handle.getAttribute("cx")), Number(handle.getAttribute("cy"))),
      );
    },
    move: () => transform.update({ x: 23, y: 3 }, transformModifiers),
    finish: () => transform.finish(),
    cancel: () => transform.cancel(),
  };
}

beforeEach(() => {
  baseline = useEditorStore.getState();
  const frame = source();
  useEditorStore.setState({
    frames: [frame],
    selectedFrameId: frame.id,
    layers: frame.layers,
    vector: frame.vector,
    animation: frame.animation,
    rootLayers: [],
    selectedLayerId: "path",
    selectedLayerIds: ["path"],
    selectedLayerRefs: [{ ownerId: "frame", layerId: "path" }],
    selectedFrameIds: [],
    selectedBlockIds: [],
    hasCanvasSelection: true,
    selectionKind: "layer",
    progress: 0,
    isPlaying: false,
    dragState: null,
    historyGestureActive: false,
    historyGesturePushed: false,
    history: [],
    future: [],
    historyOverflow: null,
    historyCancelFuture: null,
    canUndo: false,
    canRedo: false,
  });
  rendered = renderEditorComponent(<Harness />);
});
afterEach(() => {
  rendered?.unmount();
  useEditorStore.setState(baseline, true);
});

function expectAgentBusy(agent: ReturnType<typeof createEditorAgent>) {
  const expectedRevision = agent.inspect().revision;
  expect(() =>
    agent.apply({
      expectedRevision,
      commands: [{ type: "renameLayer", ownerId: "frame", layerId: "path", name: "Blocked" }],
    }),
  ).toThrow(/Finish the current gesture/);
  expect(() => agent.undo({ expectedRevision })).toThrow(/Finish the current gesture/);
}

describe("world pointer sessions protect agent transactions", () => {
  it.each(kinds)(
    "blocks agent apply and undo during pending and moved %s, then releases without consuming redo",
    (kind) => {
      const agent = createEditorAgent();
      const future = [snapshotHistoryEntry(useEditorStore.getState())];
      act(() => useEditorStore.setState({ future, canRedo: true }));
      const current = gesture(kind);
      act(() => {
        current.start();
      });
      expect(useEditorStore.getState().dragState).not.toBeNull();
      expect(useEditorStore.getState().historyGestureActive).toBe(false);
      expect(useEditorStore.getState().history).toHaveLength(0);
      expectAgentBusy(agent);
      act(() => {
        current.move();
      });
      expect(useEditorStore.getState().history).toHaveLength(1);
      expectAgentBusy(agent);
      act(() => {
        current.cancel();
      });
      expect(useEditorStore.getState().dragState).toBeNull();
      expect(useEditorStore.getState().history).toHaveLength(0);
      expect(useEditorStore.getState().future).toEqual(future);
      act(() => {
        agent.apply({
          expectedRevision: agent.inspect().revision,
          commands: [{ type: "renameLayer", ownerId: "frame", layerId: "path", name: "Allowed" }],
        });
      });
      expect(useEditorStore.getState().layers[0]!.name).toBe("Allowed");
    },
  );

  it.each(kinds)("releases a pending %s click on finish without a history entry", (kind) => {
    const current = gesture(kind);
    act(() => {
      current.start();
    });
    act(() => {
      current.finish();
    });
    expect(useEditorStore.getState().dragState).toBeNull();
    expect(useEditorStore.getState().history).toHaveLength(0);
  });

  it.each(["frame-resize", "artboard"] as const)(
    "preserves redo when a moved %s returns to its starting geometry",
    (kind) => {
      const future = [snapshotHistoryEntry(useEditorStore.getState())];
      act(() => useEditorStore.setState({ future, canRedo: true }));
      const current = gesture(kind);
      act(() => {
        current.start();
        current.move();
      });
      expect(useEditorStore.getState().history).toHaveLength(1);
      act(() => {
        if (kind === "frame-resize") frameResize.update({ x: 24, y: 24 }, true);
        current.finish();
      });
      const state = useEditorStore.getState();
      expect(state.dragState).toBeNull();
      expect(state.history).toHaveLength(0);
      expect(state.future).toEqual(future);
      expect(state.canRedo).toBe(true);
      expect(state.vector.width).toBe(24);
      expect(state.vector.height).toBe(24);
      expect(state.frames[0]!.x).toBe(0);
      expect(state.frames[0]!.y).toBe(0);
    },
  );

  it.each(kinds)("cannot resume a moved %s session after human Undo", (kind) => {
    const current = gesture(kind);
    act(() => {
      current.start();
      current.move();
      useEditorStore.getState().undo();
    });
    expect(useEditorStore.getState().dragState).toBeNull();
    const restored = snapshotHistoryEntry(useEditorStore.getState());
    const future = useEditorStore.getState().future;
    act(() => {
      current.move();
      current.finish();
      current.cancel();
    });
    expect(snapshotHistoryEntry(useEditorStore.getState())).toEqual(restored);
    expect(useEditorStore.getState().future).toBe(future);
    expect(useEditorStore.getState().dragState).toBeNull();
  });

  it("cannot clear or rollback a newer session's marker during stale cleanup", () => {
    const current = gesture("object");
    act(() => {
      current.start();
      current.move();
    });
    const changed = useEditorStore.getState().layers;
    let next: ReturnType<typeof beginLiveGesture>;
    act(() => {
      next = beginLiveGesture("newer-session");
      current.cancel();
    });
    expect(useEditorStore.getState().layers).toBe(changed);
    expect(ownsLiveGesture(next!)).toBe(true);
    act(() => endLiveGesture(next!));
    expect(useEditorStore.getState().dragState).toBeNull();
  });

  it("ignores secondary pointers during an artboard session", () => {
    act(() => artboard.start(0, 0, ["frame"]));
    const marker = useEditorStore.getState().dragState;
    act(() => {
      for (const type of ["pointermove", "pointerup", "pointercancel"]) {
        window.dispatchEvent(
          new PointerEvent(type, {
            clientX: 10,
            clientY: 5,
            pointerId: 2,
            isPrimary: false,
          }),
        );
      }
    });
    expect(useEditorStore.getState().dragState).toBe(marker);
    expect(useEditorStore.getState().history).toHaveLength(0);
    expect(useEditorStore.getState().frames[0]!.x).toBe(0);
    expect(artboard.isDragging).toBe(true);
    act(() => artboard.cancel());
    expect(useEditorStore.getState().dragState).toBeNull();
  });

  it.each(kinds)("releases a pending %s session when its hook unmounts", (kind) => {
    act(() => {
      gesture(kind).start();
    });
    rendered.unmount();
    rendered = undefined!;
    expect(useEditorStore.getState().dragState).toBeNull();
    expect(useEditorStore.getState().history).toHaveLength(0);
  });
});
