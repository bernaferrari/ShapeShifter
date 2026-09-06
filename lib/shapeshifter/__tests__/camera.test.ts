import { describe, expect, it } from "vitest";
import {
  computeDetailViewport,
  computeFitViewport,
  computeGridSpec,
  computeGridVisibility,
  snapValueToStep,
  zoomAtWorldPoint,
} from "../camera";

describe("world camera utilities", () => {
  it("fits real content without falling back to legacy magic coordinates", () => {
    const viewport = computeFitViewport([{ x: 120, y: 80, w: 40, h: 20 }]);

    expect(viewport.x).toBeLessThanOrEqual(120);
    expect(viewport.y).toBeLessThanOrEqual(80);
    expect(viewport.x + viewport.w).toBeGreaterThanOrEqual(160);
    expect(viewport.y + viewport.h).toBeGreaterThanOrEqual(100);
    expect(viewport.w).toBeGreaterThan(viewport.h);
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

  it("fits imported Android geometry in viewport rather than intrinsic units", () => {
    const viewport = computeDetailViewport({
      width: 24,
      height: 24,
      viewportWidth: 48,
      viewportHeight: 48,
    });

    expect(viewport.x + viewport.w).toBeGreaterThanOrEqual(48);
    expect(viewport.y + viewport.h).toBeGreaterThanOrEqual(48);
  });

  it("derives an adaptive pixel grid from on-screen density", () => {
    // Moderate zoom: one world unit ~ 10 screen px → whole-pixel grid, majors at 4.
    const close = computeGridSpec(10);
    expect(close.minor).toBe(1);
    expect(close.major).toBe(4);

    // Hard zoom → sub-pixel minors appear, but majors emphasise whole pixels.
    const extreme = computeGridSpec(60);
    expect(extreme.minor).toBeLessThan(1);
    expect(extreme.major).toBe(1);

    // Zoomed out: minors grow (power-of-two) so cells stay comfortably visible.
    const far = computeGridSpec(0.5);
    expect(far.minor).toBeGreaterThanOrEqual(10);
    expect(far.major).toBe(far.minor * 4);

    // iOS-style 5/10/15 grid via custom divisions.
    const ios = computeGridSpec(10, { divisions: 5 });
    expect(ios.minor).toBe(1);
    expect(ios.major).toBe(5);
  });

  it("progressively reveals grid detail as the canvas zooms in", () => {
    expect(computeGridVisibility(1)).toEqual({ majorOpacity: 0, minorOpacity: 0 });

    const overview = computeGridVisibility(3);
    expect(overview.majorOpacity).toBeGreaterThan(0);
    expect(overview.minorOpacity).toBe(0);

    const pixelEditing = computeGridVisibility(10);
    expect(pixelEditing.majorOpacity).toBe(0.14);
    expect(pixelEditing.minorOpacity).toBe(0.07);
  });

  it("snaps to a step and scrubs floating-point dust", () => {
    expect(snapValueToStep(1.0000002, 1)).toBe(1);
    expect(snapValueToStep(2.3, 0.5)).toBe(2.5);
    expect(snapValueToStep(0.30000000004, 0.25)).toBe(0.25);
    // A zero/invalid step leaves the value untouched.
    expect(snapValueToStep(3.14159, 0)).toBe(3.14159);
  });
});
