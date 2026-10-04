// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parsePath } from "../pathDataIO";
class GeometryWorker {
  static instances: GeometryWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  requests: Array<{ id: number }> = [];
  constructor() {
    GeometryWorker.instances.push(this);
  }
  postMessage(request: { id: number }) {
    this.requests.push(request);
  }
  terminate() {
    this.terminated = true;
  }
  respond(index: number) {
    this.onmessage?.(
      new MessageEvent("message", { data: { id: this.requests[index]!.id, result: shape } }),
    );
  }
}
const shape = parsePath("M0 0H10V10H0Z");
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  GeometryWorker.instances = [];
  vi.stubGlobal("Worker", GeometryWorker);
});
afterEach(() => {
  GeometryWorker.instances.at(-1)?.onerror?.();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("Boolean worker transport", () => {
  it("returns traced geometry without importing canvas adapters into the main document", async () => {
    const { combineCurveAreasAsync } = await import("../curveBooleanClient");
    const pending = combineCurveAreasAsync("union", shape, shape, {});
    expect(GeometryWorker.instances).toHaveLength(1);
    GeometryWorker.instances[0]!.respond(0);
    expect(await pending).toEqual(shape);
  });
  it("rejects failed work, recreates its worker, and ignores callbacks from the previous generation", async () => {
    const { combineCurveAreasAsync } = await import("../curveBooleanClient");
    const first = combineCurveAreasAsync("union", shape, shape, {});
    const rejected = expect(first).rejects.toThrow("could not finish");
    const previous = GeometryWorker.instances[0]!;
    previous.onerror!();
    await rejected;
    expect(previous.terminated).toBe(true);
    const second = combineCurveAreasAsync("intersect", shape, shape, {});
    expect(GeometryWorker.instances).toHaveLength(2);
    previous.onerror!();
    previous.respond(0);
    expect(GeometryWorker.instances[1]!.terminated).toBe(false);
    GeometryWorker.instances[1]!.respond(0);
    expect(await second).toEqual(shape);
  });
  it("terminates an overlong trace without leaving unresolved pending requests", async () => {
    const { combineCurveAreasAsync } = await import("../curveBooleanClient");
    const pending = combineCurveAreasAsync("subtract", shape, shape, {});
    const rejected = expect(pending).rejects.toThrow("took too long");
    await vi.advanceTimersByTimeAsync(15000);
    await rejected;
    expect(GeometryWorker.instances[0]!.terminated).toBe(true);
  });
});
