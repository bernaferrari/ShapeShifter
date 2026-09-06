import { describe, expect, it } from "vitest";
import {
  vectorCoordinateRect,
  vectorCoordinateResizePatch,
  vectorCoordinateResizePolicy,
  vectorCoordinateSize,
  vectorFromPageMetadata,
} from "../vectorSpace";

describe("vector coordinate space", () => {
  it("uses Android viewport dimensions for editable geometry while retaining intrinsic metadata", () => {
    const vector = {
      width: 24,
      height: 18,
      viewportWidth: 48,
      viewportHeight: 36,
    };

    expect(vectorCoordinateSize(vector)).toEqual({ width: 48, height: 36 });
    expect(vectorCoordinateRect(vector)).toEqual({ w: 48, h: 36 });
    expect(vector.width).toBe(24);
    expect(vector.height).toBe(18);
  });

  it("falls back safely when imported viewport metadata is absent or invalid", () => {
    expect(vectorCoordinateSize({ width: 24, height: 12 })).toEqual({ width: 24, height: 12 });
    expect(
      vectorCoordinateSize({ width: 24, height: 12, viewportWidth: Number.NaN, viewportHeight: 0 }),
    ).toEqual({ width: 24, height: 12 });
  });

  it("keeps the initial resize policy for an entire legacy-vector drag", () => {
    const policy = vectorCoordinateResizePolicy({});
    expect(vectorCoordinateResizePatch(30, 20, policy)).toEqual({
      viewportWidth: 30,
      viewportHeight: 20,
      width: 30,
      height: 20,
    });
    // The second event must still mirror intrinsic dimensions even though the
    // first event has already added viewport metadata to the live vector.
    expect(vectorCoordinateResizePatch(42, 28, policy)).toEqual({
      viewportWidth: 42,
      viewportHeight: 28,
      width: 42,
      height: 28,
    });
  });

  it("preserves an imported intrinsic-to-viewport ratio during resize", () => {
    const policy = vectorCoordinateResizePolicy({ viewportWidth: 48, viewportHeight: 36 });
    expect(vectorCoordinateResizePatch(60, 45, policy)).toEqual({
      viewportWidth: 60,
      viewportHeight: 45,
    });
  });

  it("maps every page metadata field into an editable root vector", () => {
    expect(
      vectorFromPageMetadata(
        {
          name: "Page",
          width: 24,
          height: 18,
          alpha: 0.5,
          viewportWidth: 48,
          viewportHeight: 36,
          widthUnit: "dp",
          heightUnit: "px",
          tint: "#ffffff",
          tintMode: "src_in",
          autoMirrored: true,
          minSdk: 24,
        },
        "root",
      ),
    ).toMatchObject({ id: "root", viewportWidth: 48, viewportHeight: 36, minSdk: 24 });
  });
});
