import type { BooleanOp, BooleanOptions } from "./booleanOperations";
import type { PathData } from "../types";
let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<
  number,
  {
    resolve: (result: PathData) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
function stopWorker(message: string) {
  worker?.terminate();
  worker = null;
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(new Error(message));
  }
  pending.clear();
}
/** Keep intersection tracing off the editor's pointer/playback thread. */
export async function combineCurveAreasAsync(
  operation: BooleanOp,
  first: PathData,
  second: PathData,
  options: BooleanOptions,
): Promise<PathData> {
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    const { combineCurveAreas } = await import("./curveBooleanKernel");
    return combineCurveAreas(operation, first, second, options);
  }
  if (!worker) {
    const currentWorker = new Worker(new URL("./curveBooleanWorker.ts", import.meta.url), {
      type: "module",
    });
    worker = currentWorker;
    currentWorker.onmessage = ({
      data,
    }: MessageEvent<{ id: number; result?: PathData; error?: string }>) => {
      if (worker !== currentWorker) return;
      const request = pending.get(data.id);
      if (!request) return;
      clearTimeout(request.timer);
      pending.delete(data.id);
      if (data.error || !data.result)
        request.reject(new Error(data.error ?? "The combined path is unavailable."));
      else request.resolve(data.result);
    };
    currentWorker.onerror = () => {
      if (worker === currentWorker)
        stopWorker("Combine could not finish. Your original paths are unchanged.");
    };
  }
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(
      () => stopWorker("Combine took too long. Try a simpler selection."),
      15000,
    );
    pending.set(id, { resolve, reject, timer });
    try {
      worker!.postMessage({ id, operation, first, second, options });
    } catch {
      stopWorker("Combine could not start. Your original paths are unchanged.");
    }
  });
}
