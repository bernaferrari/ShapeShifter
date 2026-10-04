import { describe, expect, it } from "vitest";
import { evaluateInterpolator } from "../../interpolators";
import { numberAtTime } from "../../playheadResolve";
import type { Layer, TimelineBlock } from "../../types";
import {
  buildMotionValueGraph,
  canGraphMotionSegment,
  formatMotionGraphNumber,
  motionGraphUnit,
  type NumericMotionSegment,
} from "../motionValueGraph";

const block: TimelineBlock = {
  id: "segment",
  layerId: "shape",
  propertyName: "rotation",
  type: "number",
  startTime: 125,
  endTime: 2125,
  fromValue: 10,
  toValue: 90,
  interpolator: "LINEAR",
};

const layer: Layer = {
  id: "shape",
  name: "Shape",
  type: "group",
  from: { subPaths: [] },
  visible: true,
  locked: false,
};

describe("numeric motion value and velocity sampling", () => {
  it("shows linear rotation at constant degrees per second, including endpoints", () => {
    const data = buildMotionValueGraph(block)!;
    expect(data.unit).toEqual({ multiplier: 1, value: "°", velocity: "°/s" });
    expect(data.durationMs).toBe(2000);
    expect(data.samples[0]).toMatchObject({ timeMs: 125, value: 10 });
    expect(data.samples.at(-1)).toMatchObject({ timeMs: 2125, value: 90 });
    expect(data.samples[40]).toMatchObject({ timeMs: 1125, progress: 0.5, value: 50 });
    for (const sample of data.samples) expect(sample.velocity).toBeCloseTo(40, 8);
    expect(data.velocityAxis).toMatchObject({ min: 0, max: 40 });
  });

  it.each([
    "scaleX",
    "scaleY",
    "alpha",
    "fillAlpha",
    "strokeAlpha",
    "trimPathStart",
    "trimPathEnd",
    "trimPathOffset",
  ])("matches percentage endpoint units for %s and uses duration in seconds", (propertyName) => {
    const data = buildMotionValueGraph({
      ...block,
      propertyName,
      fromValue: 0.5,
      toValue: 1.5,
      endTime: 625,
    })!;
    expect(data.unit).toEqual({ multiplier: 100, value: "%", velocity: "%/s" });
    expect(data.from).toBe(50);
    expect(data.to).toBe(150);
    expect(data.samples[40].value).toBe(100);
    for (const sample of data.samples) expect(sample.velocity).toBeCloseTo(200, 7);
  });

  it.each(["translateX", "translateY", "pivotX", "pivotY", "strokeWidth"])(
    "uses viewport units for %s",
    (propertyName) => {
      const data = buildMotionValueGraph({
        ...block,
        propertyName,
        fromValue: 5,
        toValue: 17,
        endTime: 1625,
      })!;
      expect(data.unit.value).toBe("units");
      expect(data.unit.velocity).toBe("units/s");
      for (const sample of data.samples) expect(sample.velocity).toBeCloseTo(8, 8);
    },
  );

  it("preserves negative motion and includes the zero velocity baseline", () => {
    const data = buildMotionValueGraph({ ...block, fromValue: 100, toValue: 0, endTime: 1125 })!;
    for (const sample of data.samples) expect(sample.velocity).toBeCloseTo(-100, 7);
    expect(data.velocityAxis.min).toBeLessThanOrEqual(-100);
    expect(data.velocityAxis.max).toBe(0);
  });

  it("matches shared custom easing and playback, including overshoot and reversal", () => {
    const custom = { ...block, interpolator: "cubic-bezier(0.3, 1.4, 0.5, 1.2)" };
    const data = buildMotionValueGraph(custom)!;
    for (const sample of data.samples) {
      expect(sample.value).toBeCloseTo(
        10 + 80 * evaluateInterpolator(sample.progress, custom.interpolator),
        10,
      );
      expect(sample.value).toBeCloseTo(
        numberAtTime(layer, [custom], "rotation", sample.timeMs, 2500),
        8,
      );
    }
    const highest = Math.max(...data.samples.map((sample) => sample.value));
    expect(highest).toBeGreaterThan(data.to);
    expect(data.valueAxis.max).toBeGreaterThanOrEqual(highest);
    expect(data.samples.some((sample) => sample.velocity < 0)).toBe(true);
    expect(data.velocityAxis.min).toBeLessThan(0);
  });

  it.each([undefined, "ACCELERATE_DECELERATE"])(
    "samples the actual cosine values and velocity for %s",
    (interpolator) => {
      const data = buildMotionValueGraph({ ...block, interpolator })!;
      for (const index of [0, 20, 40, 60, 80]) {
        const sample = data.samples[index];
        expect(sample.value).toBeCloseTo(
          10 + (80 * (1 - Math.cos(Math.PI * sample.progress))) / 2,
          10,
        );
        expect(sample.velocity).toBeCloseTo(
          ((40 * Math.PI) / 2) * Math.sin(Math.PI * sample.progress),
          5,
        );
      }
    },
  );

  it("retains fractional timing and derives speed from the exact segment span", () => {
    const data = buildMotionValueGraph({ ...block, startTime: 137.375, endTime: 637.625 })!;
    expect(data.durationMs).toBe(500.25);
    expect(data.samples[40].timeMs).toBe(387.5);
    expect(data.samples[40].velocity).toBeCloseTo(80 / 0.50025, 8);
  });

  it("keeps constant values legible with finite axes and zero speed", () => {
    const data = buildMotionValueGraph({ ...block, fromValue: 12.375, toValue: 12.375 })!;
    expect(data.samples.every((sample) => sample.value === 12.375 && sample.velocity === 0)).toBe(
      true,
    );
    for (const axis of [data.valueAxis, data.velocityAxis]) {
      expect(Number.isFinite(axis.min) && Number.isFinite(axis.max)).toBe(true);
      expect(axis.max).toBeGreaterThan(axis.min);
      expect(axis.ticks.length).toBeGreaterThan(1);
    }
  });

  it.each([
    { type: "color", fromValue: 0, toValue: 1 },
    { type: "path", fromValue: 0, toValue: 1 },
    { propertyName: "fillColor", fromValue: 0, toValue: 1 },
    { propertyName: "pathData", fromValue: 0, toValue: 1 },
    { fromValue: "" },
    { fromValue: "-" },
    { toValue: Infinity },
    { propertyName: "alpha", toValue: 1e308 },
    { fromValue: -1e308, toValue: 1e308 },
    { startTime: -1e308, endTime: 1e308 },
    { startTime: 0, endTime: Number.MIN_VALUE },
    { endTime: NaN },
    { endTime: 125 },
    { endTime: 100 },
  ] satisfies Partial<NumericMotionSegment>[])(
    "does not imply numeric motion for invalid or nonnumeric data: %s",
    (patch) => {
      expect(canGraphMotionSegment({ ...block, ...patch })).toBe(false);
      expect(buildMotionValueGraph({ ...block, ...patch })).toBeNull();
    },
  );

  it("rejects nonfinite sampled curves and axes without returning NaN coordinates", () => {
    const hugeCoordinate = `1${"0".repeat(308)}`;
    expect(
      buildMotionValueGraph({
        ...block,
        interpolator: `cubic-bezier(0.3, ${hugeCoordinate}, 0.5, ${hugeCoordinate})`,
      }),
    ).toBeNull();
    expect(buildMotionValueGraph({ ...block, fromValue: 1.75e308, toValue: 1.75e308 })).toBeNull();
  });

  it("formats compact axes without negative zero or extreme value overflow", () => {
    expect(formatMotionGraphNumber(-1e-12)).toBe("0");
    expect(formatMotionGraphNumber(12.375)).toBe("12.38");
    expect(formatMotionGraphNumber(1e7)).toBe("1e+7");
    expect(formatMotionGraphNumber(0.00005)).toBe("5e-5");
    expect(motionGraphUnit("rotation").value).toBe("°");
  });
});
