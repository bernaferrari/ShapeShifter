import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { parsePath, pathToString } from "../../shapeshifter/pathUtils";
import { PAGE_ROOT_ID, useEditorStore } from "../editorStore";
import {
  compileLiveAndroidArtboard,
  createAndroidExportZip,
  exportLiveDocument,
  exportLiveLottieDocument,
  LIVE_EXPORT_SCOPE,
  serializeLiveProject,
  summarizeAndroidWarnings,
} from "../exportDocument";
import { parseZip } from "../../shapeshifter/zip";

describe("live project export", () => {
  beforeEach(() => {
    useEditorStore.getState().resetProject();
  });

  it("preserves page metadata while a differently sized artboard is active", () => {
    const initial = useEditorStore.getState();
    const page = {
      ...initial.documentV2.page,
      name: "Document page",
      width: 360,
      height: 180,
      alpha: 0.65,
      viewportWidth: 720,
      viewportHeight: 360,
      widthUnit: "dp",
      heightUnit: "dp",
    };
    useEditorStore.setState({ documentV2: { ...initial.documentV2, page } });
    useEditorStore.getState().updateVector({
      name: "Active artboard",
      width: 24,
      height: 24,
      viewportWidth: 48,
      viewportHeight: 48,
    });

    const project = serializeLiveProject();

    expect(project.documentV2.page).toEqual(page);
    expect(project.pageRoot.vector).toMatchObject({
      id: PAGE_ROOT_ID,
      name: "Document page",
      width: 360,
      height: 180,
      viewportWidth: 720,
      viewportHeight: 360,
    });
  });

  it("projects page-root editing into the real page coordinate space", () => {
    const store = useEditorStore.getState();
    const selected = store.layers[0]!;
    store.moveSelectedLayersToRoot();
    const rootLayer = useEditorStore
      .getState()
      .rootLayers.find((layer) => layer.id === selected.id)!;
    const afterMove = useEditorStore.getState();
    useEditorStore.setState({
      documentV2: {
        ...afterMove.documentV2,
        page: {
          ...afterMove.documentV2.page,
          name: "Page geometry",
          width: 24,
          height: 24,
          viewportWidth: 48,
          viewportHeight: 48,
        },
      },
    });

    useEditorStore.getState().selectRootLayer(rootLayer.id);

    expect(useEditorStore.getState().selectedFrameId).toBe(PAGE_ROOT_ID);
    expect(useEditorStore.getState().vector).toMatchObject({
      id: PAGE_ROOT_ID,
      name: "Page geometry",
      width: 24,
      height: 24,
      viewportWidth: 48,
      viewportHeight: 48,
    });
    expect(
      useEditorStore.getState().detailViewport.x + useEditorStore.getState().detailViewport.w,
    ).toBeGreaterThanOrEqual(48);
  });

  it("persists page-root vector metadata through a live document flush", () => {
    const store = useEditorStore.getState();
    const selected = store.layers[0]!;
    store.moveSelectedLayersToRoot();
    store.updateVector({
      name: "Imported page vector",
      width: 32,
      height: 20,
      viewportWidth: 96,
      viewportHeight: 60,
      alpha: 0.7,
      tint: "#336699",
      tintMode: "src_in",
      autoMirrored: true,
      minSdk: 24,
    });

    expect(useEditorStore.getState().selectedFrameId).toBe(PAGE_ROOT_ID);
    expect(useEditorStore.getState().documentV2.page).toMatchObject({
      name: "Imported page vector",
      width: 32,
      height: 20,
      viewportWidth: 96,
      viewportHeight: 60,
      alpha: 0.7,
      tint: "#336699",
      tintMode: "src_in",
      autoMirrored: true,
      minSdk: 24,
    });

    const project = serializeLiveProject();
    expect(project.documentV2.page).toMatchObject({
      name: "Imported page vector",
      width: 32,
      height: 20,
      viewportWidth: 96,
      viewportHeight: 60,
      alpha: 0.7,
      tint: "#336699",
      tintMode: "src_in",
      autoMirrored: true,
      minSdk: 24,
    });
    expect(project.pageRoot.vector).toMatchObject({
      id: PAGE_ROOT_ID,
      name: "Imported page vector",
    });
    expect(useEditorStore.getState().rootLayers).toContainEqual(
      expect.objectContaining({ id: selected.id }),
    );
  });

  it("adds the same diagnostics report to every Android archive", () => {
    const files = parseZip(
      createAndroidExportZip({
        resourceName: "asset",
        files: [{ path: "res/drawable/asset_vector.xml", content: "<vector />" }],
        diagnostics: [
          {
            severity: "warning",
            code: "STROKE_DASHARRAY_UNSUPPORTED",
            message: "Dash pattern was omitted.",
          },
        ],
      }),
    );

    expect(files.find((file) => file.path === "SHAPESHIFTER_EXPORT.txt")?.content).toContain(
      "[WARNING] STROKE_DASHARRAY_UNSUPPORTED",
    );
  });

  it("keeps every non-blocking Android diagnostic available for download feedback", () => {
    expect(
      summarizeAndroidWarnings([
        { severity: "info", code: "INFO", message: "Informational only." },
        {
          severity: "warning",
          code: "STROKE_DASHARRAY_UNSUPPORTED",
          message: "Dash pattern was omitted.",
        },
        {
          severity: "warning",
          code: "CLIP_PATH_UNSUPPORTED",
          message: "Clip path was omitted.",
        },
        { severity: "error", code: "MORPH", message: "Morph cannot be exported." },
      ]),
    ).toEqual({
      count: 2,
      description: "Dash pattern was omitted. Clip path was omitted.",
    });
  });

  it("serializes the flushed live document through every save/export entry point", async () => {
    const store = useEditorStore.getState();
    expect(store.layers.length).toBeGreaterThanOrEqual(2);
    const artboardId = store.selectedFrameId;
    const edited = store.layers[0]!;
    const moved = store.layers[1]!;
    store.selectLayers([edited.id]);
    const nextPath = parsePath("M1 1 L9 1 L9 9 L1 9 Z");
    store.updateSelectedLayer({
      fillColor: "#112233",
      from: nextPath,
      pathData: nextPath,
    });
    store.addTimelineBlock(edited.id, "translateX");
    store.selectLayers([moved.id]);
    store.moveSelectedLayersToRoot();
    store.selectFrame(artboardId);
    store.selectLayers([edited.id]);

    const editedAfter = useEditorStore
      .getState()
      .layers.find((layer) => String(layer.id) === String(edited.id));
    expect(editedAfter).toBeDefined();
    const editedPath = pathToString(editedAfter!.from);
    expect(editedAfter!.fillColor).toBe("#112233");

    const project = serializeLiveProject();
    const dialogProject = JSON.parse((await exportLiveDocument("json")).content as string);
    const commandProject = JSON.parse((await exportLiveDocument("json")).content as string);
    const hasMovedLayer = (payload: { pageRoot?: { layers?: Array<{ id: string }> } }) =>
      Boolean(payload.pageRoot?.layers?.some((layer) => String(layer.id) === String(moved.id)));
    expect(hasMovedLayer(project)).toBe(true);
    expect(hasMovedLayer(dialogProject)).toBe(true);
    expect(hasMovedLayer(commandProject)).toBe(true);
    for (const payload of [project, dialogProject, commandProject]) {
      expect(JSON.stringify(payload)).toContain("#112233");
      expect(JSON.stringify(payload)).toContain(editedPath);
    }

    const lottie = exportLiveLottieDocument();
    const dialogLottie = JSON.parse((await exportLiveDocument("lottie")).content as string);
    const commandLottie = JSON.parse((await exportLiveDocument("lottie")).content as string);
    expect(dialogLottie).toEqual(lottie);
    expect(commandLottie).toEqual(lottie);
    expect(useEditorStore.getState().animation.blocks.some((block) => String(block.layerId) === String(edited.id))).toBe(
      true,
    );

    const android = compileLiveAndroidArtboard();
    const dialogAndroid = await exportLiveDocument("avd");
    const commandAndroid = await exportLiveDocument("vector");
    const androidXml = android.files.find((file) => file.path.endsWith("_vector.xml"))?.content ?? "";
    expect(androidXml).toContain("#112233");
    expect(androidXml).toContain(editedPath);
    expect(dialogAndroid.scope).toBe("artboard");
    expect(commandAndroid.scope).toBe("artboard");
    expect((await exportLiveDocument("svg")).scope).toBe("selected-layer");
    expect((await exportLiveDocument("css")).scope).toBe("selected-layer");
    expect(LIVE_EXPORT_SCOPE.svg).toBe("selected-layer");
    expect(LIVE_EXPORT_SCOPE.css).toBe("selected-layer");
    expect(LIVE_EXPORT_SCOPE.json).toBe("document");
    const dialogSource = readFileSync(
      new URL("../../../components/editor/ExportDialog.tsx", import.meta.url),
      "utf8",
    );
    const commandSource = readFileSync(
      new URL("../../../components/editor/project/useProjectExport.ts", import.meta.url),
      "utf8",
    );
    expect(dialogSource).toContain("exportLiveDocument");
    expect(commandSource).toContain("exportLiveDocument");
    expect(dialogSource).not.toContain("exportLottieDocument(");
    expect(commandSource).not.toContain("exportLottieDocument(");
  });
});
