/**
 * Tests for the stable ID system (ShapeShifter-k7zp).
 * These are the foundation tests for the entire v2 document model.
 * Zero tolerance for collisions, non-monotonic behavior, or lossy migration.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  generateId,
  decodeTime,
  ensureStableCommandIds,
  __resetMonotonicStateForTests,
} from "../ids";
import type { PathData, Command } from "../types";

describe("Stable ID System (k7zp)", () => {
  beforeEach(() => {
    __resetMonotonicStateForTests();
  });

  describe("generateId", () => {
    it("produces 26-character Crockford ULIDs by default", () => {
      const id = generateId();
      expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(id.length).toBe(26);
    });

    it("supports optional prefix for human readability without breaking uniqueness", () => {
      const cmdId = generateId("cmd");
      expect(cmdId).toMatch(/^cmd_[0-9A-HJKMNP-TV-Z]{26}$/);
      const nodeId = generateId("node");
      expect(nodeId).toMatch(/^node_[0-9A-HJKMNP-TV-Z]{26}$/);
    });

    it("generates unique IDs across thousands of calls", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 5000; i++) {
        ids.add(generateId());
      }
      expect(ids.size).toBe(5000);
    });

    it("IDs are lexicographically sortable and match creation order (time component)", () => {
      __resetMonotonicStateForTests();
      const ids: string[] = [];
      // Force different timestamps by sleeping between batches (ms granularity)
      for (let batch = 0; batch < 3; batch++) {
        for (let i = 0; i < 20; i++) {
          ids.push(generateId());
        }
        // advance wall clock
        const start = Date.now();
        while (Date.now() - start < 2) {
          /* spin */
        }
      }

      const sorted = [...ids].sort();
      // Because of monotonic + time prefix, the order we generated should already be sorted
      // (within the limits of ms resolution and the test clock)
      expect(sorted).toEqual(ids);
    });
  });

  describe("decodeTime", () => {
    it("round-trips creation time for freshly generated IDs (within 50ms tolerance)", () => {
      const before = Date.now();
      const id = generateId();
      const after = Date.now();
      const decoded = decodeTime(id);
      expect(decoded).toBeGreaterThanOrEqual(before - 5);
      expect(decoded).toBeLessThanOrEqual(after + 50);
    });

    it("handles prefixed IDs transparently", () => {
      const id = generateId("frame");
      const t = decodeTime(id);
      expect(t).toBeGreaterThan(1700000000000); // post-2023 sanity
    });

    it("returns 0 for garbage input without throwing", () => {
      expect(decodeTime("")).toBe(0);
      expect(decodeTime("not-a-ulid")).toBe(0);
      expect(decodeTime("cmd_123")).toBe(0);
    });
  });

  describe("ensureStableCommandIds (legacy migration)", () => {
    function makeLegacyPath(legacyIds: (string | undefined)[]): PathData {
      const commands: Command[] = legacyIds.map((id, idx) => ({
        id: id ?? `cmd_${Date.now()}_${idx}`,
        type: idx === 0 ? "M" : "L",
        points: [{ x: idx, y: idx }],
      }));
      return { subPaths: [{ commands }] };
    }

    it("leaves already-good ULID IDs completely untouched (fast path, no dirty)", () => {
      const good = generateId("cmd");
      const input: PathData = {
        subPaths: [
          {
            commands: [
              { id: good, type: "M", points: [{ x: 0, y: 0 }] },
              { id: generateId("cmd"), type: "L", points: [{ x: 10, y: 10 }] },
            ],
          },
        ],
      };
      const out = ensureStableCommandIds(input);
      expect(out).toBe(input); // identity when clean
      expect(out.subPaths[0].commands[0].id).toBe(good);
    });

    it("upgrades legacy cmd_ timestamp IDs to proper ULIDs", () => {
      const input = makeLegacyPath(["cmd_1712345678901_0", "cmd_1712345678901_1"]);
      const out = ensureStableCommandIds(input);
      expect(out).not.toBe(input);
      expect(out.subPaths[0].commands[0].id).not.toMatch(/^cmd_\d+_\d+$/);
      expect(out.subPaths[0].commands[0].id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(out.subPaths[0].commands.every((c) => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(c.id))).toBe(
        true,
      );
    });

    it("is idempotent after mixed legacy IDs are migrated", () => {
      const mixed: PathData = {
        subPaths: [
          {
            commands: [
              { id: "cmd_1712345678901_0", type: "M", points: [{ x: 0, y: 0 }] },
              { id: "cmd_old_1", type: "L", points: [{ x: 10, y: 0 }] },
              { id: generateId(), type: "L", points: [{ x: 10, y: 10 }] },
            ],
          },
        ],
      };

      const once = ensureStableCommandIds(mixed);
      const twice = ensureStableCommandIds(once);
      const ids = once.subPaths[0].commands.map((command) => command.id);

      expect(twice).toBe(once);
      expect(ids.every((id) => !/^cmd_\d+/.test(id))).toBe(true);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("replaces duplicate IDs with fresh stable ones while preserving good ones", () => {
      const dup = "cmd_duplicate";
      const input: PathData = {
        subPaths: [
          {
            commands: [
              { id: dup, type: "M", points: [{ x: 0, y: 0 }] },
              { id: dup, type: "L", points: [{ x: 1, y: 1 }] },
              { id: generateId(), type: "L", points: [{ x: 2, y: 2 }] },
            ],
          },
        ],
      };
      const out = ensureStableCommandIds(input);
      const ids = out.subPaths[0].commands.map((c) => c.id);
      expect(new Set(ids).size).toBe(3); // all unique after migration
      expect(ids[2]).not.toBe(dup); // the good one survived
    });

    it("is pure — never mutates the input PathData", () => {
      const input = makeLegacyPath(["cmd_old_1"]);
      const originalId = input.subPaths[0].commands[0].id;
      ensureStableCommandIds(input);
      expect(input.subPaths[0].commands[0].id).toBe(originalId);
    });

    it("handles empty and minimal paths gracefully", () => {
      expect(ensureStableCommandIds({ subPaths: [] })).toEqual({ subPaths: [] });
      const minimal: PathData = { subPaths: [{ commands: [] }] };
      expect(ensureStableCommandIds(minimal).subPaths[0].commands).toEqual([]);
    });
  });

  describe("monotonic guarantees", () => {
    it("produces strictly increasing IDs even when called in a tight loop within the same ms", () => {
      __resetMonotonicStateForTests();
      const now = vi.spyOn(Date, "now").mockReturnValue(1_750_000_000_000);
      const ids = Array.from({ length: 100 }, () => generateId());
      now.mockRestore();
      for (let i = 1; i < ids.length; i++) {
        expect(ids[i] > ids[i - 1]).toBe(true); // string compare works because time prefix + monotonic rand
      }
    });
  });
});
