// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import { legacyProjectionIssues, validateDocumentV2 } from "@/lib/shapeshifter/documentModel";
import { exportProjectJSON } from "@/lib/shapeshifter/exporter";
import type { DocumentV2 } from "@/lib/shapeshifter/types";
import { createZip } from "@/lib/shapeshifter/zip";
import { PAGE_ROOT_ID, useEditorStore } from "@/lib/store/editorStore";
import malformedDocumentV2LegacyEnvelope from "./fixtures/malformed-document-v2-legacy-envelope.json";
import oldMultiframeLegacyEnvelope from "./fixtures/old-multiframe-legacy-envelope.json";
import { importEditorText, importEditorZip } from "../useProjectImport";

describe("project import pipeline", () => {
  beforeEach(() => {
    useEditorStore.getState().resetProject();
  });

  it("round-trips every frame, animation owner, and page-root vector through documentV2", () => {
    const store = useEditorStore.getState();
    const firstFrameId = store.frames[0].id;
    const firstLayerId = store.layers[0].id;
    store.selectLayer(firstLayerId);
    store.translateSelectedLayer(13, -9, { recordHistory: false });
    store.addTimelineBlock(firstLayerId, "rotation");
    store.syncActiveOwner({ includeAnimation: true });
    store.moveSelectedLayersToRoot({ recordHistory: false });
    const rootLayerId = useEditorStore.getState().selectedLayerId;
    useEditorStore.getState().syncActiveOwner({ includeAnimation: true });

    const exported = useEditorStore.getState();
    const payload = exportProjectJSON(
      exported.layers,
      exported.vector,
      exported.animation,
      exported.hiddenLayerIds,
      exported.frames,
      {
        layers: exported.selectedFrameId === PAGE_ROOT_ID ? exported.layers : exported.rootLayers,
        animation:
          exported.selectedFrameId === PAGE_ROOT_ID ? exported.animation : exported.rootAnimation,
        hiddenLayerIds:
          exported.selectedFrameId === PAGE_ROOT_ID
            ? exported.hiddenLayerIds
            : exported.rootHiddenLayerIds,
      },
    );
    const frameIds = exported.frames.map((frame) => frame.id);
    const frameLayerNames = exported.frames.map((frame) => frame.layers.map((layer) => layer.name));

    useEditorStore.getState().resetProject();
    const summary = importEditorText("roundtrip.shapeshifter", JSON.stringify(payload));

    const restored = useEditorStore.getState();
    expect(summary.title).toContain(exported.vector.name);
    expect(restored.frames.map((frame) => frame.id)).toEqual(frameIds);
    expect(restored.frames.map((frame) => frame.layers.map((layer) => layer.name))).toEqual(
      frameLayerNames,
    );
    expect(restored.frames.find((frame) => frame.id === firstFrameId)?.layers).not.toContainEqual(
      expect.objectContaining({ id: firstLayerId }),
    );
    expect(restored.rootLayers).toContainEqual(expect.objectContaining({ id: rootLayerId }));
    expect(restored.rootLayers.find((layer) => layer.id === rootLayerId)?.translateX).toBeCloseTo(
      13,
    );
    expect(restored.rootLayers.find((layer) => layer.id === rootLayerId)?.translateY).toBeCloseTo(
      -9,
    );
  });

  it("recovers every legacy frame and page-root owner when documentV2 is malformed", () => {
    expect(() => validateDocumentV2(malformedDocumentV2LegacyEnvelope.documentV2)).not.toThrow();
    expect(validateDocumentV2(malformedDocumentV2LegacyEnvelope.documentV2)).not.toEqual([]);

    const summary = importEditorText(
      "malformed-v2.shapeshifter",
      JSON.stringify(malformedDocumentV2LegacyEnvelope),
    );
    const restored = useEditorStore.getState();
    const sun = restored.frames.find((frame) => frame.id === "frame-sun");
    const moon = restored.frames.find((frame) => frame.id === "frame-moon");

    expect(summary.description).toContain("Recovered 2 frame(s)");
    expect(restored.frames.map((frame) => frame.id)).toEqual(["frame-sun", "frame-moon"]);
    expect(sun).toMatchObject({
      name: "Sun",
      x: 120,
      y: -40,
      vector: {
        width: 24,
        height: 18,
        viewportWidth: 48,
        viewportHeight: 36,
        tint: "#ffcc00",
        autoMirrored: true,
        minSdk: 24,
      },
      animation: {
        id: "sun-motion",
        blocks: [expect.objectContaining({ id: "sun-move", layerId: "sun-ray" })],
      },
      hiddenLayerIds: ["sun-hidden"],
    });
    expect(sun?.layers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "sun-group", rotation: 15 }),
        expect.objectContaining({
          id: "sun-ray",
          parentId: "sun-group",
          fillType: "evenOdd",
          morphMapping: expect.objectContaining({ id: "sun-ray-mapping" }),
        }),
        expect.objectContaining({
          id: "sun-hidden",
          parentId: "sun-group",
          locked: true,
          visible: false,
        }),
      ]),
    );
    expect(moon).toMatchObject({
      name: "Moon",
      x: -16,
      y: 72,
      vector: { viewportWidth: 64, viewportHeight: 64 },
      animation: { id: "moon-motion" },
    });

    expect(restored.documentV2.page).toMatchObject({
      name: "Canvas illustration",
      width: 144,
      height: 88,
      viewportWidth: 288,
      viewportHeight: 176,
      widthUnit: "px",
      tint: "#1d4ed8",
      tintMode: "multiply",
      autoMirrored: true,
      minSdk: 26,
    });
    expect(restored.rootAnimation).toMatchObject({
      id: "page-motion",
      blocks: [expect.objectContaining({ id: "page-shift", layerId: "page-visible" })],
    });
    expect(restored.rootHiddenLayerIds).toEqual(["page-hidden"]);
    expect(restored.rootLayers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "page-visible", fillGradient: expect.any(Object) }),
        expect.objectContaining({ id: "page-hidden", fillColor: "#ffffff", visible: false }),
      ]),
    );
    expect(
      Object.values(restored.documentV2.nodes).find((node) => node.id.endsWith(":sun-hidden"))
        ?.visible,
    ).toBe(false);
    expect(
      Object.values(restored.documentV2.nodes).find((node) => node.id.endsWith(":page-hidden"))
        ?.visible,
    ).toBe(false);
    expect(validateDocumentV2(restored.documentV2)).toEqual([]);
  });

  it("recovers old multi-frame exports that predate the pageRoot envelope", () => {
    expect(validateDocumentV2(oldMultiframeLegacyEnvelope.documentV2)).not.toEqual([]);

    const summary = importEditorText(
      "old-multiframe.shapeshifter",
      JSON.stringify(oldMultiframeLegacyEnvelope),
    );
    const restored = useEditorStore.getState();

    expect(summary.description).toContain("Recovered 2 frame(s)");
    expect(restored.frames.map((frame) => frame.id)).toEqual(["old-frame-one", "old-frame-two"]);
    expect(restored.frames.map((frame) => frame.layers[0]?.name)).toEqual([
      "Frame one path",
      "Frame two path",
    ]);
    expect(restored.rootLayers).toContainEqual(
      expect.objectContaining({ id: "old-page-path", name: "Legacy page path" }),
    );
    expect(restored.documentV2.page).toMatchObject({
      name: "Legacy page vector",
      width: 48,
      height: 32,
    });
  });

  it("recovers the legacy envelope instead of silently dropping orphaned V2 records", () => {
    const source = useEditorStore.getState();
    const sourceFrameId = source.selectedFrameId;
    const sourceLayerId = source.layers[0]!.id;
    const payload = exportProjectJSON(
      source.layers,
      source.vector,
      source.animation,
      source.hiddenLayerIds,
      source.frames,
      {
        layers: source.rootLayers,
        animation: source.rootAnimation,
        hiddenLayerIds: source.rootHiddenLayerIds,
      },
    );
    const document = payload.documentV2 as DocumentV2;
    const frame = document.frames[sourceFrameId]!;
    const orphanNodeId = frame.childrenNodeIds[0]!;
    const orphanClipId = frame.clipIds[0]!;
    const orphanTrackId = document.clips[orphanClipId]!.trackIds[0]!;
    const orphanKeyframeId = document.tracks[orphanTrackId]!.keyframeIds[0]!;

    expect(validateDocumentV2(document)).toEqual([]);
    frame.childrenNodeIds = [];
    frame.clipIds = [];
    expect(validateDocumentV2(document)).toEqual(
      expect.arrayContaining([
        `Node ${orphanNodeId} is not reachable from page or frame roots.`,
        `Clip ${orphanClipId} is not reachable from page or frame clip lists.`,
        `Track ${orphanTrackId} is not reachable from an animation clip.`,
        `Keyframe ${orphanKeyframeId} is not reachable from an animation track.`,
      ]),
    );

    const summary = importEditorText("orphaned-v2.shapeshifter", JSON.stringify(payload));
    const restored = useEditorStore.getState();

    expect(summary.description).toContain(`Recovered ${source.frames.length} frame(s)`);
    expect(restored.frames.find((frame) => frame.id === sourceFrameId)?.layers).toContainEqual(
      expect.objectContaining({ id: sourceLayerId }),
    );
  });

  it("refuses a damaged V2 envelope instead of collapsing it to the top-level legacy vector", () => {
    const source = useEditorStore.getState();
    const before = structuredClone(source.documentV2);
    const payload = exportProjectJSON(
      source.layers,
      source.vector,
      source.animation,
      source.hiddenLayerIds,
      source.frames,
      {
        layers: source.rootLayers,
        animation: source.rootAnimation,
        hiddenLayerIds: source.rootHiddenLayerIds,
      },
    );
    const document = payload.documentV2 as DocumentV2;
    document.frameIds.push("missing-frame");
    // Simulate an envelope damaged alongside the canonical graph. Its top-level
    // original-project wrapper remains parseable but does not contain every owner.
    payload.pageRoot = null;

    expect(() => importEditorText("broken-envelope.shapeshifter", JSON.stringify(payload))).toThrow(
      "Invalid document: Frame missing-frame is missing or malformed.",
    );
    expect(useEditorStore.getState().documentV2).toEqual(before);
  });

  it("surfaces unsupported AVD timing in the import summary", () => {
    const summary = importEditorZip(
      "sequential-avd.zip",
      createZip([
        {
          path: "res/drawable/icon.xml",
          content: `
            <vector xmlns:android="http://schemas.android.com/apk/res/android"
                android:width="24dp" android:height="24dp"
                android:viewportWidth="24" android:viewportHeight="24">
              <path android:name="shape" android:pathData="M0,0 L24,0 L24,24 Z"
                  android:fillColor="#ff3366" />
            </vector>`,
        },
        {
          path: "res/drawable/icon_animated.xml",
          content: `
            <animated-vector xmlns:android="http://schemas.android.com/apk/res/android"
                android:drawable="@drawable/icon">
              <target android:name="shape" android:animation="@animator/sequence" />
            </animated-vector>`,
        },
        {
          path: "res/animator/sequence.xml",
          content: `
            <set xmlns:android="http://schemas.android.com/apk/res/android" android:ordering="sequentially">
              <objectAnimator android:propertyName="fillAlpha" android:valueFrom="1"
                  android:valueTo="0" android:duration="100" />
              <objectAnimator android:propertyName="translateX" android:valueFrom="0"
                  android:valueTo="4" android:duration="100" />
            </set>`,
        },
      ]),
    );

    expect(summary.description).toContain("1 timing warning");
    expect(summary.description).toContain("sequential");
  });

  it("refuses a valid native V2 graph that the legacy runtime would downgrade", () => {
    const before = structuredClone(useEditorStore.getState().documentV2);
    const native = structuredClone(before);
    native.components = { button: { id: "button" } };

    expect(validateDocumentV2(native)).toEqual([]);
    expect(legacyProjectionIssues(native)).toContain("reusable components");
    expect(() =>
      importEditorText("native-v2.shapeshifter", JSON.stringify({ documentV2: native })),
    ).toThrow("cannot be opened without loss");
    expect(useEditorStore.getState().documentV2).toEqual(before);
  });
});
