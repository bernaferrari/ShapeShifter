// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import { documentEditingIssues, validateEditorDocument } from "@/lib/shapeshifter/documentModel";
import { exportProjectJSON } from "@/lib/shapeshifter/exporter";
import { createZip } from "@/lib/shapeshifter/zip";
import { serializeLiveProject } from "@/lib/store/exportDocument";
import { PAGE_ROOT_ID, useEditorStore } from "@/lib/store/editorStore";
import { importEditorText, importEditorZip } from "../useProjectImport";

describe("project import pipeline", () => {
  beforeEach(() => {
    useEditorStore.getState().resetProject();
  });

  it("reopens the active page and preserves the native graph while navigating owners", () => {
    const store = useEditorStore.getState();
    store.selectLayer(store.layers[0].id);
    store.moveSelectedLayersToRoot();
    const project = serializeLiveProject();
    expect(project.activeOwnerId).toBe(PAGE_ROOT_ID);
    useEditorStore.getState().resetProject();
    importEditorText("page.shapeshifter", JSON.stringify(project));
    expect(useEditorStore.getState().selectedFrameId).toBe(PAGE_ROOT_ID);
    expect(useEditorStore.getState().document).toEqual(project.document);
    const document = useEditorStore.getState().document;
    useEditorStore.getState().selectFrame(document.frameIds[1]);
    expect(useEditorStore.getState().document).toBe(document);
    useEditorStore.getState().selectFrame(PAGE_ROOT_ID);
    expect(useEditorStore.getState().document).toBe(document);
  });
  it("undoes VectorDrawable geometry and root metadata together", () => {
    const before = useEditorStore.getState();
    const originalLayerIds = before.layers.map((layer) => layer.id);
    const originalVector = structuredClone(before.vector);
    const historyLength = before.history.length;
    importEditorText(
      "wide.xml",
      `<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="80dp" android:height="40dp" android:viewportWidth="160" android:viewportHeight="80" android:alpha="0.6"><path android:name="imported" android:fillColor="#ff0000" android:pathData="M0 0 L160 80"/></vector>`,
    );
    const imported = useEditorStore.getState();
    expect(imported.history).toHaveLength(historyLength + 1);
    expect(imported.vector).toMatchObject({
      width: 80,
      height: 40,
      viewportWidth: 160,
      viewportHeight: 80,
      alpha: 0.6,
    });
    expect(imported.layers).toHaveLength(originalLayerIds.length + 1);
    imported.undo();
    const { id: _projectionId, ...originalMetadata } = originalVector;
    expect(useEditorStore.getState().vector).toMatchObject(originalMetadata);
    expect(useEditorStore.getState().layers.map((layer) => layer.id)).toEqual(originalLayerIds);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().layers).toHaveLength(originalLayerIds.length + 1);
    expect(useEditorStore.getState().vector.viewportWidth).toBe(160);
  });

  it("round-trips every frame, animation owner, and page-root vector through document", () => {
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

  it("rejects damaged and obsolete project payloads without changing artwork", () => {
    const before = structuredClone(useEditorStore.getState().document);
    const damaged = structuredClone(before);
    damaged.frameIds.push("missing-frame");
    expect(() =>
      importEditorText(
        "damaged.shapeshifter",
        JSON.stringify({ format: "shapeshifter", document: damaged }),
      ),
    ).toThrow("Invalid project");
    expect(() =>
      importEditorText("old.shapeshifter", JSON.stringify({ version: 1, layers: [] })),
    ).toThrow("native ShapeShifter project");
    expect(useEditorStore.getState().document).toEqual(before);
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

  it("refuses unsupported content explicitly", () => {
    const before = structuredClone(useEditorStore.getState().document);
    const native = structuredClone(before);
    native.components = { button: { id: "button" } };

    expect(validateEditorDocument(native)).toEqual([]);
    expect(documentEditingIssues(native)).toContain("reusable components");
    expect(() =>
      importEditorText(
        "native-v2.shapeshifter",
        JSON.stringify({ format: "shapeshifter", document: native }),
      ),
    ).toThrow("Unsupported project content");
    expect(useEditorStore.getState().document).toEqual(before);
  });
});
