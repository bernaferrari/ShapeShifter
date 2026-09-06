/**
 * Basic tests for Phase 1 gesture abstractions.
 */

import { describe, it, expect, vi } from "vitest";
import { GestureDispatcher } from "../gestures/GestureDispatcher";
import {
  hitTestSelectionBounds,
  hitTestRect,
  getMarqueeRect,
  collectPointsInRect,
  rectsIntersect,
  // 9rp real Lasso hit testing helpers (ShapeShifter-9rp / v6j)
  pointInPolygon,
  collectPointsInLasso,
} from "../gestures/HitTests";
import { ALL_TOOL_MODES, ALL_CURSORS } from "../toolModes";

describe("Phase 1 - Gesture Abstractions", () => {
  it("exports full ToolMode and CursorType sets", () => {
    expect(ALL_TOOL_MODES.length).toBeGreaterThan(8);
    expect(ALL_CURSORS.length).toBe(28);
  });

  it("hitTestSelectionBounds detects corner handles", () => {
    const bounds = { x: 10, y: 10, width: 20, height: 20 };
    const res = hitTestSelectionBounds({ x: 10, y: 10 }, bounds);
    expect(res?.type).toBe("selection-handle");
  });

  it("hitTestRect works for marquee selection", () => {
    const rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(hitTestRect({ x: 50, y: 50 }, rect)).toBe(true);
    expect(hitTestRect({ x: 150, y: 50 }, rect)).toBe(false);
  });
});

describe("PR-02 - Marquee / AABB Hit Tests (ShapeShifter-ubf / v6j)", () => {
  it("getMarqueeRect normalizes start/end correctly", () => {
    const r = getMarqueeRect({ x: 10, y: 20 }, { x: 5, y: 30 });
    expect(r.x).toBe(5);
    expect(r.y).toBe(20);
    expect(r.width).toBe(5);
    expect(r.height).toBe(10);
  });

  it("collectPointsInRect finds points inside rect and ignores outside", () => {
    const pathData = {
      subPaths: [
        {
          commands: [
            {
              points: [
                { x: 0, y: 0 },
                { x: 10, y: 10 },
              ],
            },
            { points: [{ x: 100, y: 100 }] },
          ],
        },
      ],
    };
    const rect = { x: 0, y: 0, width: 20, height: 20 };
    const hits = collectPointsInRect(pathData as any, rect);
    expect(hits.length).toBe(2);
    expect(hits[0]).toEqual({ subPathIndex: 0, commandIndex: 0, pointIndex: 0 });
    expect(hits[1]).toEqual({ subPathIndex: 0, commandIndex: 0, pointIndex: 1 });
  });

  it("rectsIntersect detects overlapping and non-overlapping rects", () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    expect(rectsIntersect(a, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
    expect(rectsIntersect(a, { x: 20, y: 20, width: 5, height: 5 })).toBe(false);
  });
});

describe("9rp - Real Lasso Hit Tests (ShapeShifter-9rp / v6j)", () => {
  // Import the new pure helpers (added for real Lasso polygon + curve tolerance)
  // These extend the PR-02 AABB collectPointsInRect pattern exactly.
  // Tests added as part of 9rp slice (real hit testing + collection refinement + keyboard parity).
  // References: DESIGN_ID 67dd105e, beads 9rp/ny0/ubf/v6j.
  it("pointInPolygon works for simple square", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false);
    expect(pointInPolygon({ x: -1, y: 5 }, square)).toBe(false);
  });

  it("pointInPolygon works for triangle and edge/vertex cases", () => {
    const tri = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 10 },
    ];
    expect(pointInPolygon({ x: 5, y: 3 }, tri)).toBe(true);
    // Boundary policy for real lasso (9rp): our even-odd raycast includes vertices and edge points
    // that the ray touches. This is intentional and desirable UX for a professional lasso tool
    // (user who draws a lasso that grazes or closes on a point expects it selected).
    // The helper is correct and performant. We document the policy explicitly.
    expect(pointInPolygon({ x: 0, y: 0 }, tri)).toBe(true);
    expect(pointInPolygon({ x: 5, y: 0 }, tri)).toBe(true); // edge touch — included per lasso UX policy
  });

  it("collectPointsInLasso finds anchors inside polygon and ignores outside (mirrors collectPointsInRect)", () => {
    const pathData = {
      subPaths: [
        {
          commands: [
            {
              points: [
                { x: 0, y: 0 },
                { x: 5, y: 5 },
              ],
            },
            { points: [{ x: 100, y: 100 }] },
          ],
        },
      ],
    };
    const lasso = [
      { x: -1, y: -1 },
      { x: 12, y: -1 },
      { x: 12, y: 12 },
      { x: -1, y: 12 },
    ];
    const hits = collectPointsInLasso(pathData as any, lasso);
    expect(hits.length).toBe(2);
    expect(hits[0]).toEqual({ subPathIndex: 0, commandIndex: 0, pointIndex: 0 });
    expect(hits[1]).toEqual({ subPathIndex: 0, commandIndex: 0, pointIndex: 1 });
  });

  it("collectPointsInLasso returns empty for degenerate lasso", () => {
    const pathData = { subPaths: [{ commands: [{ points: [{ x: 1, y: 1 }] }] }] };
    expect(
      collectPointsInLasso(pathData as any, [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ]),
    ).toEqual([]);
    expect(collectPointsInLasso(pathData as any, [])).toEqual([]);
  });

  // vn7 k88: perf/edge for lasso on long paths (RAF visual + collect target)
  it("collectPointsInLasso perf on long path + dense lasso (60fps proxy)", () => {
    const cmds = Array.from({ length: 200 }, (_, i) => ({
      points: [{ x: i % 50, y: (i % 30) * 0.5 }],
    }));
    const longPath = { subPaths: [{ commands: cmds }] };
    const dense = Array.from({ length: 120 }, (_, i) => ({ x: i * 0.4, y: i * 0.3 }));
    const t0 = performance.now();
    const hits = collectPointsInLasso(longPath as any, dense);
    const dt = performance.now() - t0;
    expect(dt).toBeLessThan(80); // exercises 9rp math path, RAF context
    expect(Array.isArray(hits)).toBe(true);
  });
});

describe("GestureDispatcher decision contract", () => {
  const modifiers = { shift: false, alt: false, ctrl: false };

  function makeCallbacks() {
    return {
      setCursor: vi.fn(),
      pushHistory: vi.fn(),
      beginMarqueeSelection: vi.fn(),
      updateMarquee: vi.fn(),
      endMarquee: vi.fn(),
      commitMarqueeSelection: vi.fn(),
    };
  }

  it("routes marquee intent to SelectDragItemsGesture and fires the begin callback", () => {
    const callbacks = makeCallbacks();
    const dispatcher = new GestureDispatcher(
      { toolMode: "select", editingSide: "from", snapToGrid: false, zoom: 1 },
      callbacks,
    );

    dispatcher.handlePointerDown({ x: 1, y: 2 }, { type: "marquee" }, modifiers);
    dispatcher.handlePointerUp({ x: 8, y: 9 }, modifiers);

    expect(callbacks.beginMarqueeSelection).toHaveBeenCalledWith({ x: 1, y: 2 }, false);
    expect(callbacks.commitMarqueeSelection).toHaveBeenCalledWith(
      { x: 1, y: 2 },
      { x: 8, y: 9 },
      false,
    );
  });

  it("treats null hit and empty hit as marquee intent; other tools start nothing", () => {
    for (const toolMode of ["select", "default"] as const) {
      for (const hit of [null, { type: "empty" as const }]) {
        const callbacks = makeCallbacks();
        const dispatcher = new GestureDispatcher(
          { toolMode, editingSide: "from", snapToGrid: false, zoom: 1 },
          callbacks,
        );
        dispatcher.handlePointerDown({ x: 0, y: 0 }, hit, modifiers);
        expect(callbacks.beginMarqueeSelection).toHaveBeenCalledTimes(1);
      }
    }

    // The non-marquee tools are NOT dispatched yet (implemented inline in the
    // canvas hooks) — pointer down on them must be a no-op, not a fake gesture.
    for (const toolMode of ["pen", "direct", "pencil", "paint", "rotate", "transform"] as const) {
      const callbacks = makeCallbacks();
      const dispatcher = new GestureDispatcher(
        { toolMode, editingSide: "from", snapToGrid: false, zoom: 1 },
        callbacks,
      );
      dispatcher.handlePointerDown({ x: 0, y: 0 }, { type: "marquee" }, modifiers);
      dispatcher.handlePointerMove({ x: 5, y: 5 }, modifiers);
      dispatcher.handlePointerUp({ x: 6, y: 6 }, modifiers);
      expect(callbacks.beginMarqueeSelection).not.toHaveBeenCalled();
      expect(callbacks.updateMarquee).not.toHaveBeenCalled();
      expect(callbacks.commitMarqueeSelection).not.toHaveBeenCalled();
    }
  });

  it("cancelActiveGesture ends any in-flight marquee visual and clears the gesture", () => {
    const callbacks = makeCallbacks();
    const dispatcher = new GestureDispatcher(
      { toolMode: "select", editingSide: "from", snapToGrid: false, zoom: 1 },
      callbacks,
    );

    dispatcher.handlePointerDown({ x: 0, y: 0 }, { type: "marquee" }, modifiers);
    dispatcher.cancelActiveGesture();

    expect(callbacks.endMarquee).toHaveBeenCalled();
    // After cancel, a pointer up has no active gesture to commit.
    dispatcher.handlePointerUp({ x: 4, y: 4 }, modifiers);
    expect(callbacks.commitMarqueeSelection).not.toHaveBeenCalled();
  });
});
