/**
 * Tests for project.ts (loader, flattener, exporter)
 * Focused coverage for the project loader/flattener as required by Phase 0.
 */

import { describe, it, expect, vi } from "vitest";
import { createDocumentV2FromLegacy, validateDocumentV2 } from "../documentModel";
import {
  isOriginalShapeShifterProject,
  flattenOriginalProject,
  recoverLegacyDocumentSnapshot,
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

    it("promotes direct vector children to roots in the persisted frame graph", () => {
      const project = flattenOriginalProject(MINIMAL_PROJECT as any);

      expect(project.layers[0]?.parentId).toBeNull();
      const document = createDocumentV2FromLegacy({
        id: "legacy-import",
        name: "Legacy import",
        rootLayers: [],
        rootVector: { id: "page", name: "Page", width: 24, height: 24, alpha: 1 },
        rootAnimation: { id: "page-motion", name: "Page motion", duration: 1000, blocks: [] },
        rootHiddenLayerIds: [],
        frames: [
          {
            id: "legacy-frame",
            name: project.vector.name,
            x: 0,
            y: 0,
            layers: project.layers,
            vector: project.vector,
            animation: project.animation,
            hiddenLayerIds: project.hiddenLayerIds,
          },
        ],
      });

      expect(document.frames["legacy-frame"]?.childrenNodeIds).toHaveLength(1);
      expect(validateDocumentV2(document)).toEqual([]);
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

describe("recoverLegacyDocumentSnapshot", () => {
  const animation = { id: "anim", name: "anim", duration: 1000, blocks: [] };
  const vector = (id: string) => ({ id, name: `Vector ${id}`, width: 24, height: 24, alpha: 1 });
  const layer = {
    id: "p1",
    name: "Path",
    type: "path" as const,
    from: "M 0 0 L 10 10",
  };

  const envelope = (frames: unknown[], rootLayers: unknown[] = [layer]) => ({
    pageRoot: {
      vector: vector("page"),
      layers: rootLayers,
      animation,
      hiddenLayerIds: [],
    },
    frames,
  });

  it("recovers valid frames when a sibling frame is corrupt, warning about the skip", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const snapshot = recoverLegacyDocumentSnapshot(
        envelope([
          { id: "good", vector: vector("f1"), layers: [layer], animation, hiddenLayerIds: [] },
          { id: "bad", vector: vector("f2"), layers: [{ id: "x" }], animation, hiddenLayerIds: [] },
        ]),
      );
      expect(snapshot).not.toBeNull();
      expect(snapshot!.frames.map((frame) => frame.id)).toEqual(["good"]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('skipped frame "bad"'));
    } finally {
      warn.mockRestore();
    }
  });

  it("recovers a frame when one of its layers is corrupt", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const snapshot = recoverLegacyDocumentSnapshot(
        envelope([
          { id: "f1", vector: vector("v1"), layers: [layer, null], animation, hiddenLayerIds: [] },
        ]),
      );
      expect(snapshot).not.toBeNull();
      expect(snapshot!.frames[0].layers.map((entry) => entry.id)).toEqual(["p1"]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("Legacy recovery skipped"));
    } finally {
      warn.mockRestore();
    }
  });

  it("still returns null when no frame survives or the page root is unparseable", () => {
    expect(recoverLegacyDocumentSnapshot(envelope([{ id: "bad", vector: {} }]))).toBeNull();
    expect(
      recoverLegacyDocumentSnapshot({
        pageRoot: { layers: [layer] },
        frames: [],
      }),
    ).toBeNull();
  });
});
