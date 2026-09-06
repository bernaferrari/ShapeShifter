import {
  createDocumentV2FromLegacy,
  legacySnapshotFromDocumentV2,
  type LegacyDocumentSnapshot,
} from "../shapeshifter/documentModel";
import type { DocumentV2 } from "../shapeshifter/types";
import { PAGE_ROOT_ID } from "../shapeshifter/scene/owners";
import type { EditorState, HistoryEntry, HistorySession } from "./editorStore";
import { saveActiveFrame, saveActiveRoot, buildLoadedDocumentState } from "./workspaceState";

export function legacySnapshotFromEditor(state: EditorState): LegacyDocumentSnapshot {
  const frames = saveActiveFrame(state);
  const root = saveActiveRoot(state);
  return {
    id: state.documentV2?.id ?? String(state.vector.id ?? "document"),
    name: state.documentV2?.name ?? state.vector.name ?? "ShapeShifter",
    frames: frames.map((frame) => ({
      id: frame.id,
      name: frame.name,
      x: frame.x,
      y: frame.y,
      layers: frame.layers,
      vector: frame.vector,
      animation: frame.animation,
      hiddenLayerIds: frame.hiddenLayerIds,
    })),
    rootLayers: root.layers,
    rootVector: {
      id: "page",
      name: state.documentV2?.page.name ?? "Page",
      width: state.documentV2?.page.width ?? 24,
      height: state.documentV2?.page.height ?? 24,
      alpha: state.documentV2?.page.alpha ?? 1,
      viewportWidth: state.documentV2?.page.viewportWidth,
      viewportHeight: state.documentV2?.page.viewportHeight,
      widthUnit: state.documentV2?.page.widthUnit,
      heightUnit: state.documentV2?.page.heightUnit,
      tint: state.documentV2?.page.tint,
      tintMode: state.documentV2?.page.tintMode,
      autoMirrored: state.documentV2?.page.autoMirrored,
      minSdk: state.documentV2?.page.minSdk,
    },
    rootAnimation: root.animation,
    rootHiddenLayerIds: root.hiddenLayerIds,
  };
}

/** Commit the flushed workspace into the live DocumentV2 graph. */
export function commitDocumentV2(state: EditorState): DocumentV2 {
  return createDocumentV2FromLegacy(legacySnapshotFromEditor(state));
}

export function historySessionFromEditor(state: EditorState): HistorySession {
  return {
    selectedFrameId: state.selectedFrameId,
    selectedFrameIds: [...state.selectedFrameIds],
    selectedLayerId: state.selectedLayerId,
    selectedLayerIds: [...state.selectedLayerIds],
    selectedLayerRefs: state.selectedLayerRefs.map((ref) => ({ ...ref })),
    selection: state.selection ? structuredClone(state.selection) : null,
    selectedPoints: state.selectedPoints.map((point) => structuredClone(point)),
    selectedSubPaths: state.selectedSubPaths.map((subpath) => structuredClone(subpath)),
    editingSide: state.editingSide,
    hasCanvasSelection: state.hasCanvasSelection,
    selectionKind: state.selectionKind,
  };
}

export function snapshotHistoryEntry(state: EditorState): HistoryEntry {
  return {
    documentV2: commitDocumentV2(state),
    session: historySessionFromEditor(state),
  };
}

export function restoreHistoryEntry(state: EditorState, entry: HistoryEntry): Partial<EditorState> {
  const snapshot = legacySnapshotFromDocumentV2(entry.documentV2);
  const projected = buildLoadedDocumentState(snapshot);
  const session = entry.session;
  const selectedFrameId = session.selectedFrameId;
  const frames = projected.frames ?? [];
  const restoringPageRoot = selectedFrameId === PAGE_ROOT_ID;
  const layers = restoringPageRoot
    ? (projected.rootLayers ?? [])
    : (frames.find((frame) => frame.id === selectedFrameId)?.layers ?? projected.layers ?? []);
  const frame = frames.find((item) => item.id === selectedFrameId);
  return {
    ...projected,
    documentV2: entry.documentV2,
    selectedFrameId,
    selectedFrameIds: [...session.selectedFrameIds],
    layers,
    // buildLoadedDocumentState intentionally projects the first frame by default.
    // History must instead restore the page's active projection when the page root
    // was selected, including metadata that does not live on a frame.
    vector: restoringPageRoot
      ? structuredClone(snapshot.rootVector)
      : (frame?.vector ?? projected.vector),
    animation: restoringPageRoot
      ? structuredClone(snapshot.rootAnimation)
      : (frame?.animation ?? projected.animation),
    hiddenLayerIds: restoringPageRoot
      ? [...snapshot.rootHiddenLayerIds]
      : (frame?.hiddenLayerIds ?? projected.hiddenLayerIds),
    // Cameras are volatile session chrome (Figma preserves pan/zoom across
    // undo): keep whatever the user had instead of refitting to the document.
    worldViewport: state.worldViewport,
    detailViewport: state.detailViewport,
    selectedLayerId: session.selectedLayerId,
    selectedLayerIds: [...session.selectedLayerIds],
    selectedLayerRefs: session.selectedLayerRefs.map((ref) => ({ ...ref })),
    selection: session.selection ? structuredClone(session.selection) : null,
    selectedPoints: session.selectedPoints.map((point) => structuredClone(point)),
    selectedSubPaths: session.selectedSubPaths.map((subpath) => structuredClone(subpath)),
    editingSide: session.editingSide,
    hasCanvasSelection: session.hasCanvasSelection,
    selectionKind: session.selectionKind,
  };
}
