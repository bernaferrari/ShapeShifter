import { PAGE_ROOT_ID, type LayerSelectionRef } from "../../shapeshifter/scene/owners";
import type { EditorState } from "../editorStore";
import { cloneLayers, saveActiveFrame, saveActiveRoot } from "../workspaceState";

type SelectionActionKey =
  | "setSpacePanActive"
  | "selectLayer"
  | "selectLayers"
  | "selectLayerRefs"
  | "setEditingSide"
  | "startActionMode"
  | "closeActionMode";

type SetEditorState = (
  update: Partial<EditorState> | ((state: EditorState) => Partial<EditorState> | EditorState),
) => void;

function dedupeLayerSelectionRefs(refs: LayerSelectionRef[]): LayerSelectionRef[] {
  const unique: LayerSelectionRef[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const key = `${ref.ownerId}:${String(ref.layerId)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ ...ref });
  }
  return unique;
}

export function createSelectionActions(
  set: SetEditorState,
  get: () => EditorState,
): Pick<EditorState, SelectionActionKey> {
  return {
    setSpacePanActive: (active) => set({ spacePanActive: active }),

    selectLayer: (id) =>
      set((state) => ({
        selectedLayerId: id,
        selectedLayerIds: [id],
        selectedLayerRefs: [{ ownerId: state.selectedFrameId, layerId: id }],
        selection: null,
        selectedPoints: [],
        selectedSubPaths: [],
        selectedBlockIds: [],
        hasCanvasSelection: true,
        // Figma: selecting a child replaces frame selection — the layer is the selection.
        selectionKind: "layer",
        selectedFrameIds: [],
      })),

    selectLayers: (ids) => {
      const unique: (string | number)[] = [];
      const seen = new Set<string>();
      for (const id of ids) {
        const key = String(id);
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(id);
      }
      if (unique.length === 0) {
        get().deselectAll();
        return;
      }
      set({
        selectedLayerId: unique[unique.length - 1]!,
        selectedLayerIds: unique,
        selectedLayerRefs: unique.map((layerId) => ({
          ownerId: get().selectedFrameId,
          layerId,
        })),
        selection: null,
        selectedPoints: [],
        selectedSubPaths: [],
        selectedBlockIds: [],
        hasCanvasSelection: true,
        selectionKind: "layer",
        selectedFrameIds: [],
        // Multi-object selection uses Move tool (Figma leaves vector edit)
        toolMode: unique.length > 1 ? "select" : get().toolMode,
      });
    },

    selectLayerRefs: (refs) => {
      const unique = dedupeLayerSelectionRefs(refs);
      if (unique.length === 0) {
        get().deselectAll();
        return;
      }
      const state = get();
      const primary = unique[unique.length - 1]!;
      const ownerIds = unique
        .filter((ref) => ref.ownerId === primary.ownerId)
        .map((ref) => ref.layerId);
      if (primary.ownerId === state.selectedFrameId) {
        if (!state.layers.some((layer) => String(layer.id) === String(primary.layerId))) return;
        set({
          selectedLayerId: primary.layerId,
          selectedLayerIds: ownerIds,
          selectedLayerRefs: unique,
          selection: null,
          selectedPoints: [],
          selectedSubPaths: [],
          selectedBlockIds: [],
          hasCanvasSelection: true,
          selectionKind: "layer",
          selectedFrameIds: [],
          toolMode: "select",
        });
        return;
      }
      const savedFrames = saveActiveFrame(state);
      const savedRoot = saveActiveRoot(state);
      const ownerLayers =
        primary.ownerId === PAGE_ROOT_ID
          ? savedRoot.layers
          : savedFrames.find((frame) => frame.id === primary.ownerId)?.layers;
      if (!ownerLayers?.some((layer) => String(layer.id) === String(primary.layerId))) return;
      const primaryFrame = savedFrames.find((frame) => frame.id === primary.ownerId);
      set({
        frames: savedFrames,
        rootLayers: cloneLayers(savedRoot.layers),
        rootAnimation: structuredClone(savedRoot.animation),
        rootHiddenLayerIds: [...savedRoot.hiddenLayerIds],
        selectedFrameId: primary.ownerId,
        layers: cloneLayers(ownerLayers),
        ...(primary.ownerId === PAGE_ROOT_ID
          ? {
              vector: { id: PAGE_ROOT_ID, name: "Page", width: 1, height: 1, alpha: 1 },
              animation: structuredClone(savedRoot.animation),
              hiddenLayerIds: [...savedRoot.hiddenLayerIds],
            }
          : primaryFrame
            ? {
                vector: structuredClone(primaryFrame.vector),
                animation: structuredClone(primaryFrame.animation),
                hiddenLayerIds: [...primaryFrame.hiddenLayerIds],
              }
            : {}),
        selectedLayerId: primary.layerId,
        selectedLayerIds: ownerIds,
        selectedLayerRefs: unique,
        selection: null,
        selectedPoints: [],
        selectedSubPaths: [],
        selectedBlockIds: [],
        hasCanvasSelection: true,
        selectionKind: "layer",
        selectedFrameIds: [],
        toolMode: "select",
      });
    },
    setEditingSide: (side) =>
      set((state) => ({
        editingSide: side,
        selection: state.editingSide === side ? state.selection : null,
        selectedPoints: state.editingSide === side ? state.selectedPoints : [],
        selectedSubPaths: state.editingSide === side ? state.selectedSubPaths : [],
      })),
    startActionMode: () =>
      set({
        isActionMode: true,
        selection: null,
        selectedPoints: [],
        selectedSubPaths: [],
        // Enter morph edit ready to manipulate points directly (best default for "edit")
        toolMode: "direct",
      }),
    closeActionMode: () =>
      set({ isActionMode: false, selection: null, selectedPoints: [], selectedSubPaths: [] }),
  };
}
