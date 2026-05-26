/**
 * Basic tests for Phase 1 gesture abstractions.
 */

import { describe, it, expect } from "vitest";
import { hitTestSelectionBounds, hitTestRect } from "../gestures/HitTests";
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
