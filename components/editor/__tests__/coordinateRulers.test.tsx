// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { buildRulerTicks } from "../canvas/CoordinateRulers";

describe("coordinate ruler ticks", () => {
  it("uses the selected artboard origin for labels", () => {
    const ticks = buildRulerTicks(80, 80, 800, 100);
    const zero = ticks.find((tick) => tick.value === 0);

    expect(zero?.position).toBe(200);
    expect(zero?.major).toBe(true);
  });

  it("adapts density without producing an unbounded number of ticks", () => {
    const zoomedOut = buildRulerTicks(-5000, 10000, 1000, 0);
    const zoomedIn = buildRulerTicks(0, 10, 1000, 0);

    expect(zoomedOut.length).toBeLessThan(100);
    expect(zoomedIn.length).toBeLessThan(100);
    expect(zoomedIn.filter((tick) => tick.major).length).toBeGreaterThan(5);
  });
});
