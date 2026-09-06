import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("sample Android app", () => {
  it("hosts a MainActivity that loads the ShapeShifter vector resource", () => {
    const activity = readFileSync(
      join(repoRoot, "samples/android/app/src/main/java/dev/shapeshifter/sample/MainActivity.kt"),
      "utf8",
    );
    const drawable = readFileSync(
      join(repoRoot, "samples/android/app/src/main/res/drawable/nested_clip_vector.xml"),
      "utf8",
    );
    expect(activity).toContain("setImageResource(R.drawable.nested_clip_vector)");
    expect(drawable).toContain("<vector");
    expect(drawable).toContain("clip-path");
  });
});
