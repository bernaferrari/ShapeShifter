import { parsePath, pathToString } from "./pathUtils";
import type {
  AnimatableProperty,
  AnimationClip,
  AnimationState,
  AnimationValue,
  DocumentV2,
  Frame,
  Keyframe,
  Layer,
  MorphMapping,
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

function addGeometryVersion(document: DocumentV2, id: string, pathData: Layer["from"]): string {
  document.geometryVersions[id] = {
    id,
    pathData,
    sourceHash: pathToString(pathData),
    createdAt: 0,
  };
  return id;
}

function addMorphMapping(
  document: DocumentV2,
  id: string,
  fromGeometryId: string,
  toGeometryId: string,
): string {
  const mapping: MorphMapping = {
    id,
    fromGeometryId,
    toGeometryId,
    // Legacy documents only persist aligned paths. Preserve that fact rather than
    // pretending the correspondence can be reconstructed from display geometry.
    alignments: { kind: "legacy-aligned-endpoints" },
    polePositions: [],
    createdAt: 0,
  };
  document.morphMappings[id] = mapping;
  return id;
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
    const isPath = layer.type === "path" || layer.type === "clipPath";
    const geometryVersionId = isPath
      ? scopedId("geometry", ownerId, `${String(layer.id)}:base`)
      : undefined;
    const fromGeometryVersionId = isPath
      ? scopedId("geometry", ownerId, `${String(layer.id)}:from`)
      : undefined;
    const toGeometryVersionId =
      isPath && layer.to ? scopedId("geometry", ownerId, `${String(layer.id)}:to`) : undefined;
    if (geometryVersionId) {
      const pathData = layer.pathData ?? layer.from;
      addGeometryVersion(document, geometryVersionId, pathData);
      addGeometryVersion(document, fromGeometryVersionId!, layer.from);
      if (toGeometryVersionId && layer.to)
        addGeometryVersion(document, toGeometryVersionId, layer.to);
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
      fromGeometryVersionId,
      toGeometryVersionId,
      androidName: layer.androidName ?? layer.name,
    };
    document.nodes[nodeId] = node;
    if (layer.morphMapping) {
      document.morphMappings[layer.morphMapping.id] = {
        ...layer.morphMapping,
        fromGeometryId: fromGeometryVersionId ?? layer.morphMapping.fromGeometryId,
        toGeometryId: toGeometryVersionId ?? layer.morphMapping.toGeometryId,
      };
      node.morphMappingId = layer.morphMapping.id;
    } else if (fromGeometryVersionId && toGeometryVersionId) {
      addMorphMapping(
        document,
        scopedId("mapping", ownerId, `${String(layer.id)}:endpoints`),
        fromGeometryVersionId,
        toGeometryVersionId,
      );
    }
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
      const fromGeometryId =
        valueType === "path" && typeof block.fromValue === "string"
          ? addGeometryVersion(
              document,
              scopedId("geometry", ownerId, `${block.id}:from`),
              parsePath(block.fromValue),
            )
          : undefined;
      const toGeometryId =
        valueType === "path" && typeof block.toValue === "string"
          ? addGeometryVersion(
              document,
              scopedId("geometry", ownerId, `${block.id}:to`),
              parsePath(block.toValue),
            )
          : undefined;
      const mappingId =
        fromGeometryId && toGeometryId
          ? addMorphMapping(
              document,
              scopedId("mapping", ownerId, `track:${block.id}`),
              fromGeometryId,
              toGeometryId,
            )
          : undefined;
      document.keyframes[fromId] = {
        id: fromId,
        time: block.startTime,
        value: normalizeAnimationValue(block.fromValue, valueType),
        interpolator: block.interpolator,
        geometryVersionId: fromGeometryId,
        morphMappingId: mappingId,
        legacyBlockId: block.id,
      };
      document.keyframes[toId] = {
        id: toId,
        time: block.endTime,
        value: normalizeAnimationValue(block.toValue, valueType),
        geometryVersionId: toGeometryId,
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
      viewportWidth: snapshot.rootVector.viewportWidth,
      viewportHeight: snapshot.rootVector.viewportHeight,
      widthUnit: snapshot.rootVector.widthUnit,
      heightUnit: snapshot.rootVector.heightUnit,
      tint: snapshot.rootVector.tint,
      tintMode: snapshot.rootVector.tintMode,
      autoMirrored: snapshot.rootVector.autoMirrored,
      minSdk: snapshot.rootVector.minSdk,
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
      viewportWidth: source.vector.viewportWidth,
      viewportHeight: source.vector.viewportHeight,
      widthUnit: source.vector.widthUnit,
      heightUnit: source.vector.heightUnit,
      tint: source.vector.tint,
      tintMode: source.vector.tintMode,
      autoMirrored: source.vector.autoMirrored,
      minSdk: source.vector.minSdk,
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
    const fromGeometry = node.fromGeometryVersionId
      ? document.geometryVersions[node.fromGeometryVersionId]
      : geometry;
    const toGeometry = node.toGeometryVersionId
      ? document.geometryVersions[node.toGeometryVersionId]
      : undefined;
    const empty = parsePath("");
    return {
      id: localId(node.id),
      name: node.name,
      androidName: node.androidName,
      type: node.type === "boolean" || node.type === "componentInstance" ? "group" : node.type,
      from: fromGeometry?.pathData ?? geometry?.pathData ?? empty,
      to: toGeometry?.pathData,
      pathData: geometry?.pathData,
      visible: node.visible,
      locked: node.locked,
      parentId: node.parentId ? localId(node.parentId) : null,
      alpha: node.alpha,
      ...node.style,
      ...node.transform,
      ...(node.morphMappingId && document.morphMappings[node.morphMappingId]
        ? { morphMapping: document.morphMappings[node.morphMappingId] }
        : {}),
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
          viewportWidth: frame.viewportWidth,
          viewportHeight: frame.viewportHeight,
          widthUnit: frame.widthUnit,
          heightUnit: frame.heightUnit,
          tint: frame.tint,
          tintMode: frame.tintMode,
          autoMirrored: frame.autoMirrored,
          minSdk: frame.minSdk,
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

/**
 * Report valid V2 constructs the legacy runtime cannot project and then recreate
 * without changing their meaning. Callers must refuse these documents instead of
 * silently flattening them into the legacy model.
 */
export function legacyProjectionIssues(document: DocumentV2): string[] {
  const issues: string[] = [];
  if (Object.keys(document.components ?? {}).length > 0) issues.push("reusable components");
  if (Object.values(document.nodes).some((node) => node.type === "boolean"))
    issues.push("boolean nodes");
  if (Object.values(document.nodes).some((node) => node.type === "componentInstance"))
    issues.push("component instances");
  if (
    document.rootClipIds.length > 1 ||
    Object.values(document.frames).some((frame) => frame.clipIds.length > 1)
  )
    issues.push("multiple animation clips per owner");

  for (const track of Object.values(document.tracks)) {
    const keyframes = track.keyframeIds
      .map((keyframeId) => document.keyframes[keyframeId])
      .filter((keyframe): keyframe is Keyframe => Boolean(keyframe));
    const hasNativeKeyframeMapping = keyframes.some((keyframe) => {
      if (!keyframe.morphMappingId) return false;
      const mapping = document.morphMappings[keyframe.morphMappingId];
      // The legacy adapter recreates its own endpoint mapping for a paired
      // legacy morph block. Any richer per-keyframe mapping would be erased.
      return !keyframe.legacyBlockId || mapping?.alignments.kind !== "legacy-aligned-endpoints";
    });
    if (hasNativeKeyframeMapping) {
      issues.push(`keyframe morph mappings on track ${track.id}`);
      continue;
    }
    const withoutLegacyBlockId = keyframes.filter((keyframe) => !keyframe.legacyBlockId);
    if (withoutLegacyBlockId.length > 0 && keyframes.length !== 2) {
      issues.push(`native keyframe sequence on track ${track.id}`);
      continue;
    }
    const blocks = new Map<string, number>();
    for (const keyframe of keyframes) {
      if (!keyframe.legacyBlockId) continue;
      blocks.set(keyframe.legacyBlockId, (blocks.get(keyframe.legacyBlockId) ?? 0) + 1);
    }
    if ([...blocks.values()].some((count) => count !== 2))
      issues.push(`non-pair legacy keyframes on track ${track.id}`);
  }
  return issues;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isPathDataRecord(value: unknown): boolean {
  return (
    isRecord(value) &&
    Array.isArray(value.subPaths) &&
    value.subPaths.every(
      (subPath) =>
        isRecord(subPath) &&
        Array.isArray(subPath.commands) &&
        subPath.commands.every(
          (command) =>
            isRecord(command) &&
            typeof command.id === "string" &&
            typeof command.type === "string" &&
            Array.isArray(command.points) &&
            command.points.every(
              (point) => isRecord(point) && isFiniteNumber(point.x) && isFiniteNumber(point.y),
            ),
        ),
    )
  );
}

function isPageRecord(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height) &&
    isFiniteNumber(value.alpha)
  );
}

function isFrameRecord(value: unknown): value is Frame {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height) &&
    isFiniteNumber(value.alpha) &&
    isStringArray(value.childrenNodeIds) &&
    isStringArray(value.clipIds)
  );
}

function isNodeRecord(value: unknown): value is Node {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    !["group", "path", "clipPath", "boolean", "componentInstance"].includes(String(value.type)) ||
    typeof value.visible !== "boolean" ||
    typeof value.locked !== "boolean" ||
    !isFiniteNumber(value.alpha) ||
    !isRecord(value.style) ||
    !isRecord(value.transform)
  ) {
    return false;
  }

  const transform = value.transform;
  return (
    isFiniteNumber(transform.translateX) &&
    isFiniteNumber(transform.translateY) &&
    isFiniteNumber(transform.scaleX) &&
    isFiniteNumber(transform.scaleY) &&
    isFiniteNumber(transform.rotation) &&
    isFiniteNumber(transform.pivotX) &&
    isFiniteNumber(transform.pivotY) &&
    (value.parentId === undefined || typeof value.parentId === "string") &&
    (value.childrenIds === undefined || isStringArray(value.childrenIds)) &&
    (value.geometryVersionId === undefined || typeof value.geometryVersionId === "string") &&
    (value.fromGeometryVersionId === undefined ||
      typeof value.fromGeometryVersionId === "string") &&
    (value.toGeometryVersionId === undefined || typeof value.toGeometryVersionId === "string") &&
    (value.morphMappingId === undefined || typeof value.morphMappingId === "string")
  );
}

function isGeometryRecord(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isPathDataRecord(value.pathData) &&
    isFiniteNumber(value.createdAt)
  );
}

function isMappingRecord(value: unknown): value is MorphMapping {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isRecord(value.alignments) &&
    Array.isArray(value.polePositions) &&
    value.polePositions.every(
      (point) => isRecord(point) && isFiniteNumber(point.x) && isFiniteNumber(point.y),
    ) &&
    isFiniteNumber(value.createdAt) &&
    (value.fromGeometryId === undefined || typeof value.fromGeometryId === "string") &&
    (value.toGeometryId === undefined || typeof value.toGeometryId === "string")
  );
}

function isClipRecord(value: unknown): value is AnimationClip {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    isFiniteNumber(value.duration) &&
    (value.frameId === null || typeof value.frameId === "string") &&
    isStringArray(value.trackIds)
  );
}

function isTrackRecord(value: unknown): value is Track {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isRecord(value.target) &&
    typeof value.target.nodeId === "string" &&
    ANIMATABLE_PROPERTIES.has(value.target.property as AnimatableProperty) &&
    (value.valueType === "number" || value.valueType === "color" || value.valueType === "path") &&
    isStringArray(value.keyframeIds)
  );
}

function isKeyframeRecord(value: unknown): value is Keyframe {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isFiniteNumber(value.time) &&
    (typeof value.value === "string" || isFiniteNumber(value.value)) &&
    (value.interpolator === undefined || typeof value.interpolator === "string") &&
    (value.geometryVersionId === undefined || typeof value.geometryVersionId === "string") &&
    (value.morphMappingId === undefined || typeof value.morphMappingId === "string")
  );
}

interface DocumentOwner {
  /** Stable internal identity. The display label alone is not enough for frames. */
  key: string;
  label: string;
  frameId: string | null;
}

/**
 * A V2 document is a collection of graphs, not a bag of independently useful
 * records. The legacy projection starts from page/frame roots, so accepting an
 * unowned record here would quietly discard authored data during import. Keep
 * immutable geometry and mapping history permissive, but require every mutable
 * scene and timeline record to be reachable from exactly one owner.
 */
function validateDocumentOwnership(document: DocumentV2, issues: string[]): void {
  const pageOwner: DocumentOwner = { key: "page", label: "the page", frameId: null };
  const nodeOwners = new Map<string, DocumentOwner>();
  const clipOwners = new Map<string, DocumentOwner>();
  const trackOwners = new Map<string, DocumentOwner>();
  const keyframeOwners = new Map<string, DocumentOwner>();

  const duplicateOwnerIssue = (
    kind: "Node" | "Clip" | "Track" | "Keyframe",
    id: string,
    previous: DocumentOwner,
    next: DocumentOwner,
  ) => {
    if (previous.key === next.key)
      issues.push(`${kind} ${id} is reachable more than once from ${next.label}.`);
    else issues.push(`${kind} ${id} is reachable from both ${previous.label} and ${next.label}.`);
  };

  const visitNode = (nodeId: string, owner: DocumentOwner, isOwnerRoot: boolean) => {
    const node = document.nodes[nodeId];
    if (!isNodeRecord(node)) return;

    const previousOwner = nodeOwners.get(nodeId);
    if (previousOwner) {
      duplicateOwnerIssue("Node", nodeId, previousOwner, owner);
      return;
    }
    nodeOwners.set(nodeId, owner);

    if (isOwnerRoot && node.parentId !== undefined)
      issues.push(`Root node ${nodeId} for ${owner.label} must not have a parent.`);
    for (const childId of node.childrenIds ?? []) visitNode(childId, owner, false);
  };

  for (const nodeId of document.rootNodeIds) visitNode(nodeId, pageOwner, true);
  for (const frameId of document.frameIds) {
    const frame = document.frames[frameId];
    if (!isFrameRecord(frame)) continue;
    const owner: DocumentOwner = {
      key: `frame:${frameId}`,
      label: `frame ${frameId}`,
      frameId,
    };
    for (const nodeId of frame.childrenNodeIds) visitNode(nodeId, owner, true);
  }
  for (const nodeId of Object.keys(document.nodes)) {
    if (!nodeOwners.has(nodeId))
      issues.push(`Node ${nodeId} is not reachable from page or frame roots.`);
  }

  const visitKeyframe = (keyframeId: string, owner: DocumentOwner) => {
    const keyframe = document.keyframes[keyframeId];
    if (!isKeyframeRecord(keyframe)) return;

    const previousOwner = keyframeOwners.get(keyframeId);
    if (previousOwner) {
      duplicateOwnerIssue("Keyframe", keyframeId, previousOwner, owner);
      return;
    }
    keyframeOwners.set(keyframeId, owner);
  };

  const visitTrack = (trackId: string, owner: DocumentOwner) => {
    const track = document.tracks[trackId];
    if (!isTrackRecord(track)) return;

    const previousOwner = trackOwners.get(trackId);
    if (previousOwner) {
      duplicateOwnerIssue("Track", trackId, previousOwner, owner);
      return;
    }
    trackOwners.set(trackId, owner);

    const targetOwner = nodeOwners.get(track.target.nodeId);
    if (!targetOwner) issues.push(`Track ${trackId} targets a node outside ${owner.label}.`);
    else if (targetOwner.key !== owner.key)
      issues.push(
        `Track ${trackId} targets a node owned by ${targetOwner.label}, not ${owner.label}.`,
      );

    for (const keyframeId of track.keyframeIds) visitKeyframe(keyframeId, owner);
  };

  const visitClip = (clipId: string, owner: DocumentOwner) => {
    const clip = document.clips[clipId];
    if (!isClipRecord(clip)) return;

    const previousOwner = clipOwners.get(clipId);
    if (previousOwner) {
      duplicateOwnerIssue("Clip", clipId, previousOwner, owner);
      return;
    }
    clipOwners.set(clipId, owner);

    if (clip.frameId !== owner.frameId)
      issues.push(
        `Clip ${clipId} has frameId ${String(clip.frameId)} but is owned by ${owner.label}.`,
      );
    for (const trackId of clip.trackIds) visitTrack(trackId, owner);
  };

  for (const clipId of document.rootClipIds) visitClip(clipId, pageOwner);
  for (const frameId of document.frameIds) {
    const frame = document.frames[frameId];
    if (!isFrameRecord(frame)) continue;
    const owner: DocumentOwner = {
      key: `frame:${frameId}`,
      label: `frame ${frameId}`,
      frameId,
    };
    for (const clipId of frame.clipIds) visitClip(clipId, owner);
  }
  for (const clipId of Object.keys(document.clips)) {
    if (!clipOwners.has(clipId))
      issues.push(`Clip ${clipId} is not reachable from page or frame clip lists.`);
  }
  for (const trackId of Object.keys(document.tracks)) {
    if (!trackOwners.has(trackId))
      issues.push(`Track ${trackId} is not reachable from an animation clip.`);
  }
  for (const keyframeId of Object.keys(document.keyframes)) {
    if (!keyframeOwners.has(keyframeId))
      issues.push(`Keyframe ${keyframeId} is not reachable from an animation track.`);
  }
}

/**
 * Verify a persisted document before attempting the legacy projection. This accepts
 * unknown input deliberately: import data is untrusted, and validation itself must
 * never become the reason a recoverable project cannot be opened.
 */
export function validateDocumentV2(document: unknown): string[] {
  const issues: string[] = [];
  try {
    if (!isRecord(document)) return ["Document v2 must be an object."];
    if (document.version !== 2) issues.push("Document version must be 2.");
    if (typeof document.id !== "string") issues.push("Document id is missing.");
    if (typeof document.name !== "string") issues.push("Document name is missing.");
    if (!isStringArray(document.frameIds)) issues.push("Document frameIds must be an array.");

    const recordFields = [
      "frames",
      "nodes",
      "geometryVersions",
      "morphMappings",
      "clips",
      "tracks",
      "keyframes",
    ] as const;
    for (const field of recordFields) {
      if (!isRecord(document[field])) issues.push(`Document ${field} must be an object.`);
    }
    if (!isPageRecord(document.page)) issues.push("Document page is malformed.");
    if (!isStringArray(document.rootNodeIds)) issues.push("Document rootNodeIds must be an array.");
    if (!isStringArray(document.rootClipIds)) issues.push("Document rootClipIds must be an array.");
    if (issues.length > 0) return issues;

    const candidate = document as unknown as DocumentV2;
    for (const frameId of candidate.frameIds) {
      const frame = candidate.frames[frameId];
      if (!isFrameRecord(frame)) {
        issues.push(`Frame ${frameId} is missing or malformed.`);
        continue;
      }
      for (const nodeId of frame.childrenNodeIds)
        if (!candidate.nodes[nodeId])
          issues.push(`Frame ${frameId} references missing node ${nodeId}.`);
      for (const clipId of frame.clipIds)
        if (!candidate.clips[clipId])
          issues.push(`Frame ${frameId} references missing clip ${clipId}.`);
    }
    for (const rootId of candidate.rootNodeIds)
      if (!candidate.nodes[rootId]) issues.push(`Page references missing node ${rootId}.`);
    for (const clipId of candidate.rootClipIds)
      if (!candidate.clips[clipId]) issues.push(`Page references missing clip ${clipId}.`);

    for (const [nodeId, node] of Object.entries(candidate.nodes)) {
      if (!isNodeRecord(node)) {
        issues.push(`Node ${nodeId} is malformed.`);
        continue;
      }
      if (node.parentId && !candidate.nodes[node.parentId])
        issues.push(`Node ${node.id} references missing parent ${node.parentId}.`);
      for (const childId of node.childrenIds ?? []) {
        const child = candidate.nodes[childId];
        if (!child) issues.push(`Node ${node.id} references missing child ${childId}.`);
        else if (!isNodeRecord(child) || child.parentId !== node.id)
          issues.push(`Node ${childId} does not point back to parent ${node.id}.`);
      }
      if (node.geometryVersionId && !candidate.geometryVersions[node.geometryVersionId])
        issues.push(`Node ${node.id} references missing geometry ${node.geometryVersionId}.`);
      if (node.fromGeometryVersionId && !candidate.geometryVersions[node.fromGeometryVersionId])
        issues.push(
          `Node ${node.id} references missing start geometry ${node.fromGeometryVersionId}.`,
        );
      if (node.toGeometryVersionId && !candidate.geometryVersions[node.toGeometryVersionId])
        issues.push(`Node ${node.id} references missing end geometry ${node.toGeometryVersionId}.`);
    }
    for (const [geometryId, geometry] of Object.entries(candidate.geometryVersions)) {
      if (!isGeometryRecord(geometry)) issues.push(`Geometry ${geometryId} is malformed.`);
    }
    for (const [mappingId, mapping] of Object.entries(candidate.morphMappings)) {
      if (!isMappingRecord(mapping)) {
        issues.push(`Morph mapping ${mappingId} is malformed.`);
        continue;
      }
      if (mapping.fromGeometryId && !candidate.geometryVersions[mapping.fromGeometryId])
        issues.push(
          `Morph mapping ${mapping.id} references missing start geometry ${mapping.fromGeometryId}.`,
        );
      if (mapping.toGeometryId && !candidate.geometryVersions[mapping.toGeometryId])
        issues.push(
          `Morph mapping ${mapping.id} references missing end geometry ${mapping.toGeometryId}.`,
        );
    }
    for (const [clipId, clip] of Object.entries(candidate.clips)) {
      if (!isClipRecord(clip)) {
        issues.push(`Clip ${clipId} is malformed.`);
        continue;
      }
      for (const trackId of clip.trackIds)
        if (!candidate.tracks[trackId])
          issues.push(`Clip ${clip.id} references missing track ${trackId}.`);
    }
    for (const [trackId, track] of Object.entries(candidate.tracks)) {
      if (!isTrackRecord(track)) {
        issues.push(`Track ${trackId} is malformed.`);
        continue;
      }
      if (!candidate.nodes[track.target.nodeId])
        issues.push(`Track ${track.id} references missing node ${track.target.nodeId}.`);
      let previous = -Infinity;
      for (const keyframeId of track.keyframeIds) {
        const keyframe = candidate.keyframes[keyframeId];
        if (!isKeyframeRecord(keyframe)) {
          issues.push(`Track ${track.id} references missing or malformed keyframe ${keyframeId}.`);
          continue;
        }
        if (keyframe.time < previous)
          issues.push(`Track ${track.id} keyframes are not ordered by time.`);
        if (keyframe.geometryVersionId && !candidate.geometryVersions[keyframe.geometryVersionId])
          issues.push(
            `Keyframe ${keyframe.id} references missing geometry ${keyframe.geometryVersionId}.`,
          );
        if (keyframe.morphMappingId && !candidate.morphMappings[keyframe.morphMappingId])
          issues.push(
            `Keyframe ${keyframe.id} references missing morph mapping ${keyframe.morphMappingId}.`,
          );
        previous = keyframe.time;
      }
    }
    validateDocumentOwnership(candidate, issues);
  } catch {
    // A proxy or an unexpectedly-shaped object should surface as an invalid document,
    // never as an import-time exception that blocks legacy recovery.
    issues.push("Document v2 could not be validated safely.");
  }
  return issues;
}
