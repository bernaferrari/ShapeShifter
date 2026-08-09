import { parsePath, pathToString } from "./pathUtils";
import type {
  AnimatableProperty,
  AnimationClip,
  AnimationState,
  AnimationValue,
  DocumentV2,
  Frame,
  InterpolatorName,
  Keyframe,
  Layer,
  Node,
  NodeTransform,
  PathStyle,
  TimelineBlock,
  Track,
  TrackValueType,
  VectorMetadata,
} from "./types";

export interface LegacyArtboardSnapshot {
  id: string;
  name: string;
  x: number;
  y: number;
  layers: Layer[];
  vector: VectorMetadata;
  animation: AnimationState;
  hiddenLayerIds: string[];
}

export interface LegacyDocumentSnapshot {
  id: string;
  name: string;
  frames: LegacyArtboardSnapshot[];
  rootLayers: Layer[];
  rootVector: VectorMetadata;
  rootAnimation: AnimationState;
  rootHiddenLayerIds: string[];
}

const ANIMATABLE_PROPERTIES = new Set<AnimatableProperty>([
  "pathData",
  "alpha",
  "fillColor",
  "fillAlpha",
  "strokeColor",
  "strokeAlpha",
  "strokeWidth",
  "trimPathStart",
  "trimPathEnd",
  "trimPathOffset",
  "translateX",
  "translateY",
  "scaleX",
  "scaleY",
  "rotation",
  "pivotX",
  "pivotY",
]);

const DEFAULT_TRANSFORM: NodeTransform = {
  translateX: 0,
  translateY: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  pivotX: 0,
  pivotY: 0,
};

function scopedId(prefix: string, ownerId: string, localId: string | number): string {
  return `${prefix}:${encodeURIComponent(ownerId)}:${encodeURIComponent(String(localId))}`;
}

function layerStyle(layer: Layer): PathStyle {
  return {
    fillColor: layer.fillColor,
    fillAlpha: layer.fillAlpha,
    fillGradient: layer.fillGradient,
    strokeColor: layer.strokeColor,
    strokeAlpha: layer.strokeAlpha,
    strokeWidth: layer.strokeWidth,
    strokeLinecap: layer.strokeLinecap,
    strokeLinejoin: layer.strokeLinejoin,
    strokeMiterLimit: layer.strokeMiterLimit,
    trimPathStart: layer.trimPathStart,
    trimPathEnd: layer.trimPathEnd,
    trimPathOffset: layer.trimPathOffset,
    fillType: layer.fillType,
    strokeDasharray: layer.strokeDasharray,
  };
}

function flattenLayers(layers: Layer[]): Array<{ layer: Layer; parentId: string | number | null }> {
  const byId = new Map<string, { layer: Layer; parentId: string | number | null }>();
  const visit = (layer: Layer, nestedParent: string | number | null) => {
    const parentId = layer.parentId ?? nestedParent;
    byId.set(String(layer.id), { layer, parentId });
    for (const child of layer.children ?? []) visit(child, layer.id);
  };
  for (const layer of layers) visit(layer, null);
  return [...byId.values()];
}

function valueTypeFor(property: AnimatableProperty, block?: TimelineBlock): TrackValueType {
  if (property === "pathData" || block?.type === "path") return "path";
  if (property === "fillColor" || property === "strokeColor" || block?.type === "color")
    return "color";
  return "number";
}

function normalizeAnimationValue(
  value: string | number,
  valueType: TrackValueType,
): AnimationValue {
  if (valueType !== "path" || typeof value !== "string") return value;
  return pathToString(parsePath(value));
}

function asInterpolator(value?: string): InterpolatorName | undefined {
  if (
    value === "FAST_OUT_SLOW_IN" ||
    value === "FAST_OUT_LINEAR_IN" ||
    value === "LINEAR_OUT_SLOW_IN" ||
    value === "ACCELERATE_DECELERATE" ||
    value === "LINEAR"
  ) {
    return value;
  }
  return undefined;
}

function addOwner(
  document: DocumentV2,
  ownerId: string,
  layers: Layer[],
  animation: AnimationState,
  hiddenLayerIds: string[],
  frameId: string | null,
): string[] {
  const flat = flattenLayers(layers);
  const hidden = new Set(hiddenLayerIds.map(String));
  const rootIds: string[] = [];

  for (const { layer, parentId } of flat) {
    const nodeId = scopedId("node", ownerId, layer.id);
    const geometryVersionId =
      layer.type === "path" || layer.type === "clipPath"
        ? scopedId("geometry", ownerId, layer.id)
        : undefined;
    if (geometryVersionId) {
      const pathData = layer.pathData ?? layer.from;
      document.geometryVersions[geometryVersionId] = {
        id: geometryVersionId,
        pathData,
        sourceHash: pathToString(pathData),
        createdAt: 0,
      };
    }
    const childrenIds = flat
      .filter((entry) => String(entry.parentId) === String(layer.id))
      .map((entry) => scopedId("node", ownerId, entry.layer.id));
    const node: Node = {
      id: nodeId,
      name: layer.name,
      type: layer.type === "vector" ? "group" : layer.type,
      parentId: parentId == null ? undefined : scopedId("node", ownerId, parentId),
      childrenIds: childrenIds.length > 0 ? childrenIds : undefined,
      visible: layer.visible && !hidden.has(String(layer.id)),
      locked: layer.locked,
      transform: {
        translateX: layer.translateX ?? DEFAULT_TRANSFORM.translateX,
        translateY: layer.translateY ?? DEFAULT_TRANSFORM.translateY,
        scaleX: layer.scaleX ?? DEFAULT_TRANSFORM.scaleX,
        scaleY: layer.scaleY ?? DEFAULT_TRANSFORM.scaleY,
        rotation: layer.rotation ?? DEFAULT_TRANSFORM.rotation,
        pivotX: layer.pivotX ?? DEFAULT_TRANSFORM.pivotX,
        pivotY: layer.pivotY ?? DEFAULT_TRANSFORM.pivotY,
      },
      style: layerStyle(layer),
      alpha: layer.alpha ?? 1,
      geometryVersionId,
    };
    document.nodes[nodeId] = node;
    if (parentId == null) rootIds.push(nodeId);
  }

  const clipId = scopedId("clip", ownerId, animation.id || "motion");
  const clip: AnimationClip = {
    id: clipId,
    name: animation.name,
    duration: animation.duration,
    frameId,
    trackIds: [],
  };
  const grouped = new Map<string, TimelineBlock[]>();
  for (const block of animation.blocks) {
    if (!ANIMATABLE_PROPERTIES.has(block.propertyName as AnimatableProperty)) continue;
    const key = `${String(block.layerId)}\u0000${block.propertyName}`;
    grouped.set(key, [...(grouped.get(key) ?? []), block]);
  }
  for (const blocks of grouped.values()) {
    const first = blocks[0]!;
    const property = first.propertyName as AnimatableProperty;
    const trackId = scopedId("track", ownerId, `${String(first.layerId)}:${property}`);
    const valueType = valueTypeFor(property, first);
    const track: Track = {
      id: trackId,
      target: { nodeId: scopedId("node", ownerId, first.layerId), property },
      valueType,
      keyframeIds: [],
    };
    for (const block of [...blocks].sort(
      (a, b) => a.startTime - b.startTime || a.endTime - b.endTime,
    )) {
      const fromId = scopedId("keyframe", ownerId, `${block.id}:from`);
      const toId = scopedId("keyframe", ownerId, `${block.id}:to`);
      document.keyframes[fromId] = {
        id: fromId,
        time: block.startTime,
        value: normalizeAnimationValue(block.fromValue, valueType),
        interpolator: asInterpolator(block.interpolator),
        legacyBlockId: block.id,
      };
      document.keyframes[toId] = {
        id: toId,
        time: block.endTime,
        value: normalizeAnimationValue(block.toValue, valueType),
        legacyBlockId: block.id,
      };
      track.keyframeIds.push(fromId, toId);
    }
    document.tracks[trackId] = track;
    clip.trackIds.push(trackId);
  }
  document.clips[clipId] = clip;
  return rootIds;
}

export function createDocumentV2FromLegacy(snapshot: LegacyDocumentSnapshot): DocumentV2 {
  const document: DocumentV2 = {
    id: snapshot.id,
    name: snapshot.name,
    version: 2,
    frameIds: [],
    frames: {},
    page: {
      name: snapshot.rootVector.name,
      width: snapshot.rootVector.width,
      height: snapshot.rootVector.height,
      alpha: snapshot.rootVector.alpha,
    },
    rootNodeIds: [],
    rootClipIds: [],
    nodes: {},
    geometryVersions: {},
    morphMappings: {},
    clips: {},
    tracks: {},
    keyframes: {},
  };

  document.rootNodeIds = addOwner(
    document,
    "page",
    snapshot.rootLayers,
    snapshot.rootAnimation,
    snapshot.rootHiddenLayerIds,
    null,
  );
  document.rootClipIds = Object.values(document.clips)
    .filter((clip) => clip.frameId === null)
    .map((clip) => clip.id);

  for (const source of snapshot.frames) {
    const frame: Frame = {
      id: source.id,
      name: source.name,
      x: source.x,
      y: source.y,
      width: source.vector.width,
      height: source.vector.height,
      alpha: source.vector.alpha,
      childrenNodeIds: addOwner(
        document,
        source.id,
        source.layers,
        source.animation,
        source.hiddenLayerIds,
        source.id,
      ),
      clipIds: [],
    };
    frame.clipIds = Object.values(document.clips)
      .filter((clip) => clip.frameId === source.id)
      .map((clip) => clip.id);
    document.frames[frame.id] = frame;
    document.frameIds.push(frame.id);
  }
  return document;
}

function localId(nodeId: string): string {
  const parts = nodeId.split(":");
  return decodeURIComponent(parts.slice(2).join(":"));
}

function ownerLayers(document: DocumentV2, rootIds: string[]): Layer[] {
  const ordered: Node[] = [];
  const visit = (nodeId: string) => {
    const node = document.nodes[nodeId];
    if (!node) return;
    ordered.push(node);
    for (const childId of node.childrenIds ?? []) visit(childId);
  };
  for (const rootId of rootIds) visit(rootId);
  return ordered.map((node) => {
    const geometry = node.geometryVersionId
      ? document.geometryVersions[node.geometryVersionId]
      : undefined;
    const empty = parsePath("");
    return {
      id: localId(node.id),
      name: node.name,
      type: node.type === "boolean" || node.type === "componentInstance" ? "group" : node.type,
      from: geometry?.pathData ?? empty,
      pathData: geometry?.pathData,
      visible: node.visible,
      locked: node.locked,
      parentId: node.parentId ? localId(node.parentId) : null,
      alpha: node.alpha,
      ...node.style,
      ...node.transform,
    } satisfies Layer;
  });
}

function clipAnimation(
  document: DocumentV2,
  clipId: string | undefined,
  fallbackId: string,
): AnimationState {
  const clip = clipId ? document.clips[clipId] : undefined;
  if (!clip) return { id: fallbackId, name: "Motion", duration: 1000, blocks: [] };
  const blocks: TimelineBlock[] = [];
  for (const trackId of clip.trackIds) {
    const track = document.tracks[trackId];
    if (!track) continue;
    const byLegacyBlock = new Map<string, Keyframe[]>();
    for (const keyframeId of track.keyframeIds) {
      const keyframe = document.keyframes[keyframeId];
      if (!keyframe) continue;
      const blockId = keyframe.legacyBlockId ?? `${track.id}:${Math.floor(byLegacyBlock.size / 2)}`;
      byLegacyBlock.set(blockId, [...(byLegacyBlock.get(blockId) ?? []), keyframe]);
    }
    for (const [blockId, keyframes] of byLegacyBlock) {
      const sorted = [...keyframes].sort((a, b) => a.time - b.time);
      const from = sorted[0];
      const to = sorted.at(-1);
      if (!from || !to) continue;
      blocks.push({
        id: blockId,
        layerId: localId(track.target.nodeId),
        propertyName: track.target.property,
        fromValue: from.value,
        toValue: to.value,
        startTime: from.time,
        endTime: to.time,
        interpolator: from.interpolator,
        type: track.valueType,
      });
    }
  }
  return { id: clip.id, name: clip.name, duration: clip.duration, blocks };
}

export function legacySnapshotFromDocumentV2(document: DocumentV2): LegacyDocumentSnapshot {
  const frames = document.frameIds.flatMap((frameId) => {
    const frame = document.frames[frameId];
    if (!frame) return [];
    return [
      {
        id: frame.id,
        name: frame.name,
        x: frame.x,
        y: frame.y,
        layers: ownerLayers(document, frame.childrenNodeIds),
        vector: {
          id: frame.id,
          name: frame.name,
          width: frame.width,
          height: frame.height,
          alpha: frame.alpha,
        },
        animation: clipAnimation(document, frame.clipIds[0], `${frame.id}-motion`),
        hiddenLayerIds: ownerLayers(document, frame.childrenNodeIds)
          .filter((layer) => !layer.visible)
          .map((layer) => String(layer.id)),
      },
    ];
  });
  const rootLayers = ownerLayers(document, document.rootNodeIds);
  return {
    id: document.id,
    name: document.name,
    frames,
    rootLayers,
    rootVector: { id: "page", ...document.page },
    rootAnimation: clipAnimation(document, document.rootClipIds[0], "page-motion"),
    rootHiddenLayerIds: rootLayers
      .filter((layer) => !layer.visible)
      .map((layer) => String(layer.id)),
  };
}

export function validateDocumentV2(document: DocumentV2): string[] {
  const issues: string[] = [];
  for (const frameId of document.frameIds) {
    const frame = document.frames[frameId];
    if (!frame) {
      issues.push(`Frame ${frameId} is missing.`);
      continue;
    }
    for (const nodeId of frame.childrenNodeIds)
      if (!document.nodes[nodeId])
        issues.push(`Frame ${frameId} references missing node ${nodeId}.`);
    for (const clipId of frame.clipIds)
      if (!document.clips[clipId])
        issues.push(`Frame ${frameId} references missing clip ${clipId}.`);
  }
  for (const rootId of document.rootNodeIds)
    if (!document.nodes[rootId]) issues.push(`Page references missing node ${rootId}.`);
  for (const node of Object.values(document.nodes)) {
    if (node.parentId && !document.nodes[node.parentId])
      issues.push(`Node ${node.id} references missing parent ${node.parentId}.`);
    for (const childId of node.childrenIds ?? []) {
      const child = document.nodes[childId];
      if (!child) issues.push(`Node ${node.id} references missing child ${childId}.`);
      else if (child.parentId !== node.id)
        issues.push(`Node ${childId} does not point back to parent ${node.id}.`);
    }
    if (node.geometryVersionId && !document.geometryVersions[node.geometryVersionId])
      issues.push(`Node ${node.id} references missing geometry ${node.geometryVersionId}.`);
  }
  for (const clip of Object.values(document.clips)) {
    for (const trackId of clip.trackIds)
      if (!document.tracks[trackId])
        issues.push(`Clip ${clip.id} references missing track ${trackId}.`);
  }
  for (const track of Object.values(document.tracks)) {
    if (!document.nodes[track.target.nodeId])
      issues.push(`Track ${track.id} references missing node ${track.target.nodeId}.`);
    let previous = -Infinity;
    for (const keyframeId of track.keyframeIds) {
      const keyframe = document.keyframes[keyframeId];
      if (!keyframe) {
        issues.push(`Track ${track.id} references missing keyframe ${keyframeId}.`);
        continue;
      }
      if (keyframe.time < previous)
        issues.push(`Track ${track.id} keyframes are not ordered by time.`);
      previous = keyframe.time;
    }
  }
  return issues;
}
