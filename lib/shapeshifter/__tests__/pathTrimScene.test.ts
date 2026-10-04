import { describe, expect, it } from "vitest";
import { createPathLayer } from "../../store/defaultWorkspace";
import { compileAndroidArtboard } from "../androidCompiler";
import { exportStaticSVG, exportSvgSpritesheet } from "../exporter";
import { distanceToPath, isPointInPath, parsePath, pathToString } from "../pathUtils";
import { evaluateAndroidScene } from "../scene/evaluate";
import { hitTestOwnedLayers } from "../scene/hitTest";
import { getEvaluatedNodeBounds } from "../scene/selection";
import type { AnimationState, Layer } from "../types";

const still: AnimationState = { id: "motion", name: "Motion", duration: 1000, blocks: [] };
const shape = (patch: Partial<Layer> = {}) =>
  createPathLayer({
    id: "shape",
    name: "Shape",
    from: parsePath("M0 0L10 0L10 10L0 10Z"),
    fillColor: "#f00",
    visible: true,
    locked: false,
    ...patch,
  });

describe("shared Android trim geometry", () => {
  it("makes a filled and stroked empty trim invisible, unclickable, and unbounded without changing authored data", () => {
    const layer = shape({ strokeColor: "#000", strokeWidth: 2, trimPathEnd: 0 });
    const authored = pathToString(layer.from);
    const scene = evaluateAndroidScene([layer], still, 0);
    const node = scene.nodes[0]!;
    expect(node.d).toBe("");
    expect(node.path!.subPaths).toEqual([]);
    expect(getEvaluatedNodeBounds(scene, layer.id)).toBeNull();
    expect(
      hitTestOwnedLayers(
        [{ ownerId: "frame", origin: { x: 0, y: 0 }, layers: [layer] }],
        { x: 5, y: 5 },
        1,
      ),
    ).toBeNull();
    expect(pathToString(node.layer.from)).toBe(authored);
    expect(exportStaticSVG([layer])).not.toContain('<path id="Shape"');
  });

  it("implicitly closes partial fill geometry for hits without inventing a closing stroke", () => {
    const layer = shape({ trimPathEnd: 0.5 });
    const node = evaluateAndroidScene([layer], still, 0).nodes[0]!;
    expect(node.d).toBe("M0 0 L10 0 L10 10");
    expect(isPointInPath({ x: 8, y: 2 }, node.path!)).toBe(true);
    expect(isPointInPath({ x: 2, y: 8 }, node.path!)).toBe(false);
    expect(distanceToPath({ x: 5, y: 5 }, node.path!)).toBe(5);
    const owner = { ownerId: "frame", origin: { x: 100, y: 20 }, layers: [layer] };
    expect(hitTestOwnedLayers([owner], { x: 108, y: 22 }, 0)).toEqual({
      ownerId: "frame",
      layerId: "shape",
    });
    expect(hitTestOwnedLayers([owner], { x: 102, y: 28 }, 0)).toBeNull();
    expect(exportStaticSVG([layer])).toContain(`d="${node.d}"`);
  });

  it("trims animated geometry by local arc length before inherited transforms and keeps ordinary dashes", () => {
    const layer = shape({
      from: parsePath("M0 0L10 0"),
      fillColor: "none",
      strokeColor: "#000",
      strokeWidth: 1,
      strokeDasharray: "2 3",
      parentId: "group",
    });
    const group = shape({ id: "group", type: "group", scaleX: 2, translateX: 100 });
    const animation: AnimationState = {
      ...still,
      blocks: [
        {
          id: "morph",
          layerId: layer.id,
          propertyName: "pathData",
          fromValue: "M0 0L10 0",
          toValue: "M0 0L30 0",
          startTime: 0,
          endTime: 1000,
          interpolator: "LINEAR",
        },
        {
          id: "trim",
          layerId: layer.id,
          propertyName: "trimPathEnd",
          fromValue: 0,
          toValue: 1,
          startTime: 0,
          endTime: 1000,
          interpolator: "LINEAR",
        },
      ],
    };
    const scene = evaluateAndroidScene([group, layer], animation, 0.5);
    const node = scene.nodesById.get("shape")!;
    expect(node.d).toBe("M0 0 L10 0");
    expect(node.strokeDasharray).toBe("2 3");
    expect(node.trimPathEnd).toBe(0.5);
    const bounds = getEvaluatedNodeBounds(scene, layer.id)!;
    expect(bounds.x).toBe(99);
    expect(bounds.w).toBe(22);
  });

  it("ignores trim on Android clip paths", () => {
    const clip = shape({ type: "clipPath", trimPathEnd: 0 });
    expect(evaluateAndroidScene([clip], still, 0).nodes[0]!.d).toBe(pathToString(clip.from));
  });

  it("preserves raw geometry and native trim in Android resources, but applies static trim once in SVG frames", () => {
    const layer = shape({ trimPathStart: 0.25, trimPathEnd: 0.5 });
    const bundle = compileAndroidArtboard({
      name: "Trim",
      layers: [layer],
      animation: still,
      vector: { id: "vector", name: "Trim", width: 24, height: 24, alpha: 1 },
      hiddenLayerIds: [],
    });
    const vector = bundle.files.find((file) => file.path.endsWith("_vector.xml"))!.content;
    expect(vector).toContain(`android:pathData="${pathToString(layer.from)}"`);
    expect(vector).toContain('android:trimPathStart="0.25"');
    expect(vector).toContain('android:trimPathEnd="0.5"');
    const staticSvg = exportStaticSVG([layer]);
    expect(staticSvg).toContain('d="M10 0 L10 10"');
    const sheet = exportSvgSpritesheet(layer, { fps: 2, duration: 1 });
    expect(sheet.match(/d="M10 0 L10 10"/g)).toHaveLength(2);
    expect(sheet).not.toContain(pathToString(layer.from));
  });
});
