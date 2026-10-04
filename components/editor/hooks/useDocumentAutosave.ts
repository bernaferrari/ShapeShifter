"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { serializeLiveProject } from "@/lib/store/exportDocument";
import { useEditorStore } from "@/lib/store/editorStore";
import { AutosaveConflictError, readAutosave, writeAutosave } from "@/lib/store/localRecovery";
export { readAutosave } from "@/lib/store/localRecovery";

export const AUTOSAVE_DEBOUNCE_MS = 400;

export type DocumentAutosaveStatus =
  | "restoring"
  | "saving"
  | "saved"
  | "error"
  | "paused"
  | "conflict";

export interface DocumentAutosaveState {
  status: DocumentAutosaveStatus;
  /** Time of the last completed IndexedDB transaction, never the queued write. */
  savedAt: number | null;
  error: string | null;
}

export interface DocumentAutosave extends DocumentAutosaveState {
  retry(): void;
  restoreCheckpoint(payload: unknown): Promise<void>;
}

/** Native commits keep durable identities, so every persisted field participates. */
export function autosaveSignature(payload: unknown): string | undefined {
  return JSON.stringify(payload);
}

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
  callbacks: {
    onSuccess?: (value: T) => void;
    onError?: (error: unknown, value: T) => void;
  } = {},
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
          callbacks.onSuccess?.(next.value);
        } catch (error) {
          // A failed transaction must remain observable. Retry on an explicit
          // request or a later edit, rather than spinning against a full quota.
          callbacks.onError?.(error, next.value);
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
  /** Capture pending edits immediately, including an explicit failed-write retry. */
  flush(options?: { force?: boolean }): void;
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
  onCaptured?: (signature: string) => void;
  onUnchanged?: (payload: unknown) => void;
  onError?: (error: unknown) => void;
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

  const capture = (force = false) => {
    timer = null;
    if (!hydrated || disposed || preserveStoredSnapshot) return;
    try {
      const payload = options.snapshot();
      const signature = autosaveSignature(payload);
      if (typeof signature !== "string") return;
      options.onCaptured?.(signature);
      if (!force && signature === lastEnqueuedSignature) {
        options.onUnchanged?.(payload);
        return;
      }
      lastEnqueuedSignature = signature;
      options.enqueue(payload);
    } catch (error) {
      options.onError?.(error);
    }
  };

  const schedule = () => {
    if (!hydrated || disposed || preserveStoredSnapshot) return;
    clearTimer();
    timer = setTimeout(() => capture(), delay);
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
    flush(options) {
      clearTimer();
      capture(options?.force);
    },
    dispose() {
      disposed = true;
      clearTimer();
    },
  };
}

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
export function useDocumentAutosave(): DocumentAutosave {
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
  const hydrationReady = useRef(false);
  const savingPaused = useRef(false);
  const lastSavedSignature = useRef<string | null>(null);
  const storedSignature = useRef<string | null>(null);
  const forceCheckpoint = useRef(false);
  const latestEnqueuedSignature = useRef<string | null>(null);
  const latestCapturedSignature = useRef<string | null>(null);
  const [saveState, setSaveState] = useState<DocumentAutosaveState>({
    status: "restoring",
    savedAt: null,
    error: null,
  });
  type PendingAutosave = {
    payload: unknown;
    signature: string;
  };
  const writerRef = useRef<CoalescingAutosaveWriter<PendingAutosave> | null>(null);
  if (!writerRef.current) {
    writerRef.current = createCoalescingAutosaveWriter(
      (snapshot) =>
        writeAutosave(snapshot.payload, storedSignature.current, forceCheckpoint.current),
      {
        onSuccess(snapshot) {
          forceCheckpoint.current = false;
          storedSignature.current = snapshot.signature;
          lastSavedSignature.current = snapshot.signature;
          const isCurrent =
            latestEnqueuedSignature.current === snapshot.signature &&
            latestCapturedSignature.current === snapshot.signature &&
            sameAutosaveState(
              lastFlushedState.current,
              autosaveStateToken(useEditorStore.getState()),
            );
          setSaveState((current) => ({
            ...current,
            savedAt: Date.now(),
            ...(isCurrent ? { status: "saved", error: null } : {}),
          }));
        },
        onError(error, snapshot) {
          if (latestEnqueuedSignature.current !== snapshot.signature) return;
          if (error instanceof AutosaveConflictError) {
            savingPaused.current = true;
            schedulerRef.current?.preserveStoredSnapshot();
          }
          setSaveState((current) => ({
            ...current,
            status: error instanceof AutosaveConflictError ? "conflict" : "error",
            error: error instanceof Error ? error.message : "Local autosave could not complete.",
          }));
        },
      },
    );
  }

  if (!schedulerRef.current) {
    schedulerRef.current = createDebouncedAutosaveScheduler({
      snapshot: () => {
        return serializeLiveProject();
      },
      onCaptured: (signature) => {
        lastFlushedState.current = autosaveStateToken(useEditorStore.getState());
        latestCapturedSignature.current = signature;
      },
      enqueue: (payload) => {
        const signature = latestCapturedSignature.current!;
        latestEnqueuedSignature.current = signature;
        setSaveState((current) => ({ ...current, status: "saving", error: null }));
        writerRef.current!.enqueue({
          payload,
          signature,
        });
      },
      onUnchanged: () => {
        // A flush may replace owner projections without changing document data.
        // Only a previously committed signature can be presented as saved.
        if (latestCapturedSignature.current === lastSavedSignature.current) {
          setSaveState((current) => ({ ...current, status: "saved", error: null }));
        }
      },
      onError: (error) => {
        setSaveState((current) => ({
          ...current,
          status: "error",
          error: error instanceof Error ? error.message : "The project could not be saved.",
        }));
      },
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
        if (!cancelled)
          storedSignature.current = payload == null ? null : (autosaveSignature(payload) ?? null);
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
            savingPaused.current = true;
            hydrationReady.current = true;
            scheduler.preserveStoredSnapshot();
            setSaveState((current) => ({
              ...current,
              status: "paused",
              error:
                "The previous autosave is preserved for recovery. Download a project backup to keep new edits.",
            }));
            if (!recoveryNoticeShown.current) {
              recoveryNoticeShown.current = true;
              toast.warning("Autosave preserved for recovery", {
                description:
                  "It could not be restored, so automatic saves are paused for this session.",
              });
            }
          } else {
            savingPaused.current = false;
            hydrationReady.current = true;
            setSaveState((current) => ({ ...current, status: "saving", error: null }));
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
    if (hydrationReady.current && !savingPaused.current) {
      setSaveState((current) => ({ ...current, status: "saving", error: null }));
    }
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

  useEffect(() => {
    const flush = () => scheduler.flush();
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      // Capture before cancelling the timer; dropping it would discard the last
      // 400ms of work whenever the editor unmounts.
      flush();
      scheduler.dispose();
    };
  }, [scheduler]);

  const retry = useCallback(() => {
    if (!hydrationReady.current || savingPaused.current) return;
    scheduler.flush({ force: true });
  }, [scheduler]);

  const restoreCheckpoint = useCallback(
    async (payload: unknown) => {
      await writerRef.current!.whenIdle();
      const wasPaused = savingPaused.current;
      savingPaused.current = true;
      scheduler.preserveStoredSnapshot();
      let restored = false;
      try {
        // Rebase the explicit restore on the latest disk copy. The next atomic
        // transaction retains that copy even if another tab wrote it recently.
        const current = await readAutosave();
        const text = autosaveText(payload);
        if (!text) throw new Error("This checkpoint does not contain a project.");
        const { importEditorText } = await import("@/components/editor/project/useProjectImport");
        importEditorText("recovery.shapeshifter", text);
        restored = true;
        storedSignature.current = current == null ? null : (autosaveSignature(current) ?? null);
        forceCheckpoint.current = true;
        savingPaused.current = false;
        hydrationReady.current = true;
        scheduler.markHydrated();
        scheduler.flush({ force: true });
        const restoredSignature = latestCapturedSignature.current;
        await writerRef.current!.whenIdle();
        if (lastSavedSignature.current !== restoredSignature)
          throw new Error(
            "The checkpoint is open, but could not be saved. Download a project backup.",
          );
      } catch (error) {
        if (!restored) {
          savingPaused.current = wasPaused;
          if (!wasPaused) scheduler.markHydrated();
        }
        throw error;
      }
    },
    [scheduler],
  );

  return { ...saveState, retry, restoreCheckpoint };
}
