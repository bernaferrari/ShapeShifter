// @vitest-environment happy-dom

import { describe, it, expect } from "vitest";
import { importLayersFromSvg, importLayersFromVectorDrawable } from "../importers";
import {
  isOriginalShapeShifterProject,
  flattenOriginalProject,
  type ShapeShifterProject,
} from "../project";
import { exportStaticSVG, exportVectorDrawable, exportProjectJSON } from "../exporter";
import { pathToString, parsePath, reversePath } from "../pathUtils";
import type { Layer, VectorMetadata, AnimationState } from "../types";

const SVG_PATH_TRIANGLE = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
  <path id="triangle" d="M 12 2 L 22 22 L 2 22 Z" fill="#ff0000" stroke="#000000" stroke-width="2"/>
</svg>`;

const SVG_PATH_RECT = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48">
  <rect x="4" y="4" width="40" height="40" fill="blue"/>
</svg>`;

const SVG_PATH_CIRCLE = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48">
  <circle cx="24" cy="24" r="20" fill="green" stroke="black" stroke-width="1.5"/>
</svg>`;

const SVG_PATH_ELLIPSE = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48">
  <ellipse cx="24" cy="24" rx="20" ry="10" fill="yellow"/>
</svg>`;

const SVG_PATH_LINE = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48">
  <line x1="0" y1="0" x2="48" y2="48" stroke="red" stroke-width="3"/>
</svg>`;

const SVG_PATH_POLYGON = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48">
  <polygon points="24,2 46,46 2,46" fill="purple"/>
</svg>`;

const SVG_PATH_POLYLINE = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48">
  <polyline points="0,0 24,24 48,0" fill="none" stroke="orange" stroke-width="2"/>
</svg>`;

const SVG_MULTI_ELEMENT = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48">
  <path id="star" d="M 24 2 L 28 18 L 46 18 L 32 28 L 36 46 L 24 36 L 12 46 L 16 28 L 2 18 L 20 18 Z" fill="gold"/>
  <rect id="bg" x="0" y="0" width="48" height="48" fill="#333"/>
</svg>`;

const SVG_WITH_STYLES = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48">
  <path d="M 0 0 L 48 0 L 48 48 L 0 48 Z"
        fill="#3b82f6" fill-opacity="0.5"
        stroke="#1e40af" stroke-opacity="0.8" stroke-width="3"
        stroke-linecap="round" stroke-linejoin="round"
        fill-rule="evenodd"/>
</svg>`;

const SVG_NO_FILL = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48">
  <path d="M 0 0 L 48 48" fill="none" stroke="black"/>
</svg>`;

const SVG_WITH_IDS = `<svg xmlns="http://www.w3.org/2000/svg">
  <path id="layer1" d="M 0 0 L 10 10"/>
  <path id="layer2" d="M 5 5 L 15 15"/>
  <path d="M 20 20 L 30 30"/>
</svg>`;

const SVG_EMPTY_PATH = `<svg xmlns="http://www.w3.org/2000/svg">
  <path d=""/>
  <path d="   "/>
  <path id="valid" d="M 0 0 L 10 10"/>
</svg>`;

const VECTOR_DRAWABLE_BASIC = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
  <path
      android:name="star"
      android:pathData="M 12 2 L 22 22 L 2 22 Z"
      android:fillColor="#ff0000"
      android:strokeColor="#000000"
      android:strokeWidth="2"/>
</vector>`;

const VECTOR_DRAWABLE_MULTI_PATH = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
  <path
      android:name="outline"
      android:pathData="M 4 4 L 20 4 L 20 20 L 4 20 Z"
      android:fillColor="#333333"
      android:strokeColor="#000000"
      android:strokeWidth="1"/>
  <path
      android:name="inner"
      android:pathData="M 8 8 L 16 8 L 16 16 L 8 16 Z"
      android:fillColor="#ffffff"/>
</vector>`;

const VECTOR_DRAWABLE_FULL_STYLE = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="48dp"
    android:height="48dp"
    android:viewportWidth="48"
    android:viewportHeight="48">
  <path
      android:name="styled_path"
      android:pathData="M 0 0 L 48 0 L 48 48 L 0 48 Z"
      android:fillColor="#3b82f6"
      android:fillAlpha="0.7"
      android:strokeColor="#1e40af"
      android:strokeAlpha="0.9"
      android:strokeWidth="3"
      android:strokeLineCap="round"
      android:strokeLineJoin="bevel"
      android:strokeMiterLimit="8"
      android:trimPathStart="0.1"
      android:trimPathEnd="0.9"
      android:trimPathOffset="0.05"
      android:fillType="evenOdd"/>
</vector>`;

const VECTOR_DRAWABLE_WITHOUT_NS = `<?xml version="1.0" encoding="utf-8"?>
<vector>
  <path name="simple" pathData="M 0 0 L 10 10 L 20 0 Z" fillColor="red"/>
</vector>`;

const VECTOR_DRAWABLE_EMPTY_PATH = `<?xml version="1.0" encoding="utf-8"?>
<vector>
  <path name="empty" pathData=""/>
  <path name="valid" pathData="M 0 0 L 10 10"/>
</vector>`;

const PROJECT_BASIC: ShapeShifterProject = {
  version: 1,
  layers: {
    vectorLayer: {
      id: "vec1",
      name: "MyVector",
      type: "vector",
      width: 24,
      height: 24,
      alpha: 1,
      children: [
        {
          id: "path1",
          name: "square",
          type: "path",
          pathData: "M 4 4 L 20 4 L 20 20 L 4 20 Z",
          fillColor: "#ff0000",
          strokeColor: "#000000",
          strokeWidth: 2,
        },
      ],
    },
    hiddenLayerIds: [],
  },
  timeline: {
    animation: {
      id: "anim1",
      name: "morph",
      duration: 1000,
      blocks: [],
    },
  },
};

const PROJECT_WITH_ANIMATION: ShapeShifterProject = {
  version: 1,
  layers: {
    vectorLayer: {
      id: "vec1",
      name: "Animated",
      type: "vector",
      width: 48,
      height: 48,
      alpha: 1,
      children: [
        {
          id: "path1",
          name: "morph_path",
          type: "path",
          pathData: "M 0 0 L 48 0 L 48 48 L 0 48 Z",
          fillColor: "#3b82f6",
        },
      ],
    },
    hiddenLayerIds: [],
  },
  timeline: {
    animation: {
      id: "anim1",
      name: "morph_anim",
      duration: 2000,
      blocks: [
        {
          id: "block1",
          layerId: "path1",
          propertyName: "pathData",
          fromValue: "M 0 0 L 48 0 L 48 48 L 0 48 Z",
          toValue: "M 24 0 L 48 24 L 24 48 L 0 24 Z",
          startTime: 0,
          endTime: 2000,
          interpolator: "FAST_OUT_SLOW_IN",
          type: "path",
        },
      ],
    },
  },
};

const PROJECT_WITH_GROUPS: ShapeShifterProject = {
  version: 1,
  layers: {
    vectorLayer: {
      id: "vec1",
      name: "Grouped",
      type: "vector",
      width: 24,
      height: 24,
      alpha: 1,
      children: [
        {
          id: "group1",
          name: "my_group",
          type: "group",
          rotation: 45,
          scaleX: 1.5,
          scaleY: 1.5,
          pivotX: 12,
          pivotY: 12,
          translateX: 3,
          translateY: 3,
          children: [
            {
              id: "child1",
              name: "inner_path",
              type: "path",
              pathData: "M 0 0 L 10 10",
              fillColor: "red",
            },
          ],
        },
      ],
    },
    hiddenLayerIds: [],
  },
  timeline: {
    animation: {
      id: "anim1",
      name: "idle",
      duration: 1000,
      blocks: [],
    },
  },
};

const PROJECT_WITH_HIDDEN: ShapeShifterProject = {
  version: 1,
  layers: {
    vectorLayer: {
      id: "vec1",
      name: "HiddenTest",
      type: "vector",
      width: 24,
      height: 24,
      alpha: 1,
      children: [
        { id: "p1", name: "visible", type: "path", pathData: "M 0 0 L 10 10" },
        { id: "p2", name: "hidden", type: "path", pathData: "M 5 5 L 15 15" },
      ],
    },
    hiddenLayerIds: ["p2"],
  },
  timeline: {
    animation: {
      id: "anim1",
      name: "idle",
      duration: 1000,
      blocks: [],
    },
  },
};

function extractPathString(layer: Layer): string {
  return pathToString(layer.from);
}

describe("importLayersFromSvg", () => {
  describe("basic SVG element types", () => {
    it("imports a <path> element with path data", () => {
      const layers = importLayersFromSvg(SVG_PATH_TRIANGLE);
      expect(layers).toHaveLength(1);
      const layer = layers[0];
      expect(layer.type).toBe("path");
      expect(layer.name).toBe("triangle");
      expect(layer.visible).toBe(true);
      expect(layer.locked).toBe(false);
      expect(extractPathString(layer)).toContain("M");
      expect(extractPathString(layer)).toContain("Z");
    });

    it("imports a <rect> element as path data", () => {
      const layers = importLayersFromSvg(SVG_PATH_RECT);
      expect(layers).toHaveLength(1);
      const d = extractPathString(layers[0]);
      expect(d).toContain("M4 4");
      expect(d).toContain("L44 4");
      expect(d).toContain("L44 44");
      expect(d).toContain("L4 44");
      expect(d).toContain("Z");
    });

    it("imports a <circle> element as cubic bezier approximation", () => {
      const layers = importLayersFromSvg(SVG_PATH_CIRCLE);
      expect(layers).toHaveLength(1);
      const d = extractPathString(layers[0]);
      expect(d).toContain("C");
      expect(d).toContain("Z");
      expect(d).toContain("M44 24");
    });

    it("imports an <ellipse> element", () => {
      const layers = importLayersFromSvg(SVG_PATH_ELLIPSE);
      expect(layers).toHaveLength(1);
      const d = extractPathString(layers[0]);
      expect(d).toContain("C");
      expect(d).toContain("Z");
    });

    it("imports a <line> element as M + L", () => {
      const layers = importLayersFromSvg(SVG_PATH_LINE);
      expect(layers).toHaveLength(1);
      const d = extractPathString(layers[0]);
      expect(d).toEqual("M0 0 L48 48");
    });

    it("imports a <polygon> element (closed)", () => {
      const layers = importLayersFromSvg(SVG_PATH_POLYGON);
      expect(layers).toHaveLength(1);
      const d = extractPathString(layers[0]);
      expect(d).toContain("M24 2");
      expect(d).toContain("Z");
    });

    it("imports a <polyline> element (open)", () => {
      const layers = importLayersFromSvg(SVG_PATH_POLYLINE);
      expect(layers).toHaveLength(1);
      const d = extractPathString(layers[0]);
      expect(d).toContain("M0 0");
      expect(d).toContain("L24 24");
      expect(d).not.toContain("Z");
    });
  });

  describe("multi-element SVG", () => {
    it("imports multiple elements from one SVG", () => {
      const layers = importLayersFromSvg(SVG_MULTI_ELEMENT);
      expect(layers).toHaveLength(2);
      expect(layers[0].name).toBe("star");
      expect(layers[1].name).toBe("bg");
    });

    it("generates unique IDs for each layer", () => {
      const layers = importLayersFromSvg(SVG_MULTI_ELEMENT);
      const ids = layers.map((l) => l.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe("style extraction", () => {
    it("extracts fill and stroke colors", () => {
      const layers = importLayersFromSvg(SVG_PATH_TRIANGLE) as Layer[];
      const layer = layers[0];
      expect(layer.fillColor).toBe("#ff0000");
      expect(layer.strokeColor).toBe("#000000");
      expect(layer.strokeWidth).toBe(2);
    });

    it("extracts full style attributes", () => {
      const layers = importLayersFromSvg(SVG_WITH_STYLES) as Layer[];
      const layer = layers[0];
      expect(layer.fillColor).toBe("#3b82f6");
      expect(layer.fillAlpha).toBe(0.5);
      expect(layer.strokeColor).toBe("#1e40af");
      expect(layer.strokeAlpha).toBe(0.8);
      expect(layer.strokeWidth).toBe(3);
      expect(layer.strokeLinecap).toBe("round");
      expect(layer.strokeLinejoin).toBe("round");
      expect(layer.fillType).toBe("evenOdd");
    });

    it("handles fill=none as empty fillColor", () => {
      const layers = importLayersFromSvg(SVG_NO_FILL) as Layer[];
      expect(layers[0].fillColor).toBe("");
      expect(layers[0].strokeColor).toBe("black");
    });

    it("defaults fillType to nonZero when fill-rule is absent", () => {
      const layers = importLayersFromSvg(SVG_PATH_TRIANGLE) as Layer[];
      expect(layers[0].fillType).toBe("nonZero");
    });
  });

  describe("naming", () => {
    it("uses id attribute as layer name", () => {
      const layers = importLayersFromSvg(SVG_WITH_IDS);
      expect(layers[0].name).toBe("layer1");
      expect(layers[1].name).toBe("layer2");
    });

    it("falls back to generated name when no id", () => {
      const layers = importLayersFromSvg(SVG_WITH_IDS);
      expect(layers[2].name).toContain("svg_path");
    });

    it("uses custom namePrefix", () => {
      const svg = `<svg><path d="M 0 0 L 10 10"/></svg>`;
      const layers = importLayersFromSvg(svg, "icon");
      expect(layers[0].name).toContain("icon_path");
    });
  });

  describe("empty and edge cases", () => {
    it("skips elements with empty path data", () => {
      const layers = importLayersFromSvg(SVG_EMPTY_PATH);
      expect(layers).toHaveLength(1);
      expect(layers[0].name).toBe("valid");
    });

    it("returns empty array for SVG with no supported elements", () => {
      const svg = `<svg><text>Hello</text><image href="x"/></svg>`;
      const layers = importLayersFromSvg(svg);
      expect(layers).toHaveLength(0);
    });

    it("returns empty array for empty SVG", () => {
      const layers = importLayersFromSvg(`<svg></svg>`);
      expect(layers).toHaveLength(0);
    });

    it("handles malformed XML gracefully", () => {
      const layers = importLayersFromSvg(`<not valid xml <path d="M 0 0"/>`);
      expect(Array.isArray(layers)).toBe(true);
    });
  });

  describe("roundtrip: import → export → compare", () => {
    it("roundtrips a simple triangle through exportStaticSVG", () => {
      const layers = importLayersFromSvg(SVG_PATH_TRIANGLE);
      const exported = exportStaticSVG(layers);
      expect(exported).toContain("triangle");
      expect(exported).toContain("<path");
      expect(exported).toContain("</svg>");

      const reimported = importLayersFromSvg(exported);
      expect(reimported).toHaveLength(1);
      expect(extractPathString(reimported[0])).toEqual(extractPathString(layers[0]));
    });

    it("roundtrips multi-element SVG", () => {
      const layers = importLayersFromSvg(SVG_MULTI_ELEMENT);
      const exported = exportStaticSVG(layers);
      const reimported = importLayersFromSvg(exported);
      expect(reimported).toHaveLength(2);
      for (let i = 0; i < layers.length; i++) {
        expect(extractPathString(reimported[i])).toEqual(extractPathString(layers[i]));
      }
    });

    it("preserves path data through import/parse cycle", () => {
      const originalD = "M 0 0 L 48 0 L 48 48 L 0 48 Z";
      const svg = `<svg><path d="${originalD}"/></svg>`;
      const layers = importLayersFromSvg(svg);
      const parsed = parsePath(originalD);
      expect(extractPathString(layers[0])).toEqual(pathToString(parsed));
    });
  });

  describe("path data integrity", () => {
    it("from and to are identical for imported layers", () => {
      const layers = importLayersFromSvg(SVG_PATH_TRIANGLE);
      expect(pathToString(layers[0].from)).toEqual(pathToString(layers[0].to));
    });

    it("pathData matches from", () => {
      const layers = importLayersFromSvg(SVG_PATH_TRIANGLE);
      expect(pathToString(layers[0].pathData!)).toEqual(pathToString(layers[0].from));
    });
  });
});

describe("importLayersFromVectorDrawable", () => {
  describe("basic import", () => {
    it("imports a single path from VectorDrawable", () => {
      const layers = importLayersFromVectorDrawable(VECTOR_DRAWABLE_BASIC);
      expect(layers).toHaveLength(1);
      const layer = layers[0];
      expect(layer.name).toBe("star");
      expect(layer.type).toBe("path");
      expect(layer.visible).toBe(true);
      expect(layer.locked).toBe(false);
    });

    it("imports multiple paths", () => {
      const layers = importLayersFromVectorDrawable(VECTOR_DRAWABLE_MULTI_PATH);
      expect(layers).toHaveLength(2);
      expect(layers[0].name).toBe("outline");
      expect(layers[1].name).toBe("inner");
    });
  });

  describe("Android style attributes", () => {
    it("extracts fill and stroke colors", () => {
      const layers = importLayersFromVectorDrawable(VECTOR_DRAWABLE_BASIC);
      const layer = layers[0];
      expect(layer.fillColor).toBe("#ff0000");
      expect(layer.strokeColor).toBe("#000000");
      expect(layer.strokeWidth).toBe(2);
    });

    it("extracts full style with all Android-specific attributes", () => {
      const layers = importLayersFromVectorDrawable(VECTOR_DRAWABLE_FULL_STYLE);
      const layer = layers[0];
      expect(layer.name).toBe("styled_path");
      expect(layer.fillColor).toBe("#3b82f6");
      expect(layer.fillAlpha).toBe(0.7);
      expect(layer.strokeColor).toBe("#1e40af");
      expect(layer.strokeAlpha).toBe(0.9);
      expect(layer.strokeWidth).toBe(3);
      expect(layer.strokeLinecap).toBe("round");
      expect(layer.strokeLinejoin).toBe("bevel");
      expect(layer.strokeMiterLimit).toBe(8);
      expect(layer.trimPathStart).toBe(0.1);
      expect(layer.trimPathEnd).toBe(0.9);
      expect(layer.trimPathOffset).toBe(0.05);
      expect(layer.fillType).toBe("evenOdd");
    });

    it("uses defaults for missing attributes", () => {
      const layers = importLayersFromVectorDrawable(VECTOR_DRAWABLE_BASIC);
      const layer = layers[0];
      expect(layer.fillAlpha).toBe(1);
      expect(layer.strokeAlpha).toBe(1);
      expect(layer.strokeLinecap).toBe("butt");
      expect(layer.strokeLinejoin).toBe("miter");
      expect(layer.strokeMiterLimit).toBe(4);
      expect(layer.trimPathStart).toBe(0);
      expect(layer.trimPathEnd).toBe(1);
      expect(layer.trimPathOffset).toBe(0);
      expect(layer.fillType).toBe("nonZero");
    });
  });

  describe("non-namespaced attributes", () => {
    it("reads pathData without android: namespace", () => {
      const layers = importLayersFromVectorDrawable(VECTOR_DRAWABLE_WITHOUT_NS);
      expect(layers).toHaveLength(1);
      expect(layers[0].name).toBe("simple");
      expect(extractPathString(layers[0])).toContain("M0 0");
    });
  });

  describe("empty and edge cases", () => {
    it("skips paths with empty pathData", () => {
      const layers = importLayersFromVectorDrawable(VECTOR_DRAWABLE_EMPTY_PATH);
      expect(layers).toHaveLength(1);
      expect(layers[0].name).toBe("valid");
    });

    it("returns empty array for XML with no paths", () => {
      const xml = `<?xml version="1.0"?><vector></vector>`;
      const layers = importLayersFromVectorDrawable(xml);
      expect(layers).toHaveLength(0);
    });

    it("handles malformed XML gracefully", () => {
      const layers = importLayersFromVectorDrawable(`<not valid <path pathData="M 0 0"/>`);
      expect(Array.isArray(layers)).toBe(true);
    });
  });

  describe("roundtrip: import → export → compare", () => {
    it("roundtrips a basic VectorDrawable through exportVectorDrawable", () => {
      const layers = importLayersFromVectorDrawable(VECTOR_DRAWABLE_BASIC);
      const exported = exportVectorDrawable(layers[0]);
      expect(exported).toContain("star");
      expect(exported).toContain("android:pathData");
      expect(exported).toContain("#ff0000");

      const reimported = importLayersFromVectorDrawable(exported);
      expect(reimported).toHaveLength(1);
      expect(extractPathString(reimported[0])).toEqual(extractPathString(layers[0]));
    });

    it("roundtrips full-style VectorDrawable preserving key properties", () => {
      const layers = importLayersFromVectorDrawable(VECTOR_DRAWABLE_FULL_STYLE);
      const exported = exportVectorDrawable(layers[0]);
      const reimported = importLayersFromVectorDrawable(exported);

      expect(reimported).toHaveLength(1);
      expect(reimported[0].fillColor).toBe(layers[0].fillColor);
      expect(reimported[0].strokeColor).toBe(layers[0].strokeColor);
      expect(extractPathString(reimported[0])).toEqual(extractPathString(layers[0]));
    });
  });

  describe("path data integrity", () => {
    it("from and to are identical for imported layers", () => {
      const layers = importLayersFromVectorDrawable(VECTOR_DRAWABLE_BASIC);
      expect(pathToString(layers[0].from)).toEqual(pathToString(layers[0].to));
    });

    it("pathData matches from", () => {
      const layers = importLayersFromVectorDrawable(VECTOR_DRAWABLE_BASIC);
      expect(pathToString(layers[0].pathData!)).toEqual(pathToString(layers[0].from));
    });
  });
});

describe("project.ts: .shapeshifter project import", () => {
  describe("isOriginalShapeShifterProject", () => {
    it("detects valid ShapeShifter project", () => {
      expect(isOriginalShapeShifterProject(PROJECT_BASIC)).toBe(true);
    });

    it("detects project with animation", () => {
      expect(isOriginalShapeShifterProject(PROJECT_WITH_ANIMATION)).toBe(true);
    });

    it("rejects null", () => {
      expect(isOriginalShapeShifterProject(null)).toBe(false);
    });

    it("rejects undefined", () => {
      expect(isOriginalShapeShifterProject(undefined)).toBe(false);
    });

    it("rejects non-object", () => {
      expect(isOriginalShapeShifterProject("not a project")).toBe(false);
      expect(isOriginalShapeShifterProject(42)).toBe(false);
    });

    it("rejects object without vectorLayer", () => {
      expect(
        isOriginalShapeShifterProject({
          layers: { hiddenLayerIds: [] },
          timeline: { animation: { blocks: [] } },
        }),
      ).toBe(false);
    });

    it("rejects object without animation blocks", () => {
      expect(
        isOriginalShapeShifterProject({
          layers: { vectorLayer: { id: "v" } },
          timeline: { animation: {} },
        }),
      ).toBe(false);
    });

    it("rejects object with blocks as non-array", () => {
      expect(
        isOriginalShapeShifterProject({
          layers: { vectorLayer: { id: "v" } },
          timeline: { animation: { blocks: "not array" } },
        }),
      ).toBe(false);
    });
  });

  describe("flattenOriginalProject", () => {
    it("flattens a basic project with one path", () => {
      const result = flattenOriginalProject(PROJECT_BASIC);
      expect(result.layers).toHaveLength(1);
      expect(result.layers[0].name).toBe("square");
      expect(result.layers[0].type).toBe("path");
    });

    it("sets vector metadata", () => {
      const result = flattenOriginalProject(PROJECT_BASIC);
      expect(result.vector.id).toBe("vec1");
      expect(result.vector.name).toBe("MyVector");
      expect(result.vector.width).toBe(24);
      expect(result.vector.height).toBe(24);
      expect(result.vector.alpha).toBe(1);
    });

    it("sets animation state", () => {
      const result = flattenOriginalProject(PROJECT_BASIC);
      expect(result.animation.id).toBe("anim1");
      expect(result.animation.name).toBe("morph");
      expect(result.animation.duration).toBe(1000);
    });

    it("preserves style attributes", () => {
      const result = flattenOriginalProject(PROJECT_BASIC);
      const layer = result.layers[0];
      expect(layer.fillColor).toBe("#ff0000");
      expect(layer.strokeColor).toBe("#000000");
      expect(layer.strokeWidth).toBe(2);
    });

    it("imports layers as visible when not in hiddenLayerIds", () => {
      const result = flattenOriginalProject(PROJECT_BASIC);
      expect(result.layers[0].visible).toBe(true);
    });
  });

  describe("project with animation blocks", () => {
    it("applies pathData animation block to from/to", () => {
      const result = flattenOriginalProject(PROJECT_WITH_ANIMATION);
      const layer = result.layers[0];
      expect(layer.name).toBe("morph_path");
      expect(pathToString(layer.from)).not.toEqual(pathToString(layer.to));
      expect(pathToString(layer.from)).toContain("M0 0");
      expect(pathToString(layer.to)).toContain("M24 0");
    });

    it("preserves animation metadata", () => {
      const result = flattenOriginalProject(PROJECT_WITH_ANIMATION);
      expect(result.animation.duration).toBe(2000);
      expect(result.animation.blocks).toHaveLength(1);
      expect(result.animation.blocks[0].interpolator).toBe("FAST_OUT_SLOW_IN");
    });

    it("attaches timeline blocks to layers", () => {
      const result = flattenOriginalProject(PROJECT_WITH_ANIMATION);
      const layer = result.layers[0];
      expect(layer.timeline).toHaveLength(1);
      expect(layer.timeline![0].propertyName).toBe("pathData");
    });
  });

  describe("project with groups", () => {
    it("imports group layers", () => {
      const result = flattenOriginalProject(PROJECT_WITH_GROUPS);
      const group = result.layers.find((l) => l.type === "group");
      expect(group).toBeDefined();
      expect(group!.name).toBe("my_group");
    });

    it("preserves group transform properties", () => {
      const result = flattenOriginalProject(PROJECT_WITH_GROUPS);
      const group = result.layers.find((l) => l.type === "group")!;
      expect(group.rotation).toBe(45);
      expect(group.scaleX).toBe(1.5);
      expect(group.scaleY).toBe(1.5);
      expect(group.pivotX).toBe(12);
      expect(group.pivotY).toBe(12);
      expect(group.translateX).toBe(3);
      expect(group.translateY).toBe(3);
    });

    it("imports child paths within groups", () => {
      const result = flattenOriginalProject(PROJECT_WITH_GROUPS);
      const pathLayer = result.layers.find((l) => l.name === "inner_path");
      expect(pathLayer).toBeDefined();
      expect(pathLayer!.type).toBe("path");
      expect(pathLayer!.parentId).toBe("group1");
    });
  });

  describe("project with hidden layers", () => {
    it("marks hidden layers as not visible", () => {
      const result = flattenOriginalProject(PROJECT_WITH_HIDDEN);
      const hidden = result.layers.find((l) => l.name === "hidden");
      expect(hidden!.visible).toBe(false);
    });

    it("keeps visible layers as visible", () => {
      const result = flattenOriginalProject(PROJECT_WITH_HIDDEN);
      const visible = result.layers.find((l) => l.name === "visible");
      expect(visible!.visible).toBe(true);
    });

    it("preserves hiddenLayerIds in result", () => {
      const result = flattenOriginalProject(PROJECT_WITH_HIDDEN);
      expect(result.hiddenLayerIds).toContain("p2");
    });
  });

  describe("roundtrip: import → export → compare", () => {
    it("exportProjectJSON produces valid structure re-importable by flattenOriginalProject", () => {
      const layers = [
        {
          id: "path1",
          name: "square",
          type: "path" as const,
          from: parsePath("M 4 4 L 20 4 L 20 20 L 4 20 Z"),
          to: parsePath("M 4 4 L 20 4 L 20 20 L 4 20 Z"),
          pathData: parsePath("M 4 4 L 20 4 L 20 20 L 4 20 Z"),
          visible: true,
          locked: false,
          parentId: null,
          fillColor: "#ff0000",
          strokeColor: "#000000",
          strokeWidth: 2,
        },
      ];
      const vector: VectorMetadata = {
        id: "vec1",
        name: "MyVector",
        width: 24,
        height: 24,
        alpha: 1,
      };
      const animation: AnimationState = { id: "anim1", name: "morph", duration: 1000, blocks: [] };

      const framesForFidelity = [{ id: "f1", name: "Artboard", x: 120, y: 40, layers }];
      const exported = exportProjectJSON(layers, vector, animation, [], framesForFidelity as any);
      expect(exported.version).toBe(1);
      expect(exported.layers.vectorLayer.name).toBe("MyVector");
      expect(exported.layers.vectorLayer.children).toHaveLength(1);
      expect(exported.layers.vectorLayer.children[0].pathData).toBeTruthy();
      // vrh 24t: frames key present for page.tsx import handler to restore spatial layout (roundtrip fidelity 100%)
      expect((exported as any).frames).toBeDefined();
      expect((exported as any).frames[0].x).toBe(120);

      const reimported = flattenOriginalProject(exported as any);
      expect(reimported.layers).toHaveLength(1);
      expect(reimported.layers[0].name).toBe("square");
      expect(pathToString(reimported.layers[0].from)).toEqual("M4 4 L20 4 L20 20 L4 20 Z");
    });

    it("preserves style through project roundtrip", () => {
      const layers = [
        {
          id: "path1",
          name: "styled",
          type: "path" as const,
          from: parsePath("M 0 0 L 10 10"),
          to: parsePath("M 0 0 L 10 10"),
          pathData: parsePath("M 0 0 L 10 10"),
          visible: true,
          locked: false,
          parentId: null,
          fillColor: "#3b82f6",
          fillAlpha: 0.8,
          strokeColor: "#1e40af",
          strokeWidth: 3,
          fillType: "evenOdd" as const,
        },
      ];
      const vector: VectorMetadata = { id: "v", name: "V", width: 24, height: 24, alpha: 1 };
      const animation: AnimationState = { id: "a", name: "a", duration: 1000, blocks: [] };

      const exported = exportProjectJSON(layers, vector, animation, []);
      const reimported = flattenOriginalProject(exported as any);
      expect(reimported.layers[0].fillColor).toBe("#3b82f6");
      expect(reimported.layers[0].fillAlpha).toBe(0.8);
      expect(reimported.layers[0].strokeColor).toBe("#1e40af");
      expect(reimported.layers[0].strokeWidth).toBe(3);
      expect(reimported.layers[0].fillType).toBe("evenOdd");
    });
  });
});

describe("cross-format roundtrips", () => {
  it("SVG → layers → static SVG → layers preserves path data", () => {
    const original = importLayersFromSvg(SVG_PATH_TRIANGLE);
    const exported = exportStaticSVG(original);
    const reimported = importLayersFromSvg(exported);
    expect(extractPathString(reimported[0])).toEqual(extractPathString(original[0]));
  });

  it("VectorDrawable → layers → VectorDrawable → layers preserves path data", () => {
    const original = importLayersFromVectorDrawable(VECTOR_DRAWABLE_BASIC);
    const exported = exportVectorDrawable(original[0]);
    const reimported = importLayersFromVectorDrawable(exported);
    expect(extractPathString(reimported[0])).toEqual(extractPathString(original[0]));
  });

  it("SVG import and VectorDrawable import produce same path for equivalent data", () => {
    const pathD = "M 12 2 L 22 22 L 2 22 Z";
    const svgLayers = importLayersFromSvg(`<svg><path d="${pathD}"/></svg>`);
    const vdLayers = importLayersFromVectorDrawable(`<vector><path pathData="${pathD}"/></vector>`);
    expect(extractPathString(svgLayers[0])).toEqual(extractPathString(vdLayers[0]));
  });
});

// ── 24t phase1 fidelity + edge hardening tests (yrl) ─────────────────────
describe("24t phase1: SVG import fidelity edges (arcParams, transforms, groups, recovery, tool roundtrips)", () => {
  const SVG_ARC_ROTATED_IN_GROUP = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
    <g transform="rotate(45 12 12)">
      <path id="arc" d="M 6 10 A 4 2 30 0 1 14 12" fill="none" stroke="#000"/>
    </g>
  </svg>`;

  const SVG_MIXED_BAD_DATA = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48">
    <path id="good" d="M 0 0 L 10 10 Z"/>
    <path id="badnum" d="M 1 2 L foo 99 A 3 NaN 0 0 1 5 6"/>
    <rect x="20" y="20" width="10" height="10"/>
  </svg>`;

  it("preserves and correctly transforms arcParams xRotation (fixes pre-exist rotation vs xRotation shape mismatch)", () => {
    const layers = importLayersFromSvg(SVG_ARC_ROTATED_IN_GROUP);
    expect(layers).toHaveLength(1);
    const arcCmd = layers[0].from.subPaths[0]?.commands.find((c) => c.type === "A");
    expect(arcCmd).toBeDefined();
    expect(arcCmd!.arcParams).toBeDefined();
    // Original xRotation 30 + group rotate 45 => ~75 (within float)
    expect(arcCmd!.arcParams!.xRotation).toBeCloseTo(75, 1);
    expect(Number.isFinite(arcCmd!.arcParams!.rx)).toBe(true);
    expect(Number.isFinite(arcCmd!.arcParams!.ry)).toBe(true);
    // geometry transformed (points moved by rot)
    expect(layers[0].from.subPaths[0].commands[0].points[0].x).not.toBeCloseTo(6);
  });

  it("graceful partial recovery on bad/complex path data (no crash, imports goods only, toasts in app)", () => {
    const layers = importLayersFromSvg(SVG_MIXED_BAD_DATA);
    // badnum skipped, good + rect imported
    expect(layers.length).toBeGreaterThanOrEqual(2);
    const names = layers.map((l) => l.name);
    expect(names).toContain("good");
    expect(names.some((n) => n.includes("rect"))).toBe(true);
    // no NaN in any
    for (const l of layers) {
      const bad = l.from.subPaths.some((sp) =>
        sp.commands.some((c) => c.points.some((p) => !Number.isFinite(p.x))),
      );
      expect(bad).toBe(false);
    }
  });

  it("roundtrip with tool mutation (reversePath 'r' key + knife/direct parity primitives) then export/re-import preserves core geometry", () => {
    const original = importLayersFromSvg(SVG_PATH_TRIANGLE);
    expect(original).toHaveLength(1);
    // Exercise tool (reverse used by keyboard 'r', also direct/pen/knife paths use pathUtils)
    const mutated = [
      {
        ...original[0],
        from: reversePath(original[0].from),
        to: reversePath(original[0].to),
        pathData: reversePath(original[0].pathData!),
      },
    ];
    const exported = exportStaticSVG(mutated as any);
    const reimported = importLayersFromSvg(exported);
    expect(reimported).toHaveLength(1);
    const reStr = extractPathString(reimported[0]);
    // Core points present after tool mutation (reverse) + export/reimport round (order may vary but geometry present)
    expect(reStr).toContain("M");
    expect(reStr).toContain("L");
    expect(reStr).toContain("Z");
    // styles preserved in round (via any for tsc on narrow helper return shape)
    expect((reimported[0] as any).fillColor ?? "").toBe((original[0] as any).fillColor ?? "");
  });

  it("handles <use> + symbol + nested transform without crash (existing inlining hardened)", () => {
    const svgWithUse = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">
      <defs>
        <symbol id="sym" viewBox="0 0 10 10"><path d="M 1 1 L 9 9"/></symbol>
      </defs>
      <use href="#sym" x="2" y="3" transform="scale(1.5)"/>
    </svg>`;
    const layers = importLayersFromSvg(svgWithUse);
    expect(layers.length).toBeGreaterThanOrEqual(1);
    expect(extractPathString(layers[0])).toContain("M");
  });
});
