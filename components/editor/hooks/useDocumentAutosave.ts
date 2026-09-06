"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { serializeLiveProject } from "@/lib/store/exportDocument";
import { useEditorStore } from "@/lib/store/editorStore";

const DB_NAME = "shapeshifter";
const STORE_NAME = "autosave";
const KEY = "document";
export const AUTOSAVE_DEBOUNCE_MS = 400;

type AutosaveState = ReturnType<typeof useEditorStore.getState>;
export type AutosaveStateToken = Pick<
  AutosaveState,
  | "layers"
  | "animation"
  | "frames"
  | "vector"
  | "hiddenLayerIds"
  | "rootLayers"
  | "rootAnimation"
  | "rootHiddenLayerIds"
  | "selectedFrameId"
  | "documentV2"
>;

function autosaveStateToken(state: AutosaveState): AutosaveStateToken {
  return {
    layers: state.layers,
    animation: state.animation,
    frames: state.frames,
    vector: state.vector,
    hiddenLayerIds: state.hiddenLayerIds,
    rootLayers: state.rootLayers,
    rootAnimation: state.rootAnimation,
    rootHiddenLayerIds: state.rootHiddenLayerIds,
    selectedFrameId: state.selectedFrameId,
    documentV2: state.documentV2,
  };
}

export function sameAutosaveState(
  left: AutosaveStateToken | null,
  right: AutosaveStateToken,
): boolean {
  return (
    left !== null &&
    left.layers === right.layers &&
    left.animation === right.animation &&
    left.frames === right.frames &&
    left.vector === right.vector &&
    left.hiddenLayerIds === right.hiddenLayerIds &&
    left.rootLayers === right.rootLayers &&
    left.rootAnimation === right.rootAnimation &&
    left.rootHiddenLayerIds === right.rootHiddenLayerIds &&
    left.selectedFrameId === right.selectedFrameId &&
    left.documentV2 === right.documentV2
  );
}

export interface CoalescingAutosaveWriter<T> {
  enqueue(value: T): void;
  whenIdle(): Promise<void>;
}

/**
 * Run at most one write at a time and retain only the most recent pending snapshot.
 * This keeps a slow IndexedDB transaction from committing after a newer snapshot.
 */
export function createCoalescingAutosaveWriter<T>(
  write: (value: T) => Promise<void>,
): CoalescingAutosaveWriter<T> {
  let pending: { value: T } | null = null;
  let active: Promise<void> | null = null;

  const drain = () => {
    if (active) return;
    active = (async () => {
      while (pending) {
        const next = pending;
        pending = null;
        try {
          await write(next.value);
        } catch {
          // Quota / private mode — keep the editor usable and try a later snapshot.
        }
      }
    })().finally(() => {
      active = null;
      if (pending) drain();
    });
  };

  return {
    enqueue(value) {
      pending = { value };
      drain();
    },
    async whenIdle() {
      while (active) await active;
    },
  };
}

export interface DebouncedAutosaveScheduler {
  markHydrated(): void;
  /**
   * Keep a stored snapshot intact when it could not be opened. Automatic writes
   * remain paused for this session instead of replacing the only recovery copy.
   */
  preserveStoredSnapshot(): void;
  schedule(): void;
  dispose(): void;
}

/**
 * Defer every initial write until hydration settles, then debounce and deduplicate
 * snapshots. The duplicate guard is important because flushing a live project also
 * synchronizes the active owner in the Zustand store.
 */
export function createDebouncedAutosaveScheduler(options: {
  snapshot: () => unknown;
  enqueue: (payload: unknown) => void;
  delay?: number;
}): DebouncedAutosaveScheduler {
  const delay = options.delay ?? AUTOSAVE_DEBOUNCE_MS;
  let hydrated = false;
  let disposed = false;
  let preserveStoredSnapshot = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastEnqueuedSignature: string | null = null;

  const clearTimer = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const capture = () => {
    timer = null;
    if (!hydrated || disposed || preserveStoredSnapshot) return;
    try {
      const payload = options.snapshot();
      const signature = JSON.stringify(payload);
      if (typeof signature !== "string" || signature === lastEnqueuedSignature) return;
      lastEnqueuedSignature = signature;
      options.enqueue(payload);
    } catch {
      // A corrupt live snapshot should never make the editor unusable.
    }
  };

  const schedule = () => {
    if (!hydrated || disposed || preserveStoredSnapshot) return;
    clearTimer();
    timer = setTimeout(capture, delay);
  };

  return {
    markHydrated() {
      // React development Strict Mode replays effect cleanup/setup. A fresh
      // hydration pass may therefore resume a scheduler that its first cleanup
      // disposed before the read completed.
      disposed = false;
      preserveStoredSnapshot = false;
      hydrated = true;
      schedule();
    },
    preserveStoredSnapshot() {
      // This can run after Strict Mode's first effect cleanup. Keep the same
      // scheduler instance paused when the second, live effect observes the
      // malformed payload too.
      disposed = false;
      hydrated = true;
      preserveStoredSnapshot = true;
      clearTimer();
    },
    schedule,
    dispose() {
      disposed = true;
      clearTimer();
    },
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function writeAutosave(payload: unknown) {
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(payload, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db?.close();
  }
}

export async function readAutosave(): Promise<unknown | null> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    const value = await new Promise<unknown>((resolve, reject) => {
      const tx = db!.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(KEY);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
      tx.onabort = () => reject(tx.error);
    });
    return value ?? null;
  } finally {
    db?.close();
  }
}

const autosaveWriter = createCoalescingAutosaveWriter(writeAutosave);

function autosaveText(payload: unknown): string | null {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return null;
  return JSON.stringify(payload);
}

export type AutosaveRestoreResult = "empty" | "restored" | "unrecoverable";

/**
 * Classify a stored payload without ever turning a bad restore into a fresh
 * document. The caller uses `unrecoverable` to pause writes and preserve the
 * original IndexedDB record for recovery.
 */
export function restoreStoredAutosave(
  payload: unknown | null,
  restore: (text: string) => void,
): AutosaveRestoreResult {
  if (payload === null) return "empty";
  try {
    const text = autosaveText(payload);
    if (!text) return "unrecoverable";
    restore(text);
    return "restored";
  } catch {
    return "unrecoverable";
  }
}

/** A restored document is the initial undo baseline, never an undoable user action. */
function discardHydrationHistory() {
  useEditorStore.setState({
    history: [],
    future: [],
    historyOverflow: null,
    canUndo: false,
    canRedo: false,
  });
}

/** Debounced IndexedDB write of the flushed live project. */
export function useDocumentAutosave() {
  const layers = useEditorStore((state) => state.layers);
  const animation = useEditorStore((state) => state.animation);
  const frames = useEditorStore((state) => state.frames);
  const vector = useEditorStore((state) => state.vector);
  const hiddenLayerIds = useEditorStore((state) => state.hiddenLayerIds);
  const rootLayers = useEditorStore((state) => state.rootLayers);
  const rootAnimation = useEditorStore((state) => state.rootAnimation);
  const rootHiddenLayerIds = useEditorStore((state) => state.rootHiddenLayerIds);
  const selectedFrameId = useEditorStore((state) => state.selectedFrameId);
  const documentV2 = useEditorStore((state) => state.documentV2);
  const lastFlushedState = useRef<AutosaveStateToken | null>(null);
  const schedulerRef = useRef<DebouncedAutosaveScheduler | null>(null);
  const recoveryNoticeShown = useRef(false);

  if (!schedulerRef.current) {
    schedulerRef.current = createDebouncedAutosaveScheduler({
      snapshot: () => {
        const payload = serializeLiveProject();
        lastFlushedState.current = autosaveStateToken(useEditorStore.getState());
        return payload;
      },
      enqueue: (payload) => autosaveWriter.enqueue(payload),
    });
  }

  const scheduler = schedulerRef.current;

  useEffect(() => {
    let cancelled = false;
    let preserveStoredSnapshot = false;
    let attemptedRestore = false;
    // Do not restore an old IndexedDB payload over a document the user changed
    // while the asynchronous read was pending.
    const hydrationStart = autosaveStateToken(useEditorStore.getState());
    void (async () => {
      try {
        const payload = await readAutosave();
        if (
          !cancelled &&
          payload !== null &&
          sameAutosaveState(hydrationStart, autosaveStateToken(useEditorStore.getState()))
        ) {
          const { importEditorText } = await import("@/components/editor/project/useProjectImport");
          if (
            cancelled ||
            !sameAutosaveState(hydrationStart, autosaveStateToken(useEditorStore.getState()))
          )
            return;
          attemptedRestore = true;
          const result = restoreStoredAutosave(payload, (text) =>
            importEditorText("autosave.shapeshifter", text),
          );
          if (result === "restored") discardHydrationHistory();
          else preserveStoredSnapshot = true;
        }
      } catch {
        // A failed read or import may still leave a recoverable payload in
        // IndexedDB. Do not allow the fresh workspace to overwrite it.
        preserveStoredSnapshot =
          !cancelled &&
          (attemptedRestore ||
            sameAutosaveState(hydrationStart, autosaveStateToken(useEditorStore.getState())));
      } finally {
        if (!cancelled) {
          if (preserveStoredSnapshot) {
            scheduler.preserveStoredSnapshot();
            if (!recoveryNoticeShown.current) {
              recoveryNoticeShown.current = true;
              toast.warning("Autosave preserved for recovery", {
                description:
                  "It could not be restored, so automatic saves are paused for this session.",
              });
            }
          } else {
            scheduler.markHydrated();
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scheduler]);

  useEffect(() => {
    const currentState = {
      layers,
      animation,
      frames,
      vector,
      hiddenLayerIds,
      rootLayers,
      rootAnimation,
      rootHiddenLayerIds,
      selectedFrameId,
      documentV2,
    };
    if (sameAutosaveState(lastFlushedState.current, currentState)) return;
    scheduler.schedule();
  }, [
    animation,
    documentV2,
    frames,
    hiddenLayerIds,
    layers,
    rootAnimation,
    rootHiddenLayerIds,
    rootLayers,
    scheduler,
    selectedFrameId,
    vector,
  ]);

  useEffect(() => () => scheduler.dispose(), [scheduler]);
}
