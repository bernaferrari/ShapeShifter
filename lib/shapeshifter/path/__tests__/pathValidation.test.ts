import { describe, expect, it } from "vitest";
import { validatePathData } from "../pathValidation";

describe("strict authoring path validation", () => {
  it.each([
    "M 0 0 L 10 10 Z",
    "m.5-.5 5.5 0 h10v20z",
    "M1e2 0 C0 0 20 20 30 30 S40 40 50 50",
    "M 0 0 A25 25 0 0 1 7 7",
    "M 0 0 a25 25 0 017 7",
    "M 0 0 a25 25 0 01.7.7",
  ])("accepts complete SVG syntax: %s", (path) => {
    expect(validatePathData(path)).toBeNull();
  });
  it.each([
    "",
    "L 0 0",
    "M 0 0 broken",
    "M 0 0 L 5",
    "M 0 0 C1 2 3",
    "M1e999 0",
    "M10000001 0",
    "M 0 0 A10 10 0 2 0 5 5",
    "M 0 0 A-10 10 0 0 1 5 5",
    "M 0 0 Z 4 5",
    "M 0 0 L 4 5;",
    "M0 0 L Infinity 1",
  ])("rejects malformed or overflowing author input: %s", (path) => {
    expect(validatePathData(path)).toBeTypeOf("string");
  });
});
