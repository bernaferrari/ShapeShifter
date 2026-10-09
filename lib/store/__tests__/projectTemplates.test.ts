import { beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "../editorStore";
import { BLANK_PRESETS, PROJECT_TEMPLATES, createBlankFrames } from "../projectTemplates";

const getStore = () => useEditorStore.getState();

describe("new project", () => {
  beforeEach(() => getStore().resetProject());

  it("starts a blank project on one empty artboard with the artboard selected", () => {
    getStore().resetProject(createBlankFrames("Badge", 48, 32));

    const state = getStore();
    expect(state.frames).toHaveLength(1);
    expect(state.frames[0]).toMatchObject({ name: "Badge", layers: [] });
    expect(state.vector).toMatchObject({ width: 48, height: 32 });
    expect(state.layers).toEqual([]);
    expect(state.animation.blocks).toEqual([]);
    expect(state.selectionKind).toBe("frame");
    expect(state.selectedFrameIds).toEqual([state.frames[0]!.id]);
    expect(state.selectedLayerRefs).toEqual([]);
  });

  it("can undo back to the previous project", () => {
    const before = getStore().frames.map((frame) => frame.name);
    getStore().resetProject(createBlankFrames("Untitled", 24, 24));
    getStore().undo();
    expect(getStore().frames.map((frame) => frame.name)).toEqual(before);
  });

  it("loads every template with its artwork and motion", () => {
    for (const template of PROJECT_TEMPLATES) {
      const frames = template.frames();
      getStore().resetProject(frames);
      const state = getStore();
      expect(state.frames.map((frame) => frame.id)).toEqual(frames.map((frame) => frame.id));
      expect(state.layers.length).toBeGreaterThan(0);
      expect(state.animation.blocks.length).toBeGreaterThan(0);
    }
  });

  it("ships templates whose colors are visible in the editor's #RRGGBBAA convention", () => {
    // Android's #AARRGGBB pasted verbatim (e.g. #ff000000) reads as transparent here.
    const transparent = /^#[\da-f]{6}00$/i;
    for (const template of PROJECT_TEMPLATES) {
      for (const frame of template.frames()) {
        for (const layer of frame.layers) {
          expect(layer.fillColor ?? "", `${template.id}/${layer.name} fill`).not.toMatch(
            transparent,
          );
          expect(layer.strokeColor ?? "", `${template.id}/${layer.name} stroke`).not.toMatch(
            transparent,
          );
        }
      }
    }
  });

  it("offers Android-sized blank presets", () => {
    expect(BLANK_PRESETS.map((preset) => [preset.width, preset.height])).toEqual([
      [24, 24],
      [48, 48],
      [108, 108],
    ]);
  });
});
