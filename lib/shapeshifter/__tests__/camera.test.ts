import { describe, expect, it } from "vitest";
import { computeDetailViewport, computeFitViewport, zoomAtWorldPoint } from "../camera";

describe("world camera utilities", () => {
  it("fits real content without falling back to legacy magic coordinates", () => {
    const viewport = computeFitViewport([{ x: 120, y: 80, w: 40, h: 20 }]);

    expect(viewport.x).toBeLessThanOrEqual(120);
    expect(viewport.y).toBeLessThanOrEqual(80);
    expect(viewport.x + viewport.w).toBeGreaterThanOrEqual(160);
    expect(viewport.y + viewport.h).toBeGreaterThanOrEqual(100);
    expect(viewport.w).toBe(viewport.h);
    expect(viewport).not.toEqual({ x: -80, y: -80, w: 320, h: 320, scale: 1 });
  });

  it("zooms around the focal point without moving that point under the cursor", () => {
    const viewport = { x: 0, y: 0, w: 100, h: 100, scale: 1 };
    const focal = { x: 25, y: 75 };
    const zoomed = zoomAtWorldPoint(viewport, focal, 2);

    const focalRatioXBefore = (focal.x - viewport.x) / viewport.w;
    const focalRatioYBefore = (focal.y - viewport.y) / viewport.h;
    const focalRatioXAfter = (focal.x - zoomed.x) / zoomed.w;
    const focalRatioYAfter = (focal.y - zoomed.y) / zoomed.h;

    expect(zoomed.scale).toBe(2);
    expect(zoomed.w).toBe(50);
    expect(zoomed.h).toBe(50);
    expect(focalRatioXAfter).toBeCloseTo(focalRatioXBefore, 6);
    expect(focalRatioYAfter).toBeCloseTo(focalRatioYBefore, 6);
  });

  it("computes the shared detail canvas fit from vector dimensions", () => {
    const viewport = computeDetailViewport({ width: 48, height: 24 });
    const zoomed = computeDetailViewport({ width: 48, height: 24 }, 2);

    expect(viewport.scale).toBe(1);
    expect(viewport.w).toBe(viewport.h);
    expect(viewport.x).toBeLessThanOrEqual(0);
    expect(viewport.y).toBeLessThanOrEqual(0);
    expect(viewport.x + viewport.w).toBeGreaterThanOrEqual(48);
    expect(viewport.y + viewport.h).toBeGreaterThanOrEqual(24);
    expect(zoomed.scale).toBe(2);
    expect(zoomed.w).toBeCloseTo(viewport.w / 2);
  });
});
