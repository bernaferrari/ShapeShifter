import { combineCurveAreas } from "./curveBooleanKernel";
import type { BooleanOp, BooleanOptions } from "./booleanOperations";
import type { PathData } from "../types";
const worker = self as unknown as {
  onmessage: (event: MessageEvent) => void;
  postMessage: (message: unknown) => void;
};
worker.onmessage = ({
  data,
}: MessageEvent<{
  id: number;
  operation: BooleanOp;
  first: PathData;
  second: PathData;
  options: BooleanOptions;
}>) => {
  try {
    worker.postMessage({
      id: data.id,
      result: combineCurveAreas(data.operation, data.first, data.second, data.options),
    });
  } catch {
    worker.postMessage({
      id: data.id,
      error: "These paths could not be combined. Simplify the selection and try again.",
    });
  }
};
