import { afterEach, describe, expect, it, vi } from "vitest";
import { compileAndroidArtboard, type AndroidArtboardInput } from "../androidCompiler";
import { compileAndroidArtboardAsync, prepareForMorphAsync } from "../offthread";
import { parsePath, prepareForMorph } from "../pathUtils";
import type { Layer, PathData } from "../types";

function pathLayer(): Layer {
  const from = parsePath("M0 0 L10 0 L10 10 Z");
  return {
    id: "shape",
    name: "shape",
    type: "path",
    from,
    pathData: from,
    fillColor: "#000000",
    visible: true,
    locked: false,
  };
}

describe("offthread fallbacks", () => {
  it("compileAndroidArtboardAsync matches the shipped compiler", async () => {
    const input = {
      name: "icon",
      vector: { id: "v", name: "icon", width: 24, height: 24, alpha: 1 },
      layers: [pathLayer()],
      animation: { id: "m", name: "m", duration: 1, blocks: [] },
    };
    const asyncBundle = await compileAndroidArtboardAsync(input);
    const syncBundle = compileAndroidArtboard(input);
    expect(asyncBundle.resourceName).toBe(syncBundle.resourceName);
    expect(asyncBundle.files.map((file) => file.path)).toEqual(
      syncBundle.files.map((file) => file.path),
    );
    expect(asyncBundle.files[0]?.content).toBe(syncBundle.files[0]?.content);
  });

  it("prepareForMorphAsync matches prepareForMorph", async () => {
    const from = parsePath("M0 0 L10 10 Z");
    const to = parsePath("M1 1 L9 9 Z");
    const asyncResult = await prepareForMorphAsync(from, to);
    const syncResult = prepareForMorph(from, to);
    expect(asyncResult.mapping.alignments.kind).toBe(syncResult.mapping.alignments.kind);
    expect(asyncResult.from.subPaths.length).toBe(syncResult.from.subPaths.length);
  });
});

/**
 * Minimal fake of a module Worker so the real worker round-trip is testable in node.
 * Computes exactly what offthread.worker.ts would and answers asynchronously.
 */
type FakeRequestMessage = { id: number; kind: "compile" | "morph"; payload: unknown };

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  /** When true the worker swallows requests — models a hung/deadlocked worker.
   * Prototype-level so a test can wedge the class BEFORE any instance exists
   * (request() posts synchronously, leaving no window to flag a live instance). */
  declare silent: boolean;

  constructor() {
    FakeWorker.instances.push(this);
  }

  terminate() {
    this.terminated = true;
  }

  terminated = false;

  postMessage(message: FakeRequestMessage) {
    if (this.silent) return;
    queueMicrotask(() => {
      const morph = message.payload as { from: PathData; to: PathData };
      const result =
        message.kind === "compile"
          ? compileAndroidArtboard(message.payload as AndroidArtboardInput)
          : prepareForMorph(morph.from, morph.to);
      this.onmessage?.({ data: { id: message.id, ok: true, result } } as unknown as MessageEvent);
    });
  }
}

// Prototype-level default: instances must NOT shadow it with a class field, so a
// test can flip the flag before the first instance exists (see the wedged test).
FakeWorker.prototype.silent = false;

function installWorkerGlobal() {
  FakeWorker.instances = [];
  (globalThis as Record<string, unknown>).Worker = FakeWorker;
  (globalThis as Record<string, unknown>).window = {};
}

afterEach(() => {
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).Worker;
  delete (globalThis as Record<string, unknown>).window;
});

// The dynamic `await import("../offthread")` calls below are intentional: offthread.ts
// keeps its worker/pending registry as module singletons, so each test re-evaluates
// the module (vi.resetModules) against a freshly installed Worker global — something
// a static import binding cannot express.
describe("offthread worker round-trip", () => {
  it("resolves through a live worker and matches the sync path", async () => {
    installWorkerGlobal();
    const mod = await import("../offthread");
    const from = parsePath("M0 0 L10 10 Z");
    const to = parsePath("M1 1 L9 9 Z");

    const result = await mod.prepareForMorphAsync(from, to);
    const syncResult = prepareForMorph(from, to);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(result.from.subPaths.length).toBe(syncResult.from.subPaths.length);
    expect(result.mapping.alignments.kind).toBe(syncResult.mapping.alignments.kind);
  });

  it("rejects every pending request when the worker errors, then recovers", async () => {
    installWorkerGlobal();
    const mod = await import("../offthread");
    const from = parsePath("M0 0 L10 10 Z");
    const to = parsePath("M1 1 L9 9 Z");

    // Queue two requests before the failure so one error event covers both.
    const first = mod.prepareForMorphAsync(from, to);
    const second = mod.compileAndroidArtboardAsync({
      name: "icon",
      vector: { id: "v", name: "icon", width: 24, height: 24, alpha: 1 },
      layers: [pathLayer()],
      animation: { id: "m", name: "m", duration: 1, blocks: [] },
    });

    const broken = FakeWorker.instances[0]!;
    broken.postMessage = () => {}; // simulate a dead worker: no responses will come
    broken.onerror?.({} as ErrorEvent);

    await expect(first).rejects.toThrow(/worker failed/i);
    await expect(second).rejects.toThrow(/worker failed/i);

    // The dead worker was dropped; the next request rebuilds it (or falls back to
    // the synchronous path when reconstruction fails) instead of posting into the
    // void forever.
    const recovered = await mod.prepareForMorphAsync(from, to);
    const syncResult = prepareForMorph(from, to);
    expect(recovered.mapping.alignments.kind).toBe(syncResult.mapping.alignments.kind);
    expect(recovered.from.subPaths.length).toBe(syncResult.from.subPaths.length);
  });

  it("falls back to the synchronous path when Worker construction throws", async () => {
    installWorkerGlobal();
    (globalThis as Record<string, unknown>).Worker = class {
      constructor() {
        throw new Error("blocked by CSP");
      }
    };
    const mod = await import("../offthread");
    const from = parsePath("M0 0 L10 10 Z");
    const to = parsePath("M1 1 L9 9 Z");

    const result = await mod.prepareForMorphAsync(from, to);
    const syncResult = prepareForMorph(from, to);
    expect(result.mapping.alignments.kind).toBe(syncResult.mapping.alignments.kind);
  });

  it("rejects and terminates a wedged worker once the request deadline passes", async () => {
    vi.useFakeTimers();
    try {
      installWorkerGlobal();
      const mod = await import("../offthread");
      const from = parsePath("M0 0 L10 10 Z");
      const to = parsePath("M1 1 L9 9 Z");

      // request() posts to the worker synchronously, so the wedge must exist before
      // the first call — silence the prototype, then fire two requests.
      FakeWorker.prototype.silent = true;

      // Two in-flight requests; neither will ever be answered. Attach handlers now —
      // both promises reject inside advanceTimersByTimeAsync, before the asserts run.
      const settle = (promise: Promise<unknown>, name: string) =>
        promise.then(
          () => ({ name, message: "" }),
          (error: Error) => ({ name, message: error.message }),
        );
      const firstPromise = settle(mod.prepareForMorphAsync(from, to), "first");
      const secondPromise = settle(mod.prepareForMorphAsync(to, from), "second");
      const wedged = FakeWorker.instances[0]!;

      await vi.advanceTimersByTimeAsync(30_000);

      // The first deadline rejects its own request; the teardown broadcast then
      // rejects every other pending entry rather than leaving them hanging.
      expect((await firstPromise).message).toMatch(/timed out/i);
      expect((await secondPromise).message).toMatch(/worker failed/i);
      expect(wedged.terminated).toBe(true);

      // The wedged worker was dropped; a follow-up request rebuilds it and succeeds.
      FakeWorker.prototype.silent = false;
      const recovered = await mod.prepareForMorphAsync(from, to);
      expect(recovered.from.subPaths.length).toBeGreaterThan(0);
      expect(FakeWorker.instances).toHaveLength(2);
    } finally {
      FakeWorker.prototype.silent = false;
      vi.useRealTimers();
    }
  });
});
