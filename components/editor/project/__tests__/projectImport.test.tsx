import { beforeEach, describe, expect, it } from "vitest";
import { exportProjectJSON } from "@/lib/shapeshifter/exporter";
import { PAGE_ROOT_ID, useEditorStore } from "@/lib/store/editorStore";
import { importEditorText } from "../useProjectImport";

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
});
