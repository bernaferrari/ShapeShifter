import { ensureStableCommandIds } from "../shapeshifter/pathUtils";
import { computeDetailViewport, computeFitViewport } from "../shapeshifter/camera";
import { PAGE_ROOT_ID } from "../shapeshifter/scene/owners";
import type { AnimationState, Layer, PathData, VectorMetadata } from "../shapeshifter/types";
import type { EditorState, HistoryEntry } from "./editorStore";
import type { CanvasFrame } from "./defaultWorkspace";
import type { LegacyDocumentSnapshot } from "../shapeshifter/documentModel";

export const cloneLayers = (layers: Layer[]) => structuredClone(layers);

const mapEndPath = (layer: Layer, transform: (path: PathData) => PathData): PathData | undefined =>
  layer.to ? transform(layer.to) : undefined;

export function saveActiveRoot(state: EditorState) {
  return state.selectedFrameId === PAGE_ROOT_ID
    ? {
        layers: cloneLayers(state.layers),
        animation: structuredClone(state.animation),
        hiddenLayerIds: [...state.hiddenLayerIds],
      }
    : {
        layers: cloneLayers(state.rootLayers),
        animation: structuredClone(state.rootAnimation),
        hiddenLayerIds: [...state.rootHiddenLayerIds],
      };
}

export function cloneFrame(frame: CanvasFrame): CanvasFrame {
  return {
    ...frame,
    layers: cloneLayers(frame.layers),
    vector: structuredClone(frame.vector),
    animation: structuredClone(frame.animation),
    hiddenLayerIds: [...frame.hiddenLayerIds],
  };
}

function snapshotFrame(state: EditorState, frame?: CanvasFrame): CanvasFrame {
  return {
    id: frame?.id ?? state.selectedFrameId,
    name: frame?.name ?? state.vector.name ?? "Frame",
    x: frame?.x ?? 0,
    y: frame?.y ?? 0,
    layers: cloneLayers(state.layers),
    vector: structuredClone(state.vector),
    animation: structuredClone(state.animation),
    hiddenLayerIds: [...state.hiddenLayerIds],
  };
}

export function saveActiveFrame(state: EditorState) {
  return state.frames.map((frame) =>
    frame.id === state.selectedFrameId ? snapshotFrame(state, frame) : cloneFrame(frame),
  );
}

export function snapshotHistoryEntry(state: EditorState): HistoryEntry {
  const root = saveActiveRoot(state);
  return {
    frames: saveActiveFrame(state),
    selectedFrameId: state.selectedFrameId,
    selectedFrameIds: [...state.selectedFrameIds],
    rootLayers: root.layers,
    rootAnimation: root.animation,
    rootHiddenLayerIds: root.hiddenLayerIds,
    layers: cloneLayers(state.layers),
    vector: structuredClone(state.vector),
    animation: structuredClone(state.animation),
    hiddenLayerIds: [...state.hiddenLayerIds],
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

export function restoreHistoryEntry(state: EditorState, entry: HistoryEntry) {
  const layerExists = entry.layers.some((layer) => layer.id === entry.selectedLayerId);
  return {
    frames: entry.frames.map(cloneFrame),
    selectedFrameId: entry.selectedFrameId,
    selectedFrameIds: [...entry.selectedFrameIds],
    rootLayers: cloneLayers(entry.rootLayers),
    rootAnimation: structuredClone(entry.rootAnimation),
    rootHiddenLayerIds: [...entry.rootHiddenLayerIds],
    layers: entry.layers,
    vector: entry.vector,
    animation: entry.animation,
    hiddenLayerIds: entry.hiddenLayerIds,
    selectedLayerId: layerExists ? entry.selectedLayerId : (entry.layers[0]?.id ?? 0),
    selectedLayerIds: entry.selectedLayerIds,
    selectedLayerRefs: entry.selectedLayerRefs.map((ref) => ({ ...ref })),
    selection: entry.selection,
    selectedPoints: entry.selectedPoints,
    selectedSubPaths: entry.selectedSubPaths,
    editingSide: entry.editingSide,
    hasCanvasSelection: entry.hasCanvasSelection,
    selectionKind: entry.selectionKind,
  };
}

function normalizeLayerPaths(layer: Layer): Layer {
  return {
    ...layer,
    from: ensureStableCommandIds(layer.from),
    to: mapEndPath(layer, ensureStableCommandIds),
    ...(layer.pathData && { pathData: ensureStableCommandIds(layer.pathData) }),
  };
}

export function normalizeLayers(layers: Layer[]): Layer[] {
  return layers.map(normalizeLayerPaths);
}

export const getFirstEditableLayerId = (layers: Layer[]) =>
  layers.find((layer) => layer.type === "path" || layer.type === "clipPath")?.id ??
  layers[0]?.id ??
  0;

export function buildLoadedProjectState(
  project: {
    layers: Layer[];
    vector: VectorMetadata;
    animation: AnimationState;
    hiddenLayerIds: string[];
  },
  rootAnimation: AnimationState,
  fallbackName: string,
  frameId = `frame-${Date.now()}`,
): Partial<EditorState> {
  const layers = normalizeLayers(project.layers);
  const primaryLayerId = getFirstEditableLayerId(layers);
  const frame: CanvasFrame = {
    id: frameId,
    name: project.vector.name || fallbackName,
    x: 0,
    y: 0,
    layers: cloneLayers(layers),
    vector: structuredClone(project.vector),
    animation: structuredClone(project.animation),
    hiddenLayerIds: [...project.hiddenLayerIds],
  };
  return {
    frames: [frame],
    selectedFrameId: frame.id,
    selectedFrameIds: [],
    rootLayers: [],
    rootAnimation: structuredClone(rootAnimation),
    rootHiddenLayerIds: [],
    worldViewport: computeFitViewport([
      { x: 0, y: 0, w: frame.vector.width, h: frame.vector.height },
    ]),
    detailViewport: computeDetailViewport(frame.vector),
    layers: cloneLayers(layers),
    vector: structuredClone(project.vector),
    animation: structuredClone(project.animation),
    hiddenLayerIds: [...project.hiddenLayerIds],
    selectedLayerId: primaryLayerId,
    selectedLayerIds: layers.length ? [primaryLayerId] : [],
    selectedLayerRefs: layers.length ? [{ ownerId: frame.id, layerId: primaryLayerId }] : [],
    selection: null,
    selectedPoints: [],
    selectedSubPaths: [],
    hasCanvasSelection: layers.length > 0,
    selectionKind: layers.length ? "layer" : "frame",
    progress: 0,
    isPlaying: false,
    isActionMode: false,
    editingSide: "from",
    selectedBlockIds: [],
    collapsedLayerIds: [],
    timelineZoom: 1,
    timelineScrollX: 0,
    timelineScrollY: 0,
    timelineCollapsed: false,
    speed: 1,
    isSlowMotion: false,
    isRepeating: true,
    zoom: 1,
    snapToGrid: true,
    toolMode: "select",
    cursorType: "default",
    hoveredItem: null,
    dragState: null,
    clipboard: null,
  };
}

export function buildLoadedDocumentState(snapshot: LegacyDocumentSnapshot): Partial<EditorState> {
  const frames = snapshot.frames.map((source) => ({
    id: source.id,
    name: source.name,
    x: source.x,
    y: source.y,
    layers: normalizeLayers(source.layers),
    vector: structuredClone(source.vector),
    animation: structuredClone(source.animation),
    hiddenLayerIds: [...source.hiddenLayerIds],
  }));
  const rootLayers = normalizeLayers(snapshot.rootLayers);
  const activeFrame = frames[0];
  const selectedFrameId = activeFrame?.id ?? PAGE_ROOT_ID;
  const layers = activeFrame?.layers ?? rootLayers;
  const vector = activeFrame?.vector ?? structuredClone(snapshot.rootVector);
  const animation = activeFrame?.animation ?? structuredClone(snapshot.rootAnimation);
  const hiddenLayerIds = activeFrame?.hiddenLayerIds ?? [...snapshot.rootHiddenLayerIds];
  const selectedLayerId = getFirstEditableLayerId(layers);
  const hasLayers = layers.length > 0;
  const frameBounds = frames.map((frame) => ({
    x: frame.x,
    y: frame.y,
    w: frame.vector.width,
    h: frame.vector.height,
  }));

  return {
    frames,
    selectedFrameId,
    selectedFrameIds: [],
    rootLayers,
    rootAnimation: structuredClone(snapshot.rootAnimation),
    rootHiddenLayerIds: [...snapshot.rootHiddenLayerIds],
    layers: cloneLayers(layers),
    vector: structuredClone(vector),
    animation: structuredClone(animation),
    hiddenLayerIds: [...hiddenLayerIds],
    worldViewport: computeFitViewport(
      frameBounds.length
        ? frameBounds
        : [{ x: 0, y: 0, w: snapshot.rootVector.width, h: snapshot.rootVector.height }],
    ),
    detailViewport: computeDetailViewport(vector),
    selectedLayerId,
    selectedLayerIds: hasLayers ? [selectedLayerId] : [],
    selectedLayerRefs: hasLayers ? [{ ownerId: selectedFrameId, layerId: selectedLayerId }] : [],
    selection: null,
    selectedPoints: [],
    selectedSubPaths: [],
    selectedBlockIds: [],
    hasCanvasSelection: hasLayers || Boolean(activeFrame),
    selectionKind: hasLayers ? "layer" : activeFrame ? "frame" : "none",
    progress: 0,
    isPlaying: false,
    isActionMode: false,
    editingSide: "from",
    timelineCollapsed: false,
    toolMode: "select",
  };
}

export function updateOwnedLayers(
  state: EditorState,
  ownerId: string,
  update: (layers: Layer[]) => Layer[],
) {
  const savedFrames = saveActiveFrame(state);
  const savedRoot = saveActiveRoot(state);
  const frames = savedFrames.map((frame) =>
    frame.id === ownerId ? { ...frame, layers: update(frame.layers) } : frame,
  );
  const rootLayers = ownerId === PAGE_ROOT_ID ? update(savedRoot.layers) : savedRoot.layers;
  const layers =
    state.selectedFrameId === PAGE_ROOT_ID
      ? rootLayers
      : (frames.find((frame) => frame.id === state.selectedFrameId)?.layers ?? state.layers);
  return { frames, rootLayers, layers };
}
