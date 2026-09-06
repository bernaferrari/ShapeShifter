import React, { useCallback, useMemo } from "react";
import type { CanvasFrame } from "@/lib/store/defaultWorkspace";
import { gradientToSvg, sanitizeCssColor, svgIdFragment } from "@/lib/shapeshifter/gradients";
import { getPathDataBounds, parsePath, pathToString } from "@/lib/shapeshifter/pathUtils";
import { matrixToSvg } from "@/lib/shapeshifter/scene/layerTransform";
import { resolveWorldLayerDraws, type WorldLayerDraw } from "@/lib/shapeshifter/scene/render";
import { PAGE_ROOT_ID, type LayerSelectionRef } from "@/lib/shapeshifter/scene/owners";
import { vectorCoordinateSize } from "@/lib/shapeshifter/vectorSpace";
import type { AnimationState, Layer, PathData, VectorMetadata } from "@/lib/shapeshifter/types";

interface FrameBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface WorldArtboardsProps {
  frames: CanvasFrame[];
  getFrameBounds: (frame: CanvasFrame) => FrameBounds;
  activeLayers: Layer[];
  activeAnimation: AnimationState;
  rootLayers: Layer[];
  rootAnimation: AnimationState;
  rootVector: VectorMetadata;
  selectedFrameId: string;
  selectedFrameIds: string[];
  selectedLayerRefs: LayerSelectionRef[];
  selectedLayerRefKeys: Set<string>;
  selectionKind: "none" | "frame" | "layer";
  hasCanvasSelection: boolean;
  editingSide: "from" | "to";
  editLayer?: Layer;
  editPath: PathData | null;
  hoveredFrameId: string | null;
  hoveredLayerKey: string | null;
  draggingFrameIds: string[];
  layerDropTargetId?: string;
  isLayerDragging: boolean;
  isPointTool: boolean;
  isPlaying: boolean;
  progress: number;
  worldPerPx: number;
  gridVisibility: { minorOpacity: number; majorOpacity: number };
}

function boundsFromPathD(d: string) {
  if (!d.trim()) return null;
  try {
    return getPathDataBounds(parsePath(d));
  } catch {
    return null;
  }
}

function wrapDrawWithClips(draw: WorldLayerDraw, ownerId: string, content: React.ReactNode) {
  return draw.clipNodeIds.reduceRight<React.ReactNode>(
    (nested, clipNodeId) => (
      <g
        key={`${ownerId}:${draw.id}:clip:${String(clipNodeId)}`}
        clipPath={`url(#${clipDomId(ownerId, clipNodeId)})`}
      >
        {nested}
      </g>
    ),
    content,
  );
}

function LayerDraw({ draw, ownerId }: { draw: WorldLayerDraw; ownerId: string }) {
  const gradId = draw.fillGradient
    ? `ss-world-grad-${svgIdFragment(ownerId)}-${svgIdFragment(draw.id)}`
    : null;
  const trimStart = (((draw.trimPathStart + draw.trimPathOffset) % 1) + 1) % 1;
  const trimEnd = (((draw.trimPathEnd + draw.trimPathOffset) % 1) + 1) % 1;
  const trimLength = trimEnd >= trimStart ? trimEnd - trimStart : 1 - trimStart + trimEnd;
  const strokeTrim =
    draw.stroke && (draw.trimPathStart !== 0 || draw.trimPathEnd !== 1 || draw.trimPathOffset !== 0)
      ? {
          pathLength: 1,
          strokeDasharray: `${Math.max(0, trimLength)} ${Math.max(0, 1 - trimLength)}`,
          strokeDashoffset: -trimStart,
        }
      : undefined;
  const content = (
    <g transform={matrixToSvg(draw.worldMatrix)}>
      {draw.fillGradient && gradId && (
        <defs
          dangerouslySetInnerHTML={{
            __html: gradientToSvg(draw.fillGradient, gradId, draw.fillOpacity),
          }}
        />
      )}
      {draw.d && (
        <path
          d={draw.d}
          fill={gradId ? `url(#${gradId})` : (draw.fill ?? "none")}
          fillOpacity={gradId ? 1 : draw.fillOpacity}
          fillRule={draw.fillType === "evenOdd" ? "evenodd" : "nonzero"}
          stroke={draw.stroke ?? "none"}
          strokeOpacity={draw.strokeOpacity}
          strokeWidth={draw.strokeWidth}
          strokeLinecap={draw.strokeLinecap}
          strokeLinejoin={draw.strokeLinejoin}
          strokeMiterlimit={draw.strokeMiterLimit}
          strokeDasharray={draw.strokeDasharray}
          {...strokeTrim}
          pointerEvents="none"
        />
      )}
    </g>
  );
  return wrapDrawWithClips(draw, ownerId, content);
}

function LayerHoverBounds({
  draw,
  ownerId,
  bounds,
}: {
  draw: WorldLayerDraw;
  ownerId: string;
  bounds: NonNullable<ReturnType<typeof boundsFromPathD>>;
}) {
  return wrapDrawWithClips(
    draw,
    ownerId,
    <g transform={matrixToSvg(draw.worldMatrix)}>
      <rect
        x={bounds.x}
        y={bounds.y}
        width={bounds.w}
        height={bounds.h}
        fill="none"
        stroke="#0d99ff"
        strokeWidth={1}
        strokeOpacity={0.55}
        pointerEvents="none"
      />
    </g>,
  );
}

function clipDomId(ownerId: string, id: string | number) {
  return `android-clip-${ownerId}-${String(id).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function ClipDefinitions({ ownerId, draws }: { ownerId: string; draws: WorldLayerDraw[] }) {
  const clips = draws.filter((draw) => draw.isClipPath && draw.d);
  if (!clips.length) return null;
  return (
    <defs>
      {clips.map((clip) => (
        <clipPath key={String(clip.id)} id={clipDomId(ownerId, clip.id)}>
          <path
            d={clip.d}
            transform={matrixToSvg(clip.worldMatrix)}
            clipRule={clip.fillType === "evenOdd" ? "evenodd" : "nonzero"}
          />
        </clipPath>
      ))}
    </defs>
  );
}

function rootAlpha(vector: VectorMetadata): number {
  return Number.isFinite(vector.alpha) ? Math.max(0, Math.min(1, vector.alpha)) : 1;
}

function rootTint(vector: VectorMetadata): string | undefined {
  const tint = vector.tint?.trim();
  if (!tint) return undefined;
  const tintMode = vector.tintMode?.trim().toLowerCase().replaceAll("-", "_");
  if (tintMode && tintMode !== "src_in") return undefined;
  return sanitizeCssColor(tint, "") || undefined;
}

function VectorDrawableRootPaint({
  vector,
  ownerId,
  width,
  height,
  children,
}: {
  vector: VectorMetadata;
  ownerId: string;
  width: number;
  height: number;
  children: React.ReactNode;
}) {
  const alpha = rootAlpha(vector);
  const tint = rootTint(vector);
  if (!tint) {
    return alpha === 1 ? <>{children}</> : <g opacity={alpha}>{children}</g>;
  }

  const maskId = `android-root-tint-mask-${svgIdFragment(ownerId)}`;
  return (
    <>
      <defs>
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          maskContentUnits="userSpaceOnUse"
          x={0}
          y={0}
          width={width}
          height={height}
          {...{ "mask-type": "alpha" }}
        >
          {children}
        </mask>
      </defs>
      <g opacity={alpha}>
        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          fill={tint}
          mask={`url(#${maskId})`}
          pointerEvents="none"
        />
      </g>
    </>
  );
}

/**
 * One artboard, memoized. Hover/drag flags arrive as primitives so a pointermove
 * only re-renders the frames whose flags actually flipped; each instance keeps
 * its resolved draw list in a memo so the others never re-resolve geometry.
 */
const FrameArtboard = React.memo(function FrameArtboard({
  frame,
  getFrameBounds,
  activeLayers,
  activeAnimation,
  selectedFrameId,
  selectedFrameIds,
  selectionKind,
  hasCanvasSelection,
  editingSide,
  editLayer,
  editPath,
  hovered,
  draggingFrame,
  dropTarget,
  isLayerDragging,
  selectedLayerRefKeys,
  isPlaying,
  progress,
  worldPerPx,
  gridVisibility,
}: {
  frame: CanvasFrame;
  getFrameBounds: (frame: CanvasFrame) => FrameBounds;
  activeLayers: Layer[];
  activeAnimation: AnimationState;
  selectedFrameId: string;
  selectedFrameIds: string[];
  selectionKind: "none" | "frame" | "layer";
  hasCanvasSelection: boolean;
  editingSide: "from" | "to";
  editLayer?: Layer;
  editPath: PathData | null;
  hovered: boolean;
  draggingFrame: boolean;
  dropTarget: boolean;
  isLayerDragging: boolean;
  selectedLayerRefKeys: Set<string>;
  isPlaying: boolean;
  progress: number;
  worldPerPx: number;
  gridVisibility: { minorOpacity: number; majorOpacity: number };
}) {
  const bounds = getFrameBounds(frame);
  const selected =
    hasCanvasSelection &&
    selectionKind === "frame" &&
    (selectedFrameIds.includes(frame.id) ||
      (selectedFrameIds.length === 0 && frame.id === selectedFrameId));
  const containsSelection =
    hasCanvasSelection && selectionKind === "layer" && frame.id === selectedFrameId;
  const hoveredActive = hovered && !selected && !containsSelection;
  const draws = useMemo(() => {
    const active = frame.id === selectedFrameId;
    let next = resolveWorldLayerDraws(
      active ? activeLayers : frame.layers,
      active ? activeAnimation : frame.animation,
      progress,
      isPlaying || progress > 0.001,
    );
    if (isLayerDragging) {
      next = next.filter((draw) => !selectedLayerRefKeys.has(`${frame.id}:${String(draw.id)}`));
    }
    if (
      !isPlaying &&
      progress === 0 &&
      active &&
      editPath &&
      editLayer &&
      editLayer.type !== "group"
    ) {
      next = next.map((draw) =>
        String(draw.id) === String(editLayer.id) ? { ...draw, d: pathToString(editPath) } : draw,
      );
    }
    return next;
  }, [
    activeAnimation,
    activeLayers,
    editLayer,
    editPath,
    frame,
    isLayerDragging,
    isPlaying,
    progress,
    selectedFrameId,
    selectedLayerRefKeys,
  ]);
  const onionD = useMemo(
    () =>
      !isPlaying &&
      progress === 0 &&
      frame.id === selectedFrameId &&
      editLayer &&
      editLayer.type !== "group"
        ? pathToString(
            (editLayer[editingSide === "from" ? "to" : "from"] as PathData) ?? {
              subPaths: [],
            },
          )
        : "",
    [editLayer, editingSide, frame.id, isPlaying, progress, selectedFrameId],
  );
  const borderColor = dropTarget
    ? "#0d99ff"
    : selected || draggingFrame
      ? "#0d99ff"
      : containsSelection
        ? "rgba(13,153,255,0.55)"
        : hoveredActive
          ? "#7cc4ff"
          : "var(--border)";
  const borderWidth =
    dropTarget || draggingFrame ? 2 : selected || containsSelection || hoveredActive ? 1.5 : 1;
  const borderDash =
    containsSelection && !selected ? `${worldPerPx * 3} ${worldPerPx * 2}` : undefined;
  const radius = Math.max(0.5, bounds.w * 0.015);
  const visibleDraws = useMemo(() => draws.filter((draw) => !draw.isClipPath), [draws]);
  return (
    <g transform={`translate(${bounds.x} ${bounds.y})`}>
      <rect
        width={bounds.w}
        height={bounds.h}
        rx={radius}
        fill="#ffffff"
        filter="url(#dragShadow)"
      />
      {gridVisibility.minorOpacity > 0 && (
        <rect
          width={bounds.w}
          height={bounds.h}
          rx={radius}
          fill="url(#frame-grid-minor)"
          pointerEvents="none"
        />
      )}
      {gridVisibility.majorOpacity > 0 && (
        <rect
          width={bounds.w}
          height={bounds.h}
          rx={radius}
          fill="url(#frame-grid-major)"
          pointerEvents="none"
        />
      )}
      {dropTarget && (
        <rect
          width={bounds.w}
          height={bounds.h}
          rx={radius}
          fill="#0d99ff"
          fillOpacity={0.06}
          pointerEvents="none"
        />
      )}
      <clipPath id={`frame-clip-${frame.id}`}>
        <rect width={bounds.w} height={bounds.h} rx={radius} />
      </clipPath>
      <g clipPath={`url(#frame-clip-${frame.id})`}>
        <ClipDefinitions ownerId={frame.id} draws={draws} />
        {onionD && (
          <path
            d={onionD}
            fill="none"
            stroke="#0d99ff"
            strokeWidth={Math.max(0.8, Math.min(2.2, bounds.w / 24))}
            strokeDasharray={`${worldPerPx * 4} ${worldPerPx * 3}`}
            opacity={0.35}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        )}
        <VectorDrawableRootPaint
          vector={frame.vector}
          ownerId={frame.id}
          width={bounds.w}
          height={bounds.h}
        >
          {visibleDraws.map((draw) => (
            <LayerDraw key={String(draw.id)} draw={draw} ownerId={frame.id} />
          ))}
        </VectorDrawableRootPaint>
      </g>
      <rect
        width={bounds.w}
        height={bounds.h}
        rx={radius}
        fill="none"
        stroke={borderColor}
        strokeWidth={borderWidth}
        strokeDasharray={borderDash}
        vectorEffect="non-scaling-stroke"
        pointerEvents="none"
      />
    </g>
  );
});

/**
 * Isolated hover-outline layer. Subscribes to the hovered layer key so a pure
 * pointermove re-renders only this small component — never the artboard frame
 * map or the page-vector paint tree above it. Path-string bounds parsing runs
 * here, once per hovered draw, instead of inside every frame's render.
 */
const WorldHoverOutlines = React.memo(function WorldHoverOutlines({
  ownerId,
  hoveredLayerKey,
  selectedLayerRefKeys,
  isPointTool,
  resolveDraws,
}: {
  ownerId: string;
  hoveredLayerKey: string | null;
  selectedLayerRefKeys: Set<string>;
  isPointTool: boolean;
  resolveDraws: () => WorldLayerDraw[];
}) {
  if (!hoveredLayerKey || isPointTool) return null;
  const prefix = `${ownerId}:`;
  if (!hoveredLayerKey.startsWith(prefix)) return null;
  const hoveredId = hoveredLayerKey.slice(prefix.length);
  return resolveDraws()
    .filter(
      (draw) =>
        !draw.isClipPath &&
        String(draw.id) === hoveredId &&
        !selectedLayerRefKeys.has(hoveredLayerKey) &&
        draw.d,
    )
    .map((draw) => {
      const hoverBounds = boundsFromPathD(draw.d);
      return hoverBounds ? (
        <LayerHoverBounds
          key={`hover-${ownerId}-${String(draw.id)}`}
          draw={draw}
          ownerId={ownerId}
          bounds={hoverBounds}
        />
      ) : null;
    });
});

/** Static world-scene rendering for frame paper, vector content, grid, and page vectors. */
export function WorldArtboards({
  frames,
  getFrameBounds,
  activeLayers,
  activeAnimation,
  rootLayers,
  rootAnimation,
  rootVector,
  selectedFrameId,
  selectedFrameIds,
  selectedLayerRefKeys,
  selectionKind,
  hasCanvasSelection,
  editingSide,
  editLayer,
  editPath,
  hoveredFrameId,
  hoveredLayerKey,
  draggingFrameIds,
  layerDropTargetId,
  isLayerDragging,
  isPointTool,
  isPlaying,
  progress,
  worldPerPx,
  gridVisibility,
}: WorldArtboardsProps) {
  const pageDraws = useMemo(
    () =>
      resolveWorldLayerDraws(rootLayers, rootAnimation, progress, isPlaying || progress > 0.001),
    [isPlaying, progress, rootAnimation, rootLayers],
  );
  const rootSize = useMemo(() => vectorCoordinateSize(rootVector), [rootVector]);
  const resolveRootHoverDraws = useCallback(() => pageDraws, [pageDraws]);

  return (
    <>
      {frames.map((frame) => (
        <React.Fragment key={frame.id}>
          <FrameArtboard
            frame={frame}
            getFrameBounds={getFrameBounds}
            activeLayers={activeLayers}
            activeAnimation={activeAnimation}
            selectedFrameId={selectedFrameId}
            selectedFrameIds={selectedFrameIds}
            selectionKind={selectionKind}
            hasCanvasSelection={hasCanvasSelection}
            editingSide={editingSide}
            editLayer={editLayer}
            editPath={editPath}
            hovered={hoveredFrameId === frame.id}
            draggingFrame={draggingFrameIds.includes(frame.id)}
            dropTarget={layerDropTargetId === frame.id}
            isLayerDragging={isLayerDragging}
            selectedLayerRefKeys={selectedLayerRefKeys}
            isPlaying={isPlaying}
            progress={progress}
            worldPerPx={worldPerPx}
            gridVisibility={gridVisibility}
          />
          <WorldHoverOutlines
            ownerId={frame.id}
            hoveredLayerKey={hoveredLayerKey}
            selectedLayerRefKeys={selectedLayerRefKeys}
            isPointTool={isPointTool}
            resolveDraws={() =>
              // Frame draws live inside the memoized child; re-resolving here is
              // cache-backed (evaluateAndroidScene WeakMap) so this stays cheap.
              resolveWorldLayerDraws(
                frame.id === selectedFrameId ? activeLayers : frame.layers,
                frame.id === selectedFrameId ? activeAnimation : frame.animation,
                progress,
                isPlaying || progress > 0.001,
              )
            }
          />
        </React.Fragment>
      ))}
      <ClipDefinitions ownerId={PAGE_ROOT_ID} draws={pageDraws} />
      <VectorDrawableRootPaint
        vector={rootVector}
        ownerId={PAGE_ROOT_ID}
        width={rootSize.width}
        height={rootSize.height}
      >
        {pageDraws
          .filter(
            (draw) =>
              !draw.isClipPath &&
              (!isLayerDragging || !selectedLayerRefKeys.has(`${PAGE_ROOT_ID}:${String(draw.id)}`)),
          )
          .map((draw) => (
            <LayerDraw key={`root-${draw.id}`} draw={draw} ownerId={PAGE_ROOT_ID} />
          ))}
      </VectorDrawableRootPaint>
      <WorldHoverOutlines
        ownerId={PAGE_ROOT_ID}
        hoveredLayerKey={hoveredLayerKey}
        selectedLayerRefKeys={selectedLayerRefKeys}
        isPointTool={isPointTool}
        resolveDraws={resolveRootHoverDraws}
      />
    </>
  );
}
