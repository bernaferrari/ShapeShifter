import React, { useCallback, useMemo } from "react";
import type { CanvasFrame } from "@/lib/store/defaultWorkspace";
import { gradientDomId, gradientToSvg } from "@/lib/shapeshifter/gradients";
import { getPathDataBounds, parsePath, pathToString } from "@/lib/shapeshifter/pathUtils";
import { matrixToSvg } from "@/lib/shapeshifter/scene/layerTransform";
import { resolveWorldLayerDraws, type WorldLayerDraw } from "@/lib/shapeshifter/scene/render";
import { PAGE_ROOT_ID, type LayerSelectionRef } from "@/lib/shapeshifter/scene/owners";
import type { AnimationState, Layer, PathData } from "@/lib/shapeshifter/types";

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

function LayerDraw({
  draw,
  ownerId,
  hoverBounds,
}: {
  draw: WorldLayerDraw;
  ownerId: string;
  hoverBounds?: ReturnType<typeof boundsFromPathD>;
}) {
  const gradId = draw.fillGradient ? `${gradientDomId(ownerId)}-${draw.id}` : null;
  const trimStart = ((draw.trimPathStart + draw.trimPathOffset) % 1 + 1) % 1;
  const trimEnd = ((draw.trimPathEnd + draw.trimPathOffset) % 1 + 1) % 1;
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
      {hoverBounds && (
        <rect
          x={hoverBounds.x}
          y={hoverBounds.y}
          width={hoverBounds.w}
          height={hoverBounds.h}
          fill="none"
          stroke="#0d99ff"
          strokeWidth={1}
          strokeOpacity={0.55}
          pointerEvents="none"
        />
      )}
    </g>
  );
  return draw.clipNodeIds.reduceRight<React.ReactNode>(
    (nested, clipNodeId) => (
      <g key={`${ownerId}:${draw.id}:clip:${String(clipNodeId)}`} clipPath={`url(#${clipDomId(ownerId, clipNodeId)})`}>
        {nested}
      </g>
    ),
    content,
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
          <path d={clip.d} transform={matrixToSvg(clip.worldMatrix)} />
        </clipPath>
      ))}
    </defs>
  );
}

/** Static world-scene rendering for frame paper, vector content, grid, and page vectors. */
export function WorldArtboards({
  frames,
  getFrameBounds,
  activeLayers,
  activeAnimation,
  rootLayers,
  rootAnimation,
  selectedFrameId,
  selectedFrameIds,
  selectedLayerRefs,
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
  const frameDraws = useCallback(
    (frame: CanvasFrame): WorldLayerDraw[] => {
      const active = frame.id === selectedFrameId;
      return resolveWorldLayerDraws(
        active ? activeLayers : frame.layers,
        active ? activeAnimation : frame.animation,
        progress,
        isPlaying || progress > 0.001,
      );
    },
    [activeAnimation, activeLayers, isPlaying, progress, selectedFrameId],
  );
  const pageDraws = useMemo(
    () =>
      resolveWorldLayerDraws(rootLayers, rootAnimation, progress, isPlaying || progress > 0.001),
    [isPlaying, progress, rootAnimation, rootLayers],
  );
  const draggingOwnerIds = useMemo(
    () => new Set(selectedLayerRefs.map((ref) => ref.ownerId)),
    [selectedLayerRefs],
  );

  return (
    <>
      {frames.map((frame) => {
        const bounds = getFrameBounds(frame);
        const selected =
          hasCanvasSelection &&
          selectionKind === "frame" &&
          (selectedFrameIds.includes(frame.id) ||
            (selectedFrameIds.length === 0 && frame.id === selectedFrameId));
        const containsSelection =
          hasCanvasSelection && selectionKind === "layer" && frame.id === selectedFrameId;
        const draggingFrame = draggingFrameIds.includes(frame.id);
        const dropTarget = layerDropTargetId === frame.id;
        const hovered = hoveredFrameId === frame.id && !selected && !containsSelection;
        let draws = frameDraws(frame);
        if (isLayerDragging) {
          draws = draws.filter(
            (draw) => !selectedLayerRefKeys.has(`${frame.id}:${String(draw.id)}`),
          );
        }
        if (
          !isPlaying &&
          progress === 0 &&
          frame.id === selectedFrameId &&
          editPath &&
          editLayer &&
          editLayer.type !== "group"
        ) {
          draws = draws.map((draw) =>
            String(draw.id) === String(editLayer.id)
              ? { ...draw, d: pathToString(editPath) }
              : draw,
          );
        }
        const onionD =
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
            : "";
        const borderColor = dropTarget
          ? "#0d99ff"
          : selected || draggingFrame
            ? "#0d99ff"
            : containsSelection
              ? "rgba(13,153,255,0.55)"
              : hovered
                ? "#7cc4ff"
                : "var(--border)";
        const borderWidth =
          dropTarget || draggingFrame ? 2 : selected || containsSelection || hovered ? 1.5 : 1;
        const borderDash =
          containsSelection && !selected ? `${worldPerPx * 3} ${worldPerPx * 2}` : undefined;
        const radius = Math.max(0.5, bounds.w * 0.015);

        return (
          <g key={frame.id} transform={`translate(${bounds.x} ${bounds.y})`}>
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
            <g
              clipPath={
                isLayerDragging && draggingOwnerIds.has(frame.id)
                  ? undefined
                  : `url(#frame-clip-${frame.id})`
              }
            >
              <ClipDefinitions ownerId={frame.id} draws={draws} />
              {onionD && !isPlaying && progress < 0.001 && (
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
              {draws.filter((draw) => !draw.isClipPath).map((draw) => {
                const key = `${frame.id}:${String(draw.id)}`;
                const layerSelected =
                  hasCanvasSelection && selectionKind === "layer" && selectedLayerRefKeys.has(key);
                const layerHovered = hoveredLayerKey === key && !layerSelected;
                const hoverBounds =
                  !isPointTool && layerHovered && draw.d ? boundsFromPathD(draw.d) : null;
                return (
                  <LayerDraw
                    key={String(draw.id)}
                    draw={draw}
                    ownerId={frame.id}
                    hoverBounds={hoverBounds}
                  />
                );
              })}
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
      })}
      <ClipDefinitions ownerId={PAGE_ROOT_ID} draws={pageDraws} />
      {pageDraws
        .filter(
          (draw) =>
            !draw.isClipPath &&
            (!isLayerDragging || !selectedLayerRefKeys.has(`${PAGE_ROOT_ID}:${String(draw.id)}`)),
        )
        .map((draw) => {
          const key = `${PAGE_ROOT_ID}:${String(draw.id)}`;
          const selected = hasCanvasSelection && selectedLayerRefKeys.has(key);
          const hovered = hoveredLayerKey === key && !selected;
          return (
            <LayerDraw
              key={`root-${draw.id}`}
              draw={draw}
              ownerId={PAGE_ROOT_ID}
              hoverBounds={hovered && draw.d ? boundsFromPathD(draw.d) : null}
            />
          );
        })}
    </>
  );
}
