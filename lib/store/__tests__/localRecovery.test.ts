import { describe, expect, it } from "vitest";
import { RECOVERY_INTERVAL_MS, RECOVERY_LIMIT, retainRecoveryCheckpoint } from "../localRecovery";

describe("Retained recovery checkpoints", () => {
  it("retains the pre-edit document, bounds history, and avoids a checkpoint for every drag tick", () => {
    let history = retainRecoveryCheckpoint([], { name: "original" }, 1000);
    expect(retainRecoveryCheckpoint(history, { name: "drag tick" }, 1001)).toBe(history);
    for (let index = 1; index < 25; index++)
      history = retainRecoveryCheckpoint(
        history,
        { name: `version ${index}` },
        1000 + index * RECOVERY_INTERVAL_MS,
      );
    expect(history).toHaveLength(RECOVERY_LIMIT);
    expect(history[0]!.payload).toEqual({ name: "version 24" });
    expect(history.at(-1)!.payload).toEqual({ name: "version 5" });
  });
  it("does not manufacture an empty recovery document on the first save", () => {
    expect(retainRecoveryCheckpoint([], null, 1000)).toEqual([]);
  });
  it("always preserves the overwritten disk version for an explicit restore", () => {
    const history = retainRecoveryCheckpoint([], { name: "earlier" }, 1000);
    expect(retainRecoveryCheckpoint(history, { name: "latest" }, 1001, true)[0]!.payload).toEqual({
      name: "latest",
    });
  });
});
