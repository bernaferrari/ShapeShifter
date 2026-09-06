import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "../editorStore";
import { androidPathMorphSignature } from "../../shapeshifter/pathUtils";
import type { Selection } from "../../shapeshifter/types";

function freshStore() {
  useEditorStore.getState().resetProject();
  return useEditorStore.getState();
}

function getStore() {
  return useEditorStore.getState();
}

function makeSelection(layerId: string | number): Selection {
  return {
    layerId,
    side: "from",
    subPathIndex: 0,
    commandIndex: 1,
    pointIndex: 0,
  };
}

describe("vectorPathActions morph parity", () => {
  beforeEach(() => {
    freshStore();
  });

  describe("splitSelectedCommand", () => {
    it("splits BOTH sides of a morph layer so from/to stay interpolatable", () => {
      const layer = getStore().layers[0]!;
      expect(layer.to).toBeDefined(); // default project layers are morph pairs
      const beforeFrom = layer.from.subPaths[0]!.commands.length;
      const beforeTo = layer.to!.subPaths[0]!.commands.length;
      expect(beforeFrom).toBe(beforeTo);
      getStore().selectPoint(makeSelection(layer.id));

      getStore().splitSelectedCommand();

      const updated = getStore().layers.find((candidate) => candidate.id === layer.id)!;
      expect(updated.from.subPaths[0]!.commands.length).toBe(beforeFrom + 1);
      expect(updated.to!.subPaths[0]!.commands.length).toBe(beforeTo + 1);
      expect(androidPathMorphSignature(updated.from)).toBe(androidPathMorphSignature(updated.to!));
    });

    it("keeps the split mirrored when editing the to side", () => {
      const layer = getStore().layers[0]!;
      const beforeFrom = layer.from.subPaths[0]!.commands.length;
      const beforeTo = layer.to!.subPaths[0]!.commands.length;
      getStore().setEditingSide("to");
      getStore().selectPoint({ ...makeSelection(layer.id), side: "to" });

      getStore().splitSelectedCommand();

      const updated = getStore().layers.find((candidate) => candidate.id === layer.id)!;
      expect(updated.from.subPaths[0]!.commands.length).toBe(beforeFrom + 1);
      expect(updated.to!.subPaths[0]!.commands.length).toBe(beforeTo + 1);
    });
  });

  describe("setSelectedCommandAsFirst", () => {
    it("rotates BOTH sides of a closed morph layer so point correspondence survives", () => {
      // The heart/star frame has one closed morph pair.
      const heartFrame = getStore().frames.find((frame) => frame.id === "frame-heart-star")!;
      const layer = heartFrame.layers[0]!;
      getStore().selectFrame(heartFrame.id);
      getStore().selectPoint(makeSelection(layer.id));

      getStore().setSelectedCommandAsFirst();

      const updated = getStore().layers.find((candidate) => candidate.id === layer.id)!;
      const fromCmd = updated.from.subPaths[0]!.commands.map((command) => command.type);
      const toCmd = updated.to!.subPaths[0]!.commands.map((command) => command.type);
      // Same command sequence on both sides — the rotation is mirrored.
      expect(fromCmd).toEqual(toCmd);
      // The start vertex moved off the original first drawing command.
      expect(androidPathMorphSignature(updated.from)).toBe(androidPathMorphSignature(updated.to!));
    });

    it("leaves a static (to-less) layer's from side rotating alone", () => {
      const layer = getStore().layers[0]!;
      const staticLayer = {
        ...layer,
        id: `${layer.id}-static`,
        name: "Static",
        to: undefined,
        timeline: [],
      };
      useEditorStore.setState((state) => ({ layers: [...state.layers, staticLayer] }));
      getStore().selectLayer(staticLayer.id);
      getStore().selectPoint({ ...makeSelection(staticLayer.id), commandIndex: 2 });
      const before = staticLayer.from.subPaths[0]!.commands.map(
        (command) => `${command.type}:${JSON.stringify(command.points)}`,
      ).join("|");
      getStore().setSelectedCommandAsFirst();

      const updated = getStore()
        .layers.find((candidate) => candidate.id === staticLayer.id)!
        .from.subPaths[0]!.commands.map(
          (command) => `${command.type}:${JSON.stringify(command.points)}`,
        )
        .join("|");
      // Closed path rotated — geometry identical, starting command different.
      expect(updated).not.toBe(before);
    });
  });
});
