import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTOSAVE_DEBOUNCE_MS,
  createCoalescingAutosaveWriter,
  createDebouncedAutosaveScheduler,
  restoreStoredAutosave,
  sameAutosaveState,
  type AutosaveStateToken,
} from "../useDocumentAutosave";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("document autosave scheduling", () => {
  it("does not treat a user edit made during hydration as safe to overwrite", () => {
    const shared = {
      layers: [],
      animation: {},
      frames: [],
      vector: {},
      hiddenLayerIds: [],
      rootLayers: [],
      rootAnimation: {},
      rootHiddenLayerIds: [],
      selectedFrameId: "frame",
    } as unknown as AutosaveStateToken;
    const changed = { ...shared, layers: [] } as AutosaveStateToken;

    expect(sameAutosaveState(shared, shared)).toBe(true);
    expect(sameAutosaveState(shared, changed)).toBe(false);
  });

  it("does not write until hydration settles and skips an unchanged live flush", () => {
    vi.useFakeTimers();
    const snapshot = vi.fn(() => ({ version: 1, name: "restored" }));
    const enqueue = vi.fn();
    const scheduler = createDebouncedAutosaveScheduler({ snapshot, enqueue });

    scheduler.schedule();
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    expect(snapshot).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();

    scheduler.markHydrated();
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith({ version: 1, name: "restored" });

    // serializeLiveProject synchronizes the live owner, which can retrigger the
    // hook without changing the serialized document. That must not write again.
    scheduler.schedule();
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledTimes(1);

    scheduler.dispose();
  });

  it("preserves an unopenable stored payload instead of scheduling a replacement", () => {
    vi.useFakeTimers();
    const snapshot = vi.fn(() => ({ version: 1, name: "fresh-default" }));
    const enqueue = vi.fn();
    const restore = vi.fn(() => {
      throw new Error("unsupported native V2 document");
    });
    const scheduler = createDebouncedAutosaveScheduler({ snapshot, enqueue });

    expect(restoreStoredAutosave({ documentV2: { version: 2 } }, restore)).toBe("unrecoverable");
    scheduler.preserveStoredSnapshot();
    scheduler.schedule();
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS * 2);

    expect(snapshot).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(restore).toHaveBeenCalledOnce();

    // A later successful hydration can deliberately resume normal autosave.
    scheduler.markHydrated();
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    expect(enqueue).toHaveBeenCalledWith({ version: 1, name: "fresh-default" });

    scheduler.dispose();
  });
});

describe("coalescing autosave writes", () => {
  it("writes snapshots in order and makes the newest pending snapshot the final write", async () => {
    const firstWrite = deferred();
    const finalWrite = deferred();
    const writes: number[] = [];
    const writer = createCoalescingAutosaveWriter(async (revision: number) => {
      writes.push(revision);
      return writes.length === 1 ? firstWrite.promise : finalWrite.promise;
    });

    writer.enqueue(1);
    writer.enqueue(2);
    writer.enqueue(3);
    expect(writes).toEqual([1]);

    firstWrite.resolve();
    await flushMicrotasks();
    expect(writes).toEqual([1, 3]);

    finalWrite.resolve();
    await writer.whenIdle();
    expect(writes).toEqual([1, 3]);
  });
});
