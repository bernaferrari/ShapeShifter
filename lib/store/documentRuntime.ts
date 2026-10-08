import {
  buildEditorDocument,
  workspaceFromDocument,
  type WorkspaceSnapshot,
} from "../pathshift/documentModel";
import type { EditorDocument } from "../pathshift/types";
import { PAGE_ROOT_ID } from "../pathshift/scene/owners";
import type { EditorState, HistoryEntry, HistorySession } from "./editorStore";
import { saveActiveFrame, saveActiveRoot, buildLoadedDocumentState } from "./workspaceState";

export function workspaceFromEditor(state: EditorState): WorkspaceSnapshot {
  const frames = saveActiveFrame(state);
  const root = saveActiveRoot(state);
  return {
    id: state.document?.id ?? String(state.vector.id ?? "document"),
    name: state.document?.name ?? state.vector.name ?? "Pathshift",
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
      name: state.document?.page.name ?? "Page",
      width: state.document?.page.width ?? 24,
      height: state.document?.page.height ?? 24,
      alpha: state.document?.page.alpha ?? 1,
      viewportWidth: state.document?.page.viewportWidth,
      viewportHeight: state.document?.page.viewportHeight,
      widthUnit: state.document?.page.widthUnit,
      heightUnit: state.document?.page.heightUnit,
      tint: state.document?.page.tint,
      tintMode: state.document?.page.tintMode,
      autoMirrored: state.document?.page.autoMirrored,
      minSdk: state.document?.page.minSdk,
    },
    rootAnimation: root.animation,
    rootHiddenLayerIds: root.hiddenLayerIds,
  };
}

/** Commit the flushed workspace into the live EditorDocument graph. */
export function buildDocumentFromEditor(state: EditorState): EditorDocument {
  return buildEditorDocument(workspaceFromEditor(state));
}

export function historySessionFromEditor(state: EditorState): HistorySession {
  return {
    selectedFrameId: state.selectedFrameId,
    selectedFrameIds: [...state.selectedFrameIds],
    selectedLayerId: state.selectedLayerId,
    selectedLayerIds: [...state.selectedLayerIds],
    selectedLayerRefs: state.selectedLayerRefs.map((ref) => ({ ...ref })),
    selectedBlockIds: [...state.selectedBlockIds],
    isActionMode: state.isActionMode,
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
    document: state.document,
    session: historySessionFromEditor(state),
  };
}

export function restoreHistoryEntry(state: EditorState, entry: HistoryEntry): Partial<EditorState> {
  const snapshot = workspaceFromDocument(entry.document);
  const projected = buildLoadedDocumentState(snapshot);
  const session = entry.session;
  const selectedFrameId = session.selectedFrameId;
  const frames = projected.frames ?? [];
  const restoringPageRoot = selectedFrameId === PAGE_ROOT_ID;
  const layers = restoringPageRoot
    ? (projected.rootLayers ?? [])
    : (frames.find((frame) => frame.id === selectedFrameId)?.layers ?? projected.layers ?? []);
  const frame = frames.find((item) => item.id === selectedFrameId);
  const animation = restoringPageRoot
    ? structuredClone(snapshot.rootAnimation)
    : (frame?.animation ?? projected.animation);
  return {
    ...projected,
    document: entry.document,
    selectedFrameId,
    selectedFrameIds: [...session.selectedFrameIds],
    layers,
    // buildLoadedDocumentState intentionally projects the first frame by default.
    // History must instead restore the page's active projection when the page root
    // was selected, including metadata that does not live on a frame.
    vector: restoringPageRoot
      ? structuredClone(snapshot.rootVector)
      : (frame?.vector ?? projected.vector),
    animation,
    hiddenLayerIds: restoringPageRoot
      ? [...snapshot.rootHiddenLayerIds]
      : (frame?.hiddenLayerIds ?? projected.hiddenLayerIds),
    // Cameras are volatile session chrome (Figma preserves pan/zoom across
    // undo): keep whatever the user had instead of refitting to the document.
    worldViewport: state.worldViewport,
    detailViewport: state.detailViewport,
    // Undo restores authored motion while the user's playhead stays where they
    // were editing. Pause before previewing the restored pose.
    progress: state.progress,
    isPlaying: false,
    // Restored authored state invalidates any pointer session's ownership token.
    dragState: null,
    selectedLayerId: session.selectedLayerId,
    selectedLayerIds: [...session.selectedLayerIds],
    selectedLayerRefs: session.selectedLayerRefs.map((ref) => ({ ...ref })),
    selectedBlockIds: (session.selectedBlockIds ?? state.selectedBlockIds).filter((id) =>
      animation?.blocks.some((block) => block.id === id),
    ),
    isActionMode:
      (session.isActionMode ?? state.isActionMode) &&
      layers.some((layer) => String(layer.id) === String(session.selectedLayerId)),
    selection: session.selection ? structuredClone(session.selection) : null,
    selectedPoints: session.selectedPoints.map((point) => structuredClone(point)),
    selectedSubPaths: session.selectedSubPaths.map((subpath) => structuredClone(subpath)),
    editingSide: session.editingSide,
    hasCanvasSelection: session.hasCanvasSelection,
    selectionKind: session.selectionKind,
  };
}
