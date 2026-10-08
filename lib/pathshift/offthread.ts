import {
  compileAndroidArtboard,
  type AndroidArtboardInput,
  type AndroidExportBundle,
} from "./androidCompiler";
import { prepareForMorph } from "./pathUtils";
import type { MorphMapping, PathData } from "./types";

/** Shape returned by prepareForMorph; kept local because the source declares it inline. */
interface MorphPreparation {
  from: PathData;
  to: PathData;
  mapping: MorphMapping;
}
type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<number, PendingRequest>();
let worker: Worker | null = null;
let nextId = 1;

/** Generous ceiling for compile/morph workloads; only a genuinely hung worker hits it. */
const REQUEST_TIMEOUT_MS = 30_000;

function workerAvailable() {
  return typeof Worker !== "undefined" && typeof window !== "undefined";
}

/** Reject everything in flight so callers do not hang forever, drop the dead worker, and let
 * the next request() rebuild it — or take the synchronous path when reconstruction fails. */
function failPendingFromWorkerError() {
  const error = new Error("Off-thread worker failed");
  for (const waiter of pending.values()) {
    clearTimeout(waiter.timer);
    waiter.reject(error);
  }
  pending.clear();
  worker = null;
}

function terminateWorker() {
  try {
    worker?.terminate();
  } catch {
    // Already gone — dropping the reference below is all that matters.
  }
  worker = null;
}

function getWorker(): Worker | null {
  if (!workerAvailable()) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./offthread.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const waiter = pending.get(event.data.id);
      if (!waiter) return;
      pending.delete(event.data.id);
      clearTimeout(waiter.timer);
      if (event.data.ok) waiter.resolve(event.data.result);
      else waiter.reject(new Error(event.data.error));
    };
    worker.onerror = () => failPendingFromWorkerError();
    worker.onmessageerror = () => failPendingFromWorkerError();
    return worker;
  } catch {
    worker = null;
    return null;
  }
}

function request<T>(kind: "compile" | "morph", payload: unknown): Promise<T> {
  const instance = getWorker();
  if (!instance) {
    if (kind === "compile")
      return Promise.resolve(compileAndroidArtboard(payload as AndroidArtboardInput) as T);
    const morph = payload as { from: PathData; to: PathData };
    return Promise.resolve(prepareForMorph(morph.from, morph.to) as T);
  }
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    let timer: PendingRequest["timer"] | undefined;
    const entry: PendingRequest = {
      resolve: (value) => resolve(value as T),
      reject,
      get timer() {
        return timer!;
      },
    };
    timer = setTimeout(() => {
      // Remove ourselves first so the broadcast below cannot double-reject this entry.
      pending.delete(id);
      entry.reject(new Error(`Off-thread request timed out after ${REQUEST_TIMEOUT_MS} ms`));
      // A module worker is single-threaded: one request blowing past the deadline means
      // nothing else in flight can complete either. Drop the wedged worker; the next
      // request() rebuilds it — or takes the synchronous fallback.
      terminateWorker();
      failPendingFromWorkerError();
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, entry);
    instance.postMessage({ id, kind, payload });
  });
}

export function prepareForMorphAsync(from: PathData, to: PathData) {
  return request<MorphPreparation>("morph", { from, to });
}

export function compileAndroidArtboardAsync(input: AndroidArtboardInput) {
  return request<AndroidExportBundle>("compile", input);
}
