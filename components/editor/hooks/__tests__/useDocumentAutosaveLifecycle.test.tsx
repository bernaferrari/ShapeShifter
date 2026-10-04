// @vitest-environment happy-dom

import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorStore } from "@/lib/store/editorStore";
import {
  AUTOSAVE_DEBOUNCE_MS,
  useDocumentAutosave,
  type DocumentAutosave,
} from "../useDocumentAutosave";

interface PendingTransaction {
  payload: unknown;
  complete(): void;
  fail(): void;
}

function createIndexedDbHarness() {
  const writes: PendingTransaction[] = [];
  const records = new Map<string, unknown>();
  const db = {
    close: vi.fn(),
    transaction(_name: string, mode: string) {
      const pending = new Map<string, unknown>();
      const tx = {
        error: new Error("Storage quota exceeded"),
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onabort: null as (() => void) | null,
        abort() {
          queueMicrotask(() => tx.onabort?.());
        },
        objectStore() {
          return {
            get(key: string) {
              const request = { result: null as unknown, onsuccess: null as (() => void) | null };
              queueMicrotask(() => {
                request.result = records.get(key) ?? null;
                request.onsuccess?.();
              });
              return request;
            },
            put(payload: unknown, key: string) {
              if (mode !== "readwrite") throw new Error("Unexpected transaction mode");
              pending.set(key, payload);
              if (key !== "document") return;
              writes.push({
                payload,
                complete: () => {
                  for (const [key, value] of pending) records.set(key, value);
                  tx.oncomplete?.();
                },
                fail: () => tx.onerror?.(),
              });
            },
          };
        },
      };
      return tx;
    },
  };
  return {
    writes,
    records,
    indexedDB: {
      open() {
        const request = { result: db, onsuccess: null as (() => void) | null };
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
    },
  };
}

async function settle() {
  for (let index = 0; index < 12; index++) await Promise.resolve();
}

let root: Root;
let container: HTMLDivElement;
let latest: DocumentAutosave;
let storage: ReturnType<typeof createIndexedDbHarness>;

function Probe() {
  latest = useDocumentAutosave();
  return null;
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  storage = createIndexedDbHarness();
  vi.stubGlobal("indexedDB", storage.indexedDB);
  useEditorStore.getState().resetProject();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await React.act(async () => {
    root.render(<Probe />);
    await settle();
  });
});

afterEach(async () => {
  await React.act(async () => {
    root.unmount();
    // Let queued cleanup writes complete before removing the database stub.
    for (let index = 0; index < 3; index++) {
      storage.writes.forEach((write) => write.complete());
      await settle();
    }
  });
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("autosave lifecycle and truthful status", () => {
  it("resumes autosave after restoring a checkpoint and retains the newer disk copy", async () => {
    await import("@/components/editor/project/useProjectImport");
    await React.act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await settle();
      storage.writes[0]!.complete();
      await settle();
    });
    const checkpoint = storage.writes[0]!.payload;
    const external = { ...(checkpoint as object), externalRevision: "newer" };
    const previousCheckpointTime = Date.now();
    storage.records.set("document", external);
    storage.records.set("recovery-history", [{ savedAt: Date.now(), payload: checkpoint }]);
    await React.act(async () => {
      useEditorStore.getState().addLayer("path");
      await settle();
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await settle();
    });
    expect(latest.status).toBe("conflict");
    const historyLength = useEditorStore.getState().history.length;
    let restoration: Promise<void>;
    await React.act(async () => {
      restoration = latest.restoreCheckpoint(checkpoint);
      await settle();
    });
    expect(storage.writes).toHaveLength(2);
    await React.act(async () => {
      storage.writes[1]!.complete();
      await restoration!;
      await settle();
    });
    expect(latest.status).toBe("saved");
    expect(useEditorStore.getState().history).toHaveLength(historyLength + 1);
    expect(storage.records.get("recovery-history")).toEqual([
      { savedAt: Date.now(), payload: external },
      { savedAt: previousCheckpointTime, payload: checkpoint },
    ]);
    await React.act(async () => {
      useEditorStore.getState().addLayer("path");
      await settle();
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await settle();
    });
    expect(storage.writes).toHaveLength(3);
  });
  it("preserves the newer stored document when another tab saves first", async () => {
    await React.act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await settle();
      storage.writes[0]!.complete();
      await settle();
    });
    const external = { document: "newer external save" };
    storage.records.set("document", external);
    await React.act(async () => {
      useEditorStore.getState().addLayer("path");
      await settle();
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await settle();
    });
    expect(latest.status).toBe("conflict");
    expect(storage.records.get("document")).toBe(external);
    expect(storage.writes).toHaveLength(1);
    await React.act(async () => {
      latest.retry();
      await settle();
    });
    expect(storage.writes).toHaveLength(1);
  });
  it("keeps saving while a transaction is pending, and while a newer edit awaits capture", async () => {
    await React.act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await settle();
    });
    expect(storage.writes).toHaveLength(1);
    expect(latest.status).toBe("saving");
    expect(latest.savedAt).toBeNull();

    await React.act(async () => {
      useEditorStore.getState().addLayer("path");
      await settle();
      storage.writes[0]!.complete();
      await settle();
    });
    expect(latest.status).toBe("saving");

    await React.act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await settle();
      storage.writes[1]!.complete();
      await settle();
    });
    expect(latest.status).toBe("saved");
    expect(latest.savedAt).toBeTypeOf("number");
  });

  it("shows failure and allows an explicit retry of the same document", async () => {
    await React.act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await settle();
      storage.writes[0]!.fail();
      await settle();
    });
    expect(latest.status).toBe("error");
    expect(latest.error).toBe("Storage quota exceeded");
    expect(latest.savedAt).toBeNull();

    await React.act(async () => {
      latest.retry();
      await settle();
    });
    expect(storage.writes).toHaveLength(2);
    expect(latest.status).toBe("saving");
    await React.act(async () => {
      storage.writes[1]!.complete();
      await settle();
    });
    expect(latest.status).toBe("saved");
    expect(latest.error).toBeNull();
  });

  it("recognizes a completed save after an unchanged lifecycle flush replaced owner projections", async () => {
    await React.act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await settle();
      window.dispatchEvent(new Event("pagehide"));
      await settle();
    });
    expect(storage.writes).toHaveLength(1);
    expect(latest.status).toBe("saving");
    await React.act(async () => {
      storage.writes[0]!.complete();
      await settle();
    });
    expect(latest.status).toBe("saved");
  });

  it("captures edits on pagehide before the debounce expires", async () => {
    expect(storage.writes).toHaveLength(0);
    await React.act(async () => {
      window.dispatchEvent(new Event("pagehide"));
      await settle();
    });
    expect(storage.writes).toHaveLength(1);
    await React.act(async () => {
      storage.writes[0]!.complete();
      await settle();
    });
    expect(latest.status).toBe("saved");
  });

  it("flushes when the document becomes hidden and on editor cleanup", async () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await React.act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await settle();
      storage.writes[0]!.complete();
      await settle();
    });
    expect(latest.status).toBe("saved");
    await React.act(async () => {
      useEditorStore.getState().addLayer("path");
      await settle();
      root.unmount();
      await settle();
    });
    expect(storage.writes).toHaveLength(2);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });
});
