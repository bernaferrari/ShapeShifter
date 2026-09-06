import { compileAndroidArtboard } from "./androidCompiler";
import { prepareForMorph } from "./pathUtils";

type WorkerRequest =
  | { id: number; kind: "compile"; payload: Parameters<typeof compileAndroidArtboard>[0] }
  | {
      id: number;
      kind: "morph";
      payload: {
        from: Parameters<typeof prepareForMorph>[0];
        to: Parameters<typeof prepareForMorph>[1];
      };
    };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  try {
    if (message.kind === "compile") {
      self.postMessage({
        id: message.id,
        ok: true,
        result: compileAndroidArtboard(message.payload),
      });
      return;
    }
    self.postMessage({
      id: message.id,
      ok: true,
      result: prepareForMorph(message.payload.from, message.payload.to),
    });
  } catch (error) {
    self.postMessage({ id: message.id, ok: false, error: String(error) });
  }
};
