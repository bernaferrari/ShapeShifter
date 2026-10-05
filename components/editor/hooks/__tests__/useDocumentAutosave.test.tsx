import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTOSAVE_DEBOUNCE_MS,
  autosaveSignature,
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
  it("includes durable endpoint and authored geometry identities in save equality", () => {
    const payload = (generatedId: string, authoredId: string) => ({
      document: {
        keyframes: { start: { segmentId: "morph", geometryVersionId: "endpoint" } },
        geometryVersions: {
          endpoint: {
            pathData: {
              subPaths: [{ commands: [{ id: generatedId, type: "M", points: [{ x: 0, y: 0 }] }] }],
            },
          },
          authored: {
            pathData: {
              subPaths: [{ commands: [{ id: authoredId, type: "M", points: [{ x: 0, y: 0 }] }] }],
            },
          },
        },
      },
    });
    const first = payload("generated-1", "authored-1");
    expect(autosaveSignature(first)).toBe(autosaveSignature(payload("generated-1", "authored-1")));
    expect(autosaveSignature(first)).not.toBe(
      autosaveSignature(payload("generated-2", "authored-1")),
    );
    expect(autosaveSignature(first)).not.toBe(
      autosaveSignature(payload("generated-1", "authored-2")),
    );
    expect(first.document.geometryVersions.endpoint.pathData.subPaths[0]!.commands[0]!.id).toBe(
      "generated-1",
    );
  });
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

    expect(restoreStoredAutosave({ document: { version: 2 } }, restore)).toBe("unrecoverable");
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

  it("flushes pending edits immediately and cancels the delayed duplicate", () => {
    vi.useFakeTimers();
    let revision = 1;
    const enqueue = vi.fn();
    const scheduler = createDebouncedAutosaveScheduler({ snapshot: () => ({ revision }), enqueue });
    scheduler.markHydrated();
    scheduler.flush();
    expect(enqueue).toHaveBeenLastCalledWith({ revision: 1 });

    revision = 2;
    scheduler.schedule();
    scheduler.flush();
    expect(enqueue).toHaveBeenLastCalledWith({ revision: 2 });
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    expect(enqueue).toHaveBeenCalledTimes(2);
    scheduler.dispose();
  });

  it("allows an explicit retry of an unchanged snapshot without bypassing recovery preservation", () => {
    const enqueue = vi.fn();
    const scheduler = createDebouncedAutosaveScheduler({
      snapshot: () => ({ revision: 1 }),
      enqueue,
    });
    scheduler.markHydrated();
    scheduler.flush();
    scheduler.flush();
    expect(enqueue).toHaveBeenCalledOnce();
    scheduler.flush({ force: true });
    expect(enqueue).toHaveBeenCalledTimes(2);

    scheduler.preserveStoredSnapshot();
    scheduler.flush({ force: true });
    expect(enqueue).toHaveBeenCalledTimes(2);
    scheduler.dispose();
  });
});

describe("coalescing autosave writes", () => {
  it("reports success only after the transaction completes", async () => {
    const transaction = deferred();
    const onSuccess = vi.fn();
    const writer = createCoalescingAutosaveWriter(() => transaction.promise, { onSuccess });
    writer.enqueue(1);
    expect(onSuccess).not.toHaveBeenCalled();
    transaction.resolve();
    await writer.whenIdle();
    expect(onSuccess).toHaveBeenCalledWith(1);
  });

  it("reports a failed transaction and remains usable for a later retry", async () => {
    const failure = new Error("Quota exceeded");
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const write = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(undefined);
    const writer = createCoalescingAutosaveWriter(write, { onSuccess, onError });
    writer.enqueue(1);
    await writer.whenIdle();
    expect(onError).toHaveBeenCalledWith(failure, 1);
    expect(onSuccess).not.toHaveBeenCalled();

    writer.enqueue(1);
    await writer.whenIdle();
    expect(onSuccess).toHaveBeenCalledWith(1);
    expect(write).toHaveBeenCalledTimes(2);
  });
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
