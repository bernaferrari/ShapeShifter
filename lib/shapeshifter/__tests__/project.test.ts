/**
 * Tests for project.ts (loader, flattener, exporter)
 * Focused coverage for the project loader/flattener as required by Phase 0.
 */

import { describe, it, expect } from "vitest";
import {
  isOriginalShapeShifterProject,
  flattenOriginalProject,
} from "../project";

// Minimal valid project fixture (based on existing test data patterns)
const MINIMAL_PROJECT = {
  version: 1,
  layers: {
    vectorLayer: {
      id: "vec1",
      name: "Vector",
      type: "vector" as const,
      children: [
        {
          id: "p1",
          name: "Path",
          type: "path" as const,
          pathData: "M 0 0 L 10 10",
        },
      ],
    },
    hiddenLayerIds: [],
  },
  timeline: {
    animation: {
      id: "anim1",
      name: "anim",
      duration: 1000,
      blocks: [],
    },
  },
};

describe("project.ts - Phase 0 coverage", () => {
  describe("isOriginalShapeShifterProject", () => {
    it("returns true for valid project shape", () => {
      expect(isOriginalShapeShifterProject(MINIMAL_PROJECT)).toBe(true);
    });

    it("returns false for null/undefined/non-objects", () => {
      expect(isOriginalShapeShifterProject(null)).toBe(false);
      expect(isOriginalShapeShifterProject(undefined)).toBe(false);
      expect(isOriginalShapeShifterProject("string")).toBe(false);
      expect(isOriginalShapeShifterProject(123)).toBe(false);
    });

    it("returns false when required fields are missing", () => {
      expect(isOriginalShapeShifterProject({})).toBe(false);
      expect(isOriginalShapeShifterProject({ layers: {} })).toBe(false);
      expect(isOriginalShapeShifterProject({ timeline: {} })).toBe(false);
    });
  });

  describe("flattenOriginalProject", () => {
    it("produces layers with correct structure from minimal project", () => {
      const result = flattenOriginalProject(MINIMAL_PROJECT as any);
      expect(result.layers.length).toBeGreaterThan(0);
      expect(result.animation).toBeDefined();
      expect(result.vector).toBeDefined();
    });

    it("handles project with no children gracefully", () => {
      const emptyVec = {
        ...MINIMAL_PROJECT,
        layers: {
          ...MINIMAL_PROJECT.layers,
          vectorLayer: { ...MINIMAL_PROJECT.layers.vectorLayer, children: [] },
        },
      };
      const result = flattenOriginalProject(emptyVec as any);
      expect(result.layers.length).toBe(0);
    });
  });

});
