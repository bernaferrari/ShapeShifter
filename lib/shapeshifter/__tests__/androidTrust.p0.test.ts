// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import { compileAndroidArtboard } from "../androidCompiler";
import { BOOLEAN_OPERATIONS_ENABLED, booleanCombine } from "../path/booleanOperations";
import { areAndroidPathsMorphCompatible, parsePath, pathToString } from "../pathUtils";
import { gradientToSvg, sanitizeCssColor } from "../gradients";
import { exportStaticSVG } from "../exporter";
import { importVectorDrawable } from "../import/androidVectorDrawable";
import {
  compileLiveAndroidArtboard,
  flushLiveExportDocument,
  getLiveDocumentV2,
  serializeLiveProject,
} from "../../store/exportDocument";
import { prepareForMorph, scoreMorphQuality } from "../pathUtils";
import { useEditorStore } from "../../store/editorStore";
import type { Layer } from "../types";

function pathLayer(id: string, d: string, parentId?: string): Layer {
  const from = parsePath(d);
  return {
    id,
    name: id,
    type: "path",
    parentId,
    from,
    pathData: from,
    fillColor: "#ff0000",
    visible: true,
    locked: false,
  };
}

function groupLayer(id: string): Layer {
  return {
    id,
    name: id,
    type: "group",
    from: parsePath(""),
    visible: true,
    locked: false,
  };
}

describe("P0 Android trust", () => {
  beforeEach(() => {
    useEditorStore.getState().resetProject();
  });

  it("does not enable destructive Boolean commands", () => {
    expect(BOOLEAN_OPERATIONS_ENABLED).toBe(false);
    const before = useEditorStore.getState().layers.map((layer) => pathToString(layer.from));
    useEditorStore.getState().booleanCombine("union");
    const after = useEditorStore.getState().layers.map((layer) => pathToString(layer.from));
    expect(after).toEqual(before);
    const contained = booleanCombine(
      "intersect",
      parsePath("M0 0 L20 0 L20 20 L0 20 Z"),
      parsePath("M5 5 L10 5 L10 10 L5 10 Z"),
    );
    expect(pathToString(contained)).toContain("M");
    const disjoint = booleanCombine(
      "intersect",
      parsePath("M0 0 L10 0 L10 10 L0 10 Z"),
      parsePath("M20 20 L30 20 L30 30 L20 30 Z"),
    );
    expect(disjoint.subPaths).toHaveLength(0);
  });

  it("maps FAST_OUT_SLOW_IN as the named platform interpolator", () => {
    const bundle = compileAndroidArtboard({
      name: "Pulse",
      vector: { id: "v", name: "Pulse", width: 24, height: 24, alpha: 1 },
      layers: [pathLayer("heart", "M2 12 L12 22 L22 12 Z")],
      animation: {
        id: "motion",
        name: "Pulse",
        duration: 1000,
        blocks: [
          {
            id: "move",
            layerId: "heart",
            propertyName: "translateX",
            fromValue: 0,
            toValue: 4,
            startTime: 0,
            endTime: 400,
            interpolator: "FAST_OUT_SLOW_IN",
          },
        ],
      },
    });
    expect(
      bundle.diagnostics.some((diagnostic) => diagnostic.code === "INTERPOLATOR_FALLBACK"),
    ).toBe(false);
    expect(
      bundle.files.some((file) => file.content.includes("@android:interpolator/fast_out_slow_in")),
    ).toBe(true);
  });

  it("emits gradient coordinates in viewport space and re-imports aapt fills", () => {
    const bundle = compileAndroidArtboard({
      name: "Grad",
      vector: {
        id: "v",
        name: "Grad",
        width: 24,
        height: 24,
        viewportWidth: 48,
        viewportHeight: 48,
        alpha: 1,
      },
      layers: [
        {
          ...pathLayer("fill", "M0 0 L48 0 L48 48 L0 48 Z"),
          fillGradient: {
            type: "linear",
            angle: 0,
            stops: [
              { offset: 0, color: "#ff0000", opacity: 1 },
              { offset: 1, color: "#0000ff", opacity: 1 },
            ],
          },
        },
      ],
      animation: { id: "none", name: "none", duration: 1, blocks: [] },
    });
    const xml = bundle.files.find((file) => file.path.endsWith("_vector.xml"))!.content;
    expect(xml).toContain("<aapt:attr");
    expect(xml).toContain('android:endX="48"');
    const imported = importVectorDrawable(xml);
    expect(imported.layers[0]?.fillGradient?.stops.length).toBeGreaterThanOrEqual(2);
    expect(imported.layers[0]?.fillGradient?.stops[0]?.color.toLowerCase()).toContain("ff");
  });

  it("exports parentId groups and clip-path references from the scene tree", () => {
    const svg = exportStaticSVG([
      groupLayer("group"),
      {
        ...pathLayer("clip", "M0 0 L6 0 L6 10 L0 10 Z", "group"),
        type: "clipPath",
      },
      pathLayer("art", "M0 0 L10 0 L10 10 L0 10 Z", "group"),
    ]);
    expect(svg).toContain('<g id="group"');
    expect(svg).toContain('<clipPath id="ss-clip-clip"');
    expect(svg).toContain('clip-path="url(#ss-clip-clip)"');
    expect(svg).toContain(pathToString(parsePath("M0 0 L10 0 L10 10 L0 10 Z")));
  });

  it("refuses to interpolate incompatible Android morphs", () => {
    expect(
      areAndroidPathsMorphCompatible(parsePath("M0 0 L10 10"), parsePath("M0 0 C2 2 8 8 10 10")),
    ).toBe(false);
    const bundle = compileAndroidArtboard({
      name: "Morph",
      vector: { id: "v", name: "Morph", width: 24, height: 24, alpha: 1 },
      layers: [pathLayer("shape", "M0 0 L10 10")],
      animation: {
        id: "motion",
        name: "Morph",
        duration: 1000,
        blocks: [
          {
            id: "morph",
            layerId: "shape",
            propertyName: "pathData",
            fromValue: "M0 0 L10 10",
            toValue: "M0 0 C2 2 8 8 10 10",
            startTime: 0,
            endTime: 1000,
          },
        ],
      },
    });
    expect(
      bundle.diagnostics.some((diagnostic) => diagnostic.code === "INCOMPATIBLE_PATH_MORPH"),
    ).toBe(true);
  });

  it("sanitizes hostile gradient colors and ids before SVG markup", () => {
    expect(sanitizeCssColor(`#ff0000" /><script>alert(1)</script>`)).toBe("#000000");
    const svg = gradientToSvg(
      {
        type: "linear",
        stops: [
          { offset: 0, color: `#fff" /><script>x</script>`, opacity: 1 },
          { offset: 1, color: "#0000ff", opacity: 1 },
        ],
      },
      `bad" id="x`,
    );
    expect(svg).not.toContain("<script>");
    expect(svg).not.toContain(`id="bad"`);
    expect(svg).toContain('stop-color="#000000"');
  });

  it("keeps hide bits in lockstep and flushes live layers into the Android compiler", () => {
    const store = useEditorStore.getState();
    const first = store.layers[0]!;
    store.addLayer("path");
    const added = useEditorStore.getState().layers.at(-1)!;
    store.toggleOwnedLayerVisibility(store.selectedFrameId, first.id);
    expect(useEditorStore.getState().hiddenLayerIds).toContain(String(first.id));
    store.toggleOwnedLayerVisibility(store.selectedFrameId, first.id);
    expect(useEditorStore.getState().hiddenLayerIds).not.toContain(String(first.id));

    const live = flushLiveExportDocument();
    expect(live.layers.some((layer) => String(layer.id) === String(added.id))).toBe(true);
    const bundle = compileLiveAndroidArtboard();
    expect(bundle.files.some((file) => file.path.endsWith("_vector.xml"))).toBe(true);
    expect(
      bundle.files.some(
        (file) =>
          file.content.includes(String(added.name).toLowerCase().replace(/\s+/g, "_")) ||
          file.content.includes("path"),
      ),
    ).toBe(true);
  });

  it("deletes and duplicates a group subtree", () => {
    const store = useEditorStore.getState();
    store.addLayer("group");
    const group = useEditorStore.getState().layers.at(-1)!;
    store.addLayer("path");
    const child = useEditorStore.getState().layers.at(-1)!;
    useEditorStore.setState({
      layers: useEditorStore
        .getState()
        .layers.map((layer) =>
          String(layer.id) === String(child.id) ? { ...layer, parentId: group.id } : layer,
        ),
    });
    store.selectLayers([group.id]);
    store.duplicateSelectedLayersOffset(4, 0);
    const afterDup = useEditorStore.getState().layers;
    const copies = afterDup.filter((layer) => layer.name === `${group.name} copy`);
    expect(copies).toHaveLength(1);
    const copyChildren = afterDup.filter(
      (layer) => String(layer.parentId) === String(copies[0]!.id),
    );
    expect(copyChildren.length).toBeGreaterThan(0);

    store.selectLayers([group.id]);
    store.deleteSelectedLayers();
    const remaining = useEditorStore.getState().layers;
    expect(remaining.some((layer) => String(layer.id) === String(group.id))).toBe(false);
    expect(remaining.some((layer) => String(layer.parentId) === String(group.id))).toBe(false);
  });

  it("serializes a flushed project and a live DocumentV2", () => {
    const project = serializeLiveProject();
    expect(project.documentV2?.version).toBe(2);
    expect(getLiveDocumentV2().version).toBe(2);
  });

  it("persists an inspectable MorphMapping from prepareForMorph", () => {
    const prepared = prepareForMorph(parsePath("M0 0 L10 10 Z"), parsePath("M1 1 L9 9 Z"));
    expect(prepared.mapping.alignments.kind).toBe("prepared");
    expect(scoreMorphQuality(prepared.from, prepared.to).compatible).toBe(true);
  });

  it("commits added layers into the live DocumentV2 and restores that graph on undo", () => {
    const before = Object.keys(getLiveDocumentV2().nodes).length;
    useEditorStore.getState().addLayer("path");
    const added = useEditorStore.getState().layers.at(-1)!;
    const live = getLiveDocumentV2();
    expect(Object.keys(live.nodes).length).toBeGreaterThan(before);
    expect(Object.values(live.nodes).some((node) => node.name === added.name)).toBe(true);
    expect(useEditorStore.getState().history.at(-1)?.documentV2).toBeDefined();
    expect(useEditorStore.getState().history.at(-1)?.session).toBeDefined();
    useEditorStore.getState().undo();
    expect(
      useEditorStore.getState().layers.some((layer) => String(layer.id) === String(added.id)),
    ).toBe(false);
  });

  it("keeps source geometry until a morph preview is applied", () => {
    const layer = useEditorStore.getState().layers.find((item) => item.to)!;
    useEditorStore.getState().selectLayer(layer.id);
    const fromBefore = pathToString(layer.from);
    expect(useEditorStore.getState().previewPrepareForMorph()).toBe(true);
    expect(
      pathToString(useEditorStore.getState().layers.find((item) => item.id === layer.id)!.from),
    ).toBe(fromBefore);
    expect(useEditorStore.getState().morphPreview?.mapping.alignments.kind).toBe("prepared");
    useEditorStore.getState().cancelMorphPreview();
    expect(useEditorStore.getState().morphPreview).toBeNull();
    expect(
      pathToString(useEditorStore.getState().layers.find((item) => item.id === layer.id)!.from),
    ).toBe(fromBefore);
  });
});
