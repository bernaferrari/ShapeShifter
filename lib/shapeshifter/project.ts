import { parsePath, ensureStableCommandIds } from "./pathUtils";
import type { LegacyDocumentSnapshot } from "./documentModel";
import type {
  AnimationState,
  FillType,
  Gradient,
  Layer,
  LayerType,
  PathData,
  StrokeLineCap,
  StrokeLineJoin,
  TimelineBlock,
  VectorMetadata,
} from "./types";

export interface ShapeShifterProjectLayer {
  id: string;
  name: string;
  type: "vector" | "group" | "path" | "clipPath";
  children?: ShapeShifterProjectLayer[];
  pathData?: string;
  fillColor?: string;
  fillAlpha?: number;
  fillGradient?: Gradient;
  strokeColor?: string;
  strokeAlpha?: number;
  strokeWidth?: number;
  strokeLinecap?: StrokeLineCap;
  strokeLinejoin?: StrokeLineJoin;
  strokeMiterLimit?: number;
  trimPathStart?: number;
  trimPathEnd?: number;
  trimPathOffset?: number;
  fillType?: FillType;
  alpha?: number;
  width?: number;
  height?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  pivotX?: number;
  pivotY?: number;
  translateX?: number;
  translateY?: number;
}

export interface ShapeShifterAnimation {
  id: string;
  name: string;
  duration: number;
  blocks: TimelineBlock[];
}

export interface ShapeShifterProject {
  version: number;
  layers: {
    vectorLayer: ShapeShifterProjectLayer;
    hiddenLayerIds: string[];
  };
  timeline: {
    animation: ShapeShifterAnimation;
  };
}

export interface FlattenedShapeShifterProject {
  layers: Layer[];
  hiddenLayerIds: string[];
  animation: AnimationState;
  vector: VectorMetadata;
}

function isLayerType(type: string): type is LayerType {
  return type === "path" || type === "clipPath" || type === "group" || type === "vector";
}

export function isOriginalShapeShifterProject(value: unknown): value is ShapeShifterProject {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ShapeShifterProject>;
  return Boolean(
    candidate.layers?.vectorLayer &&
    candidate.timeline?.animation &&
    Array.isArray(candidate.timeline.animation.blocks),
  );
}

export function flattenOriginalProject(project: ShapeShifterProject): FlattenedShapeShifterProject {
  const pathBlocksByLayerId = new Map<string, TimelineBlock>();
  for (const block of project.timeline.animation.blocks) {
    if (block.propertyName === "pathData" && block.type === "path") {
      pathBlocksByLayerId.set(String(block.layerId), block);
    }
  }

  const hiddenIds = new Set(project.layers.hiddenLayerIds.map(String));
  const result: Layer[] = [];

  const walk = (layer: ShapeShifterProjectLayer, parentId: string | null) => {
    const children = layer.children ?? [];
    if (layer.type === "group") {
      const emptyPath = ensureStableCommandIds(parsePath(""));
      result.push({
        id: layer.id,
        name: layer.name,
        type: "group",
        from: emptyPath,
        to: emptyPath,
        pathData: emptyPath,
        parentId,
        visible: !hiddenIds.has(layer.id),
        locked: false,
        expanded: true,
        children: [],
        alpha: layer.alpha ?? 1,
        rotation: layer.rotation ?? 0,
        scaleX: layer.scaleX ?? 1,
        scaleY: layer.scaleY ?? 1,
        pivotX: layer.pivotX ?? 0,
        pivotY: layer.pivotY ?? 0,
        translateX: layer.translateX ?? 0,
        translateY: layer.translateY ?? 0,
        timeline: project.timeline.animation.blocks.filter(
          (block) => String(block.layerId) === layer.id,
        ),
      });
    }

    if ((layer.type === "path" || layer.type === "clipPath") && layer.pathData) {
      const pathBlock = pathBlocksByLayerId.get(layer.id);
      const from = String(pathBlock?.fromValue ?? layer.pathData);
      const to = String(pathBlock?.toValue ?? layer.pathData);
      result.push({
        id: layer.id,
        name: layer.name,
        type: isLayerType(layer.type) ? layer.type : "path",
        from: ensureStableCommandIds(parsePath(from)),
        to: ensureStableCommandIds(parsePath(to)),
        pathData: ensureStableCommandIds(parsePath(layer.pathData)),
        parentId,
        visible: !hiddenIds.has(layer.id),
        locked: false,
        expanded: true,
        fillColor: layer.fillColor ?? "",
        fillAlpha: layer.fillAlpha ?? 1,
        ...(layer.fillGradient ? { fillGradient: layer.fillGradient } : {}),
        strokeColor: layer.strokeColor ?? "",
        strokeAlpha: layer.strokeAlpha ?? 1,
        strokeWidth: layer.strokeWidth ?? 0,
        strokeLinecap: layer.strokeLinecap ?? "butt",
        strokeLinejoin: layer.strokeLinejoin ?? "miter",
        strokeMiterLimit: layer.strokeMiterLimit ?? 4,
        trimPathStart: layer.trimPathStart ?? 0,
        trimPathEnd: layer.trimPathEnd ?? 1,
        trimPathOffset: layer.trimPathOffset ?? 0,
        fillType: layer.fillType ?? "nonZero",
        alpha: layer.alpha ?? 1,
        rotation: layer.rotation ?? 0,
        scaleX: layer.scaleX ?? 1,
        scaleY: layer.scaleY ?? 1,
        pivotX: layer.pivotX ?? 0,
        pivotY: layer.pivotY ?? 0,
        translateX: layer.translateX ?? 0,
        translateY: layer.translateY ?? 0,
        timeline: project.timeline.animation.blocks.filter(
          (block) => String(block.layerId) === layer.id,
        ),
      });
    }

    for (const child of children) {
      // The serialized vector is an owner wrapper, not a rendered Layer. Its
      // immediate children therefore belong to the current owner rather than
      // to a phantom vector node that the flattened runtime never creates.
      walk(child, layer.type === "vector" ? parentId : layer.id);
    }
  };

  const vectorLayer = project.layers.vectorLayer;
  walk(vectorLayer, null);
  return {
    layers: result,
    hiddenLayerIds: project.layers.hiddenLayerIds.map(String),
    animation: {
      id: project.timeline.animation.id,
      name: project.timeline.animation.name,
      duration: project.timeline.animation.duration,
      blocks: project.timeline.animation.blocks,
    },
    vector: {
      id: vectorLayer.id,
      name: vectorLayer.name,
      width: vectorLayer.width ?? 24,
      height: vectorLayer.height ?? 24,
      alpha: vectorLayer.alpha ?? 1,
    },
  };
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isLayerId(value: unknown): value is string | number {
  return typeof value === "string" || isFiniteNumber(value);
}

function optionalNumber(value: unknown): number | undefined {
  return isFiniteNumber(value) ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/**
 * Recovery is deliberately lossy-tolerant: a corrupt layer/frame is skipped
 * with a diagnostic instead of discarding every surviving sibling. Warnings go
 * through console so imports stay silent unless something was actually dropped.
 */
function warnRecoverySkip(detail: string) {
  console.warn(`[project] Legacy recovery skipped ${detail}.`);
}

function skippedLayerLabel(entry: unknown): string {
  if (isRecord(entry) && (typeof entry.id === "string" || isFiniteNumber(entry.id))) {
    return `layer "${String(entry.id)}"`;
  }
  return "an unnamed layer";
}

function isSerializedPathData(value: unknown): value is PathData {
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

function parseSerializedPath(value: unknown): PathData | null {
  try {
    if (typeof value === "string") return ensureStableCommandIds(parsePath(value));
    if (isSerializedPathData(value)) return ensureStableCommandIds(structuredClone(value));
  } catch {
    // A corrupt path is not safe to project into a document. Let the caller keep
    // the untouched legacy envelope available for a better recovery route.
  }
  return null;
}

function isGradient(value: unknown): value is Gradient {
  return (
    isRecord(value) &&
    (value.type === "linear" || value.type === "radial") &&
    Array.isArray(value.stops) &&
    value.stops.every(
      (stop) =>
        isRecord(stop) &&
        isFiniteNumber(stop.offset) &&
        typeof stop.color === "string" &&
        (stop.opacity === undefined || isFiniteNumber(stop.opacity)),
    )
  );
}

function isMorphMapping(value: unknown): value is NonNullable<Layer["morphMapping"]> {
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

function parseModernLegacyLayer(value: unknown): Layer | null {
  if (!isRecord(value) || !isLayerId(value.id) || !isLayerType(String(value.type))) return null;
  const type = String(value.type) as LayerType;
  const fallbackPath = type === "group" || type === "vector" ? parsePath("") : null;
  const from = parseSerializedPath(value.from ?? value.pathData) ?? fallbackPath;
  if (!from) return null;
  const pathData = value.pathData === undefined ? from : parseSerializedPath(value.pathData);
  if (!pathData) return null;
  const to =
    value.to === undefined || value.to === null ? undefined : parseSerializedPath(value.to);
  if (value.to !== undefined && value.to !== null && !to) return null;
  const children =
    value.children === undefined
      ? undefined
      : Array.isArray(value.children)
        ? parseModernLegacyLayerList(value.children)
        : null;

  const layer: Layer = {
    id: value.id,
    name: optionalString(value.name) ?? `Recovered ${type}`,
    ...(optionalString(value.androidName)
      ? { androidName: optionalString(value.androidName) }
      : {}),
    type,
    from,
    ...(to ? { to } : {}),
    pathData,
    visible: optionalBoolean(value.visible) ?? true,
    locked: optionalBoolean(value.locked) ?? false,
    ...(optionalBoolean(value.expanded) === undefined
      ? {}
      : { expanded: optionalBoolean(value.expanded) }),
    ...(value.parentId === null
      ? { parentId: null }
      : isLayerId(value.parentId)
        ? { parentId: value.parentId }
        : {}),
    ...(children ? { children: children as Layer[] } : {}),
    ...(optionalNumber(value.alpha) === undefined ? {} : { alpha: optionalNumber(value.alpha) }),
    ...(optionalNumber(value.translateX) === undefined
      ? {}
      : { translateX: optionalNumber(value.translateX) }),
    ...(optionalNumber(value.translateY) === undefined
      ? {}
      : { translateY: optionalNumber(value.translateY) }),
    ...(optionalNumber(value.scaleX) === undefined ? {} : { scaleX: optionalNumber(value.scaleX) }),
    ...(optionalNumber(value.scaleY) === undefined ? {} : { scaleY: optionalNumber(value.scaleY) }),
    ...(optionalNumber(value.rotation) === undefined
      ? {}
      : { rotation: optionalNumber(value.rotation) }),
    ...(optionalNumber(value.pivotX) === undefined ? {} : { pivotX: optionalNumber(value.pivotX) }),
    ...(optionalNumber(value.pivotY) === undefined ? {} : { pivotY: optionalNumber(value.pivotY) }),
    ...(optionalNumber(value.duration) === undefined
      ? {}
      : { duration: optionalNumber(value.duration) }),
    ...(optionalString(value.fillColor) === undefined
      ? {}
      : { fillColor: optionalString(value.fillColor) }),
    ...(optionalNumber(value.fillAlpha) === undefined
      ? {}
      : { fillAlpha: optionalNumber(value.fillAlpha) }),
    ...(isGradient(value.fillGradient)
      ? { fillGradient: structuredClone(value.fillGradient) }
      : {}),
    ...(isMorphMapping(value.morphMapping)
      ? { morphMapping: structuredClone(value.morphMapping) }
      : {}),
    ...(optionalString(value.strokeColor) === undefined
      ? {}
      : { strokeColor: optionalString(value.strokeColor) }),
    ...(optionalNumber(value.strokeAlpha) === undefined
      ? {}
      : { strokeAlpha: optionalNumber(value.strokeAlpha) }),
    ...(optionalNumber(value.strokeWidth) === undefined
      ? {}
      : { strokeWidth: optionalNumber(value.strokeWidth) }),
    ...(value.strokeLinecap === "butt" ||
    value.strokeLinecap === "square" ||
    value.strokeLinecap === "round"
      ? { strokeLinecap: value.strokeLinecap }
      : {}),
    ...(value.strokeLinejoin === "miter" ||
    value.strokeLinejoin === "round" ||
    value.strokeLinejoin === "bevel"
      ? { strokeLinejoin: value.strokeLinejoin }
      : {}),
    ...(optionalNumber(value.strokeMiterLimit) === undefined
      ? {}
      : { strokeMiterLimit: optionalNumber(value.strokeMiterLimit) }),
    ...(optionalNumber(value.trimPathStart) === undefined
      ? {}
      : { trimPathStart: optionalNumber(value.trimPathStart) }),
    ...(optionalNumber(value.trimPathEnd) === undefined
      ? {}
      : { trimPathEnd: optionalNumber(value.trimPathEnd) }),
    ...(optionalNumber(value.trimPathOffset) === undefined
      ? {}
      : { trimPathOffset: optionalNumber(value.trimPathOffset) }),
    ...(value.fillType === "nonZero" || value.fillType === "evenOdd"
      ? { fillType: value.fillType }
      : {}),
    ...(optionalString(value.strokeDasharray) === undefined
      ? {}
      : { strokeDasharray: optionalString(value.strokeDasharray) }),
  };
  return layer;
}

function parseModernLegacyLayerList(entries: unknown[]): Layer[] {
  return entries.flatMap((entry) => {
    const layer = parseModernLegacyLayer(entry);
    if (layer) return [layer];
    warnRecoverySkip(`${skippedLayerLabel(entry)} because it could not be parsed`);
    return [];
  });
}

function parseModernLegacyLayers(value: unknown): Layer[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length === 0) return [];
  const layers = parseModernLegacyLayerList(value);
  // Everything failed: this list carries no recoverable content.
  return layers.length ? layers : null;
}

function parseModernLegacyAnimation(value: unknown): AnimationState | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    !isFiniteNumber(value.duration) ||
    !Array.isArray(value.blocks)
  ) {
    return null;
  }
  const blocks: TimelineBlock[] = [];
  for (const block of value.blocks) {
    if (
      !isRecord(block) ||
      typeof block.id !== "string" ||
      !isLayerId(block.layerId) ||
      typeof block.propertyName !== "string" ||
      (typeof block.fromValue !== "string" && !isFiniteNumber(block.fromValue)) ||
      (typeof block.toValue !== "string" && !isFiniteNumber(block.toValue)) ||
      !isFiniteNumber(block.startTime) ||
      !isFiniteNumber(block.endTime) ||
      (block.interpolator !== undefined && typeof block.interpolator !== "string") ||
      (block.type !== undefined &&
        block.type !== "path" &&
        block.type !== "color" &&
        block.type !== "number")
    ) {
      return null;
    }
    const blockType = block.type as TimelineBlock["type"] | undefined;
    blocks.push({
      id: block.id,
      layerId: block.layerId,
      propertyName: block.propertyName,
      fromValue: block.fromValue,
      toValue: block.toValue,
      startTime: block.startTime,
      endTime: block.endTime,
      ...(typeof block.interpolator === "string" ? { interpolator: block.interpolator } : {}),
      ...(blockType ? { type: blockType } : {}),
    });
  }
  return { id: value.id, name: value.name, duration: value.duration, blocks };
}

function parseModernLegacyVector(value: unknown, fallback?: VectorMetadata): VectorMetadata | null {
  const source = isRecord(value) ? value : undefined;
  const id = source && isLayerId(source.id) ? source.id : fallback?.id;
  const name = source && typeof source.name === "string" ? source.name : fallback?.name;
  const width = source && isFiniteNumber(source.width) ? source.width : fallback?.width;
  const height = source && isFiniteNumber(source.height) ? source.height : fallback?.height;
  const alpha = source && isFiniteNumber(source.alpha) ? source.alpha : fallback?.alpha;
  if (
    id === undefined ||
    !name ||
    width === undefined ||
    height === undefined ||
    alpha === undefined
  )
    return null;
  return {
    id,
    name,
    width,
    height,
    alpha,
    ...(source && optionalNumber(source.viewportWidth) !== undefined
      ? { viewportWidth: optionalNumber(source.viewportWidth) }
      : fallback?.viewportWidth === undefined
        ? {}
        : { viewportWidth: fallback.viewportWidth }),
    ...(source && optionalNumber(source.viewportHeight) !== undefined
      ? { viewportHeight: optionalNumber(source.viewportHeight) }
      : fallback?.viewportHeight === undefined
        ? {}
        : { viewportHeight: fallback.viewportHeight }),
    ...(source && optionalString(source.widthUnit) !== undefined
      ? { widthUnit: optionalString(source.widthUnit) }
      : fallback?.widthUnit === undefined
        ? {}
        : { widthUnit: fallback.widthUnit }),
    ...(source && optionalString(source.heightUnit) !== undefined
      ? { heightUnit: optionalString(source.heightUnit) }
      : fallback?.heightUnit === undefined
        ? {}
        : { heightUnit: fallback.heightUnit }),
    ...(source && optionalString(source.tint) !== undefined
      ? { tint: optionalString(source.tint) }
      : fallback?.tint === undefined
        ? {}
        : { tint: fallback.tint }),
    ...(source && optionalString(source.tintMode) !== undefined
      ? { tintMode: optionalString(source.tintMode) }
      : fallback?.tintMode === undefined
        ? {}
        : { tintMode: fallback.tintMode }),
    ...(source && optionalBoolean(source.autoMirrored) !== undefined
      ? { autoMirrored: optionalBoolean(source.autoMirrored) }
      : fallback?.autoMirrored === undefined
        ? {}
        : { autoMirrored: fallback.autoMirrored }),
    ...(source && optionalNumber(source.minSdk) !== undefined
      ? { minSdk: optionalNumber(source.minSdk) }
      : fallback?.minSdk === undefined
        ? {}
        : { minSdk: fallback.minSdk }),
  };
}

function parseHiddenLayerIds(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(isLayerId)) return null;
  return value.map(String);
}

function applyHiddenLayerIds(layers: Layer[], hiddenLayerIds: string[]): Layer[] {
  if (hiddenLayerIds.length === 0) return layers;
  const hidden = new Set(hiddenLayerIds);
  const apply = (items: Layer[]): Layer[] =>
    items.map((layer) => ({
      ...layer,
      ...(hidden.has(String(layer.id)) ? { visible: false } : {}),
      ...(layer.children?.length ? { children: apply(layer.children) } : {}),
    }));
  return apply(layers);
}

/**
 * Pre-pageRoot project exports kept the page scene in the original top-level
 * vector envelope. Flatten it into the legacy runtime shape only for recovery
 * of a damaged V2 graph, and promote the vector's direct children to page roots.
 */
function recoverOriginalProjectRoot(value: unknown): {
  layers: Layer[];
  vector: VectorMetadata;
  animation: AnimationState;
  hiddenLayerIds: string[];
} | null {
  if (!isOriginalShapeShifterProject(value)) return null;
  const project = flattenOriginalProject(value);
  const vectorId = String(value.layers.vectorLayer.id);
  return {
    ...project,
    layers: project.layers.map((layer) =>
      String(layer.parentId) === vectorId ? { ...layer, parentId: null } : layer,
    ),
  };
}

/**
 * Recover the full multi-artboard legacy envelope written alongside documentV2.
 * It is intentionally used only as a fallback: valid documentV2 data remains
 * canonical, while a broken graph can still retain every frame and the page root.
 * Older backups predate `pageRoot`, so their original top-level vector envelope
 * supplies the page scene instead.
 */
export function recoverLegacyDocumentSnapshot(value: unknown): LegacyDocumentSnapshot | null {
  try {
    if (!isRecord(value) || !Array.isArray(value.frames)) return null;
    const pageRoot = isRecord(value.pageRoot) ? value.pageRoot : undefined;
    if (value.pageRoot !== undefined && !pageRoot) return null;
    const originalRoot = pageRoot ? null : recoverOriginalProjectRoot(value);
    if (!pageRoot && !originalRoot) return null;
    const topLevelVector = isRecord(value.layers)
      ? parseModernLegacyVector(value.layers.vectorLayer)
      : null;
    const rootVector = pageRoot
      ? parseModernLegacyVector(pageRoot.vector, topLevelVector ?? undefined)
      : (originalRoot?.vector ?? topLevelVector);
    const parsedRootLayers = pageRoot
      ? parseModernLegacyLayers(pageRoot.layers)
      : (originalRoot?.layers ?? null);
    const rootAnimation =
      (pageRoot ? parseModernLegacyAnimation(pageRoot.animation) : originalRoot?.animation) ??
      (isRecord(value.timeline) ? parseModernLegacyAnimation(value.timeline.animation) : null);
    const rootHiddenLayerIds = pageRoot
      ? parseHiddenLayerIds(pageRoot.hiddenLayerIds)
      : (originalRoot?.hiddenLayerIds ?? null);
    if (!rootVector || !parsedRootLayers || !rootAnimation || !rootHiddenLayerIds) return null;
    const rootLayers = applyHiddenLayerIds(parsedRootLayers, rootHiddenLayerIds);
    const frames = value.frames.flatMap((rawFrame) => {
      if (!isRecord(rawFrame) || typeof rawFrame.id !== "string") {
        warnRecoverySkip("a frame without a usable id");
        return [];
      }
      const vector = parseModernLegacyVector(rawFrame.vector, rootVector);
      const layers = parseModernLegacyLayers(rawFrame.layers);
      const animation = parseModernLegacyAnimation(rawFrame.animation);
      const hiddenLayerIds = parseHiddenLayerIds(rawFrame.hiddenLayerIds);
      if (!vector || !layers || !animation || !hiddenLayerIds) {
        warnRecoverySkip(`frame "${rawFrame.id}" because its payload could not be parsed`);
        return [];
      }
      return [
        {
          id: rawFrame.id,
          name: optionalString(rawFrame.name) ?? vector.name,
          x: optionalNumber(rawFrame.x) ?? 0,
          y: optionalNumber(rawFrame.y) ?? 0,
          vector,
          layers: applyHiddenLayerIds(layers, hiddenLayerIds),
          animation,
          hiddenLayerIds,
        },
      ];
    });
    // A snapshot with no recoverable frame is not a document.
    if (frames.length === 0 && value.frames.length > 0) return null;

    const invalidDocument = isRecord(value.documentV2) ? value.documentV2 : undefined;
    return {
      id:
        invalidDocument && typeof invalidDocument.id === "string"
          ? invalidDocument.id
          : String(rootVector.id),
      name:
        invalidDocument && typeof invalidDocument.name === "string"
          ? invalidDocument.name
          : rootVector.name || "ShapeShifter",
      frames: frames as LegacyDocumentSnapshot["frames"],
      rootLayers,
      rootVector,
      rootAnimation,
      rootHiddenLayerIds,
    };
  } catch {
    return null;
  }
}
