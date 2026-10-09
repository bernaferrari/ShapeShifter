import { useEffect, useRef } from "react";
import { useEditorStore } from "@/lib/store/editorStore";
import { usePathPointHighlight } from "../pathPointHighlight";
import {
  pointPresentation,
  edgePresentation,
  type PointAddress,
} from "@/lib/pathshift/path/pointPresentation";
import { materializeSmoothCommands } from "@/lib/pathshift/path/commandNormalization";
import { getSegmentTargets } from "./pathCanvasGeometry";
import { getPathDataBounds } from "@/lib/pathshift/path/pathDataIO";
import { pathToString } from "@/lib/pathshift/pathUtils";
import { numberAtTime, sampleMotionPath } from "@/lib/pathshift/playheadResolve";
import {
  matrixToSvg,
  transformPointWithMatrix,
  type AffineMatrix,
} from "@/lib/pathshift/scene/layerTransform";
import type { GuideLine } from "@/lib/pathshift/smartGuides";
import type { AnimationState, Layer, PathData, Selection } from "@/lib/pathshift/types";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { FrameResizeHandle } from "@/lib/pathshift/gestures/select/FrameResizeGesture";

interface Point {
  x: number;
  y: number;
}

interface Rect extends Point {
  w: number;
  h: number;
}

export function WorldSmartGuides({ guides }: { guides: GuideLine[] }) {
  return guides.map((guide, index) =>
    guide.orientation === "v" ? (
      <line
        key={`smart-v-${index}`}
        x1={guide.pos}
        y1={guide.from}
        x2={guide.pos}
        y2={guide.to}
        stroke="#ff00ff"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        pointerEvents="none"
      />
    ) : (
      <line
        key={`smart-h-${index}`}
        x1={guide.from}
        y1={guide.pos}
        x2={guide.to}
        y2={guide.pos}
        stroke="#ff00ff"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        pointerEvents="none"
      />
    ),
  );
}

export function WorldMotionPaths({
  visible,
  origin,
  layers,
  animation,
  selectedLayerIds,
  primaryLayerId,
  progress,
  worldPerPixel,
}: {
  visible: boolean;
  origin: Point | null;
  layers: Layer[];
  animation: AnimationState;
  selectedLayerIds: Array<string | number>;
  primaryLayerId: string | number | null;
  progress: number;
  worldPerPixel: number;
}) {
  if (!visible || !origin) return null;
  return selectedLayerIds.map((id) => {
    const layer = layers.find((candidate) => String(candidate.id) === String(id));
    if (!layer) return null;
    const samples = sampleMotionPath(layer, animation.blocks, animation.duration, 40);
    if (samples.length < 2) return null;
    // Like After Effects, the path runs through the shape itself (its center),
    // not through the artboard corner that translate offsets are measured from.
    const box = layer.type !== "group" && layer.from ? getPathDataBounds(layer.from) : null;
    const anchor = box ? { x: box.x + box.w / 2, y: box.y + box.h / 2 } : { x: 0, y: 0 };
    const at = { x: origin.x + anchor.x, y: origin.y + anchor.y };
    const points = samples;
    const primary = String(id) === String(primaryLayerId);
    const currentTime = progress * animation.duration;
    const current = {
      x:
        at.x + numberAtTime(layer, animation.blocks, "translateX", currentTime, animation.duration),
      y:
        at.y + numberAtTime(layer, animation.blocks, "translateY", currentTime, animation.duration),
    };
    return (
      <g key={`motion-${id}`} pointerEvents="none">
        <polyline
          points={points.map((point) => `${at.x + point.x},${at.y + point.y}`).join(" ")}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={primary ? 1.25 : 1}
          strokeDasharray={`${worldPerPixel * 4} ${worldPerPixel * 3}`}
          opacity={primary ? 0.75 : 0.4}
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx={current.x}
          cy={current.y}
          r={worldPerPixel * (primary ? 3.5 : 2.5)}
          fill="var(--primary)"
          opacity={primary ? 0.9 : 0.5}
        />
        {primary &&
          motionKeyframeTimes(layer, animation).map((time) => (
            <MotionKeyframeHandle
              key={time}
              layerId={layer.id}
              time={time}
              duration={animation.duration}
              position={{
                x: numberAtTime(layer, animation.blocks, "translateX", time, animation.duration),
                y: numberAtTime(layer, animation.blocks, "translateY", time, animation.duration),
              }}
              origin={at}
              axes={{
                x: hasTrack(animation, layer.id, "translateX"),
                y: hasTrack(animation, layer.id, "translateY"),
              }}
              worldPerPixel={worldPerPixel}
            />
          ))}
      </g>
    );
  });
}

const hasTrack = (animation: AnimationState, layerId: string | number, property: string) =>
  animation.blocks.some(
    (block) => String(block.layerId) === String(layerId) && block.propertyName === property,
  );

/** Every time where the layer's position has a keyframe, in order. */
function motionKeyframeTimes(layer: Layer, animation: AnimationState) {
  const times = new Set<number>();
  for (const block of animation.blocks) {
    if (String(block.layerId) !== String(layer.id)) continue;
    if (block.propertyName !== "translateX" && block.propertyName !== "translateY") continue;
    times.add(block.startTime);
    times.add(block.endTime);
  }
  return [...times].sort((a, b) => a - b);
}

/**
 * A position keyframe on the motion path, dragged like After Effects: pressing it
 * moves the playhead there, dragging rewrites that keyframe, and one drag is one undo.
 */
function MotionKeyframeHandle({
  layerId,
  time,
  duration,
  position,
  origin,
  axes,
  worldPerPixel,
}: {
  layerId: string | number;
  time: number;
  duration: number;
  position: Point;
  origin: Point;
  axes: { x: boolean; y: boolean };
  worldPerPixel: number;
}) {
  const drag = useRef<{ pointerId: number; clientX: number; clientY: number; start: Point } | null>(
    null,
  );
  const size = worldPerPixel * 7;
  const round = (value: number) => Math.round(value * 100) / 100;
  const finish = () => {
    if (!drag.current) return;
    drag.current = null;
    useEditorStore.getState().endHistoryGesture();
  };
  return (
    <rect
      data-motion-keyframe={time}
      x={origin.x + position.x - size / 2}
      y={origin.y + position.y - size / 2}
      width={size}
      height={size}
      rx={worldPerPixel * 1.5}
      transform={`rotate(45 ${origin.x + position.x} ${origin.y + position.y})`}
      fill="var(--background)"
      stroke="var(--primary)"
      strokeWidth={1.5}
      vectorEffect="non-scaling-stroke"
      pointerEvents="all"
      style={{ cursor: "move", touchAction: "none" }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const store = useEditorStore.getState();
        store.setProgress(time / Math.max(1, duration));
        store.beginHistoryGesture();
        drag.current = {
          pointerId: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
          start: position,
        };
      }}
      onPointerMove={(event) => {
        const active = drag.current;
        if (!active || active.pointerId !== event.pointerId) return;
        event.stopPropagation();
        const dx = (event.clientX - active.clientX) * worldPerPixel;
        const dy = (event.clientY - active.clientY) * worldPerPixel;
        useEditorStore.getState().setPropertiesAtPlayhead(
          layerId,
          {
            ...(axes.x && { translateX: round(active.start.x + dx) }),
            ...(axes.y && { translateY: round(active.start.y + dy) }),
          },
          { time },
        );
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
        finish();
      }}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
    >
      <title>{`Position keyframe at ${round(time)} ms · drag to move it`}</title>
    </rect>
  );
}

export function WorldBezierHandles({
  path,
  origin,
  worldMatrix,
  worldPerPixel,
}: {
  path: PathData;
  origin: Point;
  worldMatrix?: AffineMatrix | null;
  worldPerPixel: number;
}) {
  const segments: Array<[Point, Point, string]> = [];
  for (let subpathIndex = 0; subpathIndex < path.subPaths.length; subpathIndex++) {
    const commands = path.subPaths[subpathIndex].commands;
    let current: Point | null = null;
    let subpathStart: Point | null = null;
    for (let commandIndex = 0; commandIndex < commands.length; commandIndex++) {
      const command = commands[commandIndex];
      if (command.type === "M") {
        current = command.points[0];
        subpathStart = command.points[0];
      } else if (command.type === "L") {
        current = command.points[0];
      } else if (command.type === "C") {
        const [control1, control2, end] = command.points;
        if (current) segments.push([current, control1, `c-${subpathIndex}-${commandIndex}-1`]);
        if (end) segments.push([end, control2, `c-${subpathIndex}-${commandIndex}-2`]);
        current = end ?? current;
      } else if (command.type === "Q") {
        const [control, end] = command.points;
        if (current) segments.push([current, control, `q-${subpathIndex}-${commandIndex}-1`]);
        if (end) segments.push([end, control, `q-${subpathIndex}-${commandIndex}-2`]);
        current = end ?? current;
      } else if (command.type === "Z") {
        current = subpathStart;
      }
    }
  }
  return (
    <g pointerEvents="none">
      {segments.map(([anchor, control, key]) => {
        const transformedAnchor = worldMatrix
          ? transformPointWithMatrix(anchor, worldMatrix)
          : anchor;
        const transformedControl = worldMatrix
          ? transformPointWithMatrix(control, worldMatrix)
          : control;
        return (
          <line
            key={key}
            x1={origin.x + transformedAnchor.x}
            y1={origin.y + transformedAnchor.y}
            x2={origin.x + transformedControl.x}
            y2={origin.y + transformedControl.y}
            stroke="var(--primary)"
            strokeOpacity={0.5}
            strokeWidth={worldPerPixel}
          />
        );
      })}
    </g>
  );
}

export function WorldPenPreview({
  path,
  activeSubpath,
  preview,
  origin,
  worldMatrix,
  snapStep,
  worldPerPixel,
  anchorRadius,
}: {
  path: PathData;
  activeSubpath: number;
  preview: Point | null;
  origin: Point;
  worldMatrix?: AffineMatrix | null;
  snapStep: number;
  worldPerPixel: number;
  anchorRadius: number;
}) {
  const subpath = path.subPaths[activeSubpath];
  const lastCommand = subpath?.commands[subpath.commands.length - 1];
  const lastAnchor = lastCommand?.points[lastCommand.points.length - 1];
  const first = subpath?.commands[0]?.points[0];
  if (!subpath || !lastAnchor || !first) return null;
  const pointInWorld = (point: Point) => {
    const transformed = worldMatrix ? transformPointWithMatrix(point, worldMatrix) : point;
    return { x: origin.x + transformed.x, y: origin.y + transformed.y };
  };
  const lastAnchorWorld = pointInWorld(lastAnchor);
  const firstWorld = pointInWorld(first);
  const previewWorld = preview ? pointInWorld(preview) : null;
  const closeTolerance = Math.max(snapStep * 1.5, worldPerPixel * 6);
  const willClose =
    subpath.commands.length > 1 &&
    preview != null &&
    Math.hypot(preview.x - first.x, preview.y - first.y) <= closeTolerance;

  return (
    <g pointerEvents="none">
      {preview && (
        <>
          <line
            x1={lastAnchorWorld.x}
            y1={lastAnchorWorld.y}
            x2={previewWorld!.x}
            y2={previewWorld!.y}
            stroke="var(--primary)"
            strokeOpacity={0.7}
            strokeWidth={worldPerPixel}
            strokeDasharray={`${worldPerPixel * 2} ${worldPerPixel * 2}`}
          />
          <circle
            cx={previewWorld!.x}
            cy={previewWorld!.y}
            r={anchorRadius * 0.9}
            fill={willClose ? "var(--primary)" : "#ffffff"}
            stroke="var(--primary)"
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
          />
        </>
      )}
      {subpath.commands.length > 1 && (
        <circle
          cx={firstWorld.x}
          cy={firstWorld.y}
          r={willClose ? anchorRadius * 1.7 : anchorRadius * 1.3}
          fill="none"
          stroke="var(--primary)"
          strokeOpacity={willClose ? 1 : 0.5}
          strokeWidth={willClose ? 1.5 : 1}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </g>
  );
}

export function WorldPaintPreview({
  path,
  origin,
  worldMatrix,
  frameBounds,
  color,
  fillAlpha,
  worldPerPixel,
}: {
  path?: PathData | null;
  origin?: Point | null;
  worldMatrix?: AffineMatrix | null;
  frameBounds?: Rect | null;
  color: string;
  fillAlpha: number;
  worldPerPixel: number;
}) {
  if (path && origin) {
    return (
      <g
        transform={`translate(${origin.x} ${origin.y}) ${worldMatrix ? matrixToSvg(worldMatrix) : ""}`}
        pointerEvents="none"
      >
        <path
          d={pathToString(path)}
          fill={color}
          fillOpacity={Math.max(0.25, Math.min(0.65, fillAlpha * 0.7))}
          stroke="var(--primary)"
          strokeWidth={worldPerPixel * 1.5}
          strokeDasharray={`${worldPerPixel * 3} ${worldPerPixel * 1.5}`}
          vectorEffect="non-scaling-stroke"
          opacity={0.85}
        />
      </g>
    );
  }
  if (!frameBounds) return null;
  return (
    <rect
      x={frameBounds.x}
      y={frameBounds.y}
      width={frameBounds.w}
      height={frameBounds.h}
      fill={color}
      fillOpacity={0.4}
      stroke="var(--primary)"
      strokeWidth={worldPerPixel * 1.5}
      strokeDasharray={`${worldPerPixel * 3} ${worldPerPixel * 1.5}`}
      rx={Math.max(0.5, frameBounds.w * 0.015)}
      pointerEvents="none"
    />
  );
}

export function WorldVectorNetwork({
  path,
  origin,
  translation,
  worldMatrix,
  selectedPoints,
  anchorRadius,
  worldPerPixel,
  ownerId,
  layerId,
  side,
  interactive,
  viewport,
}: {
  path: PathData;
  origin: Point;
  translation: Point;
  worldMatrix?: AffineMatrix | null;
  selectedPoints: Selection[];
  anchorRadius: number;
  worldPerPixel: number;
  ownerId: string;
  layerId: string | number;
  side: "from" | "to";
  interactive: boolean;
  viewport: Rect;
}) {
  const highlight = usePathPointHighlight((state) => state.highlight);
  const show = usePathPointHighlight((state) => state.show);
  const clear = usePathPointHighlight((state) => state.clear);
  const topology = path.subPaths
    .map((sub) => sub.commands.map((cmd) => `${cmd.type}:${cmd.points.length}`).join(","))
    .join("|");
  useEffect(() => {
    clear();
    return () => clear();
  }, [clear, ownerId, layerId, side, topology]);
  const active =
    highlight &&
    highlight.ownerId === ownerId &&
    String(highlight.layerId) === String(layerId) &&
    highlight.side === side
      ? highlight
      : null;
  if (!interactive && !active) return null;
  const transform = worldMatrix
    ? `translate(${origin.x} ${origin.y}) ${matrixToSvg(worldMatrix)}`
    : `translate(${origin.x + translation.x} ${origin.y + translation.y})`;
  const toWorld = (point: Point) => {
    const transformed = worldMatrix
      ? transformPointWithMatrix(point, worldMatrix)
      : { x: translation.x + point.x, y: translation.y + point.y };
    return { x: origin.x + transformed.x, y: origin.y + transformed.y };
  };
  const edge =
    active?.kind === "edge"
      ? edgePresentation(path, active.subPathIndex, active.commandIndex)
      : null;
  const address =
    active?.kind === "point"
      ? active.point
      : !active && interactive && selectedPoints.length === 1
        ? selectedPoints[0]
        : null;
  const presentation = address ? pointPresentation(path, address) : null;
  const labelPoint = address
    ? path.subPaths[address.subPathIndex]?.commands[address.commandIndex]?.points[
        address.pointIndex
      ]
    : null;
  const normalized = {
    subPaths: path.subPaths.map((sub) => ({
      ...sub,
      commands: materializeSmoothCommands(sub.commands),
    })),
  };
  const segments = getSegmentTargets(normalized);
  path.subPaths.forEach((sub, subPathIndex) => {
    const commandIndex = sub.commands.length - 1;
    const command = sub.commands[commandIndex];
    const start = sub.commands[commandIndex - 1]?.points.at(-1);
    const end = sub.commands[0]?.points[0];
    if (command?.type === "Z" && start && end)
      segments.push({
        subPathIndex,
        commandIndex,
        command,
        start,
        end,
        d: `M${start.x} ${start.y} L${end.x} ${end.y}`,
        midpoint: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
      });
  });
  const selectedEdge =
    active?.kind === "edge"
      ? segments.find(
          (segment) =>
            segment.subPathIndex === active.subPathIndex &&
            segment.commandIndex === active.commandIndex,
        )
      : null;
  const pointLabel = presentation?.label ?? edge?.label;
  const label =
    pointLabel && path.subPaths.length > 1
      ? `${pointLabel} · Shape ${address?.subPathIndex != null ? address.subPathIndex + 1 : active?.kind === "edge" ? active.subPathIndex + 1 : 1}`
      : pointLabel;
  const labelPosition = labelPoint
    ? toWorld(labelPoint)
    : selectedEdge
      ? toWorld(selectedEdge.midpoint)
      : null;
  const labelWidth = label ? (label.length * 6 + 16) * worldPerPixel : 0;
  const labelOrigin = labelPosition
    ? {
        x: Math.max(
          viewport.x + 4 * worldPerPixel,
          Math.min(
            labelPosition.x + 9 * worldPerPixel,
            viewport.x + viewport.w - labelWidth - 4 * worldPerPixel,
          ),
        ),
        y: Math.max(
          viewport.y + 4 * worldPerPixel,
          Math.min(
            labelPosition.y - 29 * worldPerPixel < viewport.y + 4 * worldPerPixel
              ? labelPosition.y + 9 * worldPerPixel
              : labelPosition.y - 29 * worldPerPixel,
            viewport.y + viewport.h - 26 * worldPerPixel,
          ),
        ),
      }
    : null;
  const samePoint = (a: PointAddress | null | undefined, b: PointAddress) =>
    a?.subPathIndex === b.subPathIndex &&
    a.commandIndex === b.commandIndex &&
    a.pointIndex === b.pointIndex;
  return (
    <g
      pointerEvents="none"
      data-path-network="true"
      onPointerLeave={() => clear("canvas")}
      onPointerDown={() => clear()}
    >
      {interactive && (
        <path
          d={pathToString(path)}
          transform={transform}
          fill="none"
          stroke="var(--primary)"
          strokeOpacity={0.35}
          strokeWidth={1.25}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {segments.map((segment) => {
        const focused = selectedEdge === segment;
        if (!interactive && !focused) return null;
        return (
          <g key={`edge-${segment.subPathIndex}-${segment.commandIndex}`}>
            {focused && (
              <path
                d={segment.d}
                transform={transform}
                fill="none"
                stroke="var(--primary)"
                strokeOpacity={0.9}
                strokeWidth={3}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            )}
            <path
              data-path-edge={`${segment.subPathIndex}:${segment.commandIndex}`}
              d={segment.d}
              transform={transform}
              fill="none"
              stroke="var(--primary)"
              strokeOpacity={0}
              strokeWidth={12}
              vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: interactive ? "stroke" : "none" }}
              onPointerEnter={(event) => {
                if (event.pointerType !== "touch" && !event.buttons)
                  show({
                    ownerId,
                    layerId,
                    side,
                    source: "canvas",
                    kind: "edge",
                    subPathIndex: segment.subPathIndex,
                    commandIndex: segment.commandIndex,
                  });
              }}
              onPointerMove={(event) => {
                if (event.pointerType !== "touch" && !event.buttons)
                  show({
                    ownerId,
                    layerId,
                    side,
                    source: "canvas",
                    kind: "edge",
                    subPathIndex: segment.subPathIndex,
                    commandIndex: segment.commandIndex,
                  });
              }}
            />
          </g>
        );
      })}
      {path.subPaths.flatMap((sub, subPathIndex) =>
        sub.commands.flatMap((command, commandIndex) =>
          command.points.map((point, pointIndex) => {
            const location = { subPathIndex, commandIndex, pointIndex };
            const focused =
              samePoint(address, location) ||
              samePoint(edge?.start, location) ||
              samePoint(edge?.end, location);
            if (!interactive && !focused) return null;
            const selected = selectedPoints.some((item) => samePoint(item, location));
            const anchor = pointIndex === command.points.length - 1;
            const position = toWorld(point);
            const radius = anchorRadius * (anchor ? 1 : 0.75);
            const props = {
              fill: selected || focused ? "var(--primary)" : "#ffffff",
              stroke: "var(--primary)",
              strokeWidth: focused ? 2.5 : 1.5,
              vectorEffect: "non-scaling-stroke" as const,
              style: {
                cursor: "grab",
                pointerEvents: interactive ? ("auto" as const) : ("none" as const),
              },
              "data-path-address": `${subPathIndex}:${commandIndex}:${pointIndex}`,
              "data-highlighted": focused || undefined,
              onPointerEnter: (event: ReactPointerEvent<SVGElement>) => {
                if (event.pointerType !== "touch" && !event.buttons)
                  show({
                    ownerId,
                    layerId,
                    side,
                    source: "canvas",
                    kind: "point",
                    point: location,
                  });
              },
              onPointerMove: (event: ReactPointerEvent<SVGElement>) => {
                if (event.pointerType !== "touch" && !event.buttons)
                  show({
                    ownerId,
                    layerId,
                    side,
                    source: "canvas",
                    kind: "point",
                    point: location,
                  });
              },
            };
            return (
              <g key={`${subPathIndex}-${commandIndex}-${pointIndex}`}>
                {focused && (
                  <circle
                    cx={position.x}
                    cy={position.y}
                    r={radius + 3 * worldPerPixel}
                    fill="var(--primary)"
                    fillOpacity={0.13}
                  />
                )}
                {anchor ? (
                  <rect
                    {...props}
                    x={position.x - radius}
                    y={position.y - radius}
                    width={radius * 2}
                    height={radius * 2}
                    rx={radius * 0.15}
                  />
                ) : (
                  <circle {...props} cx={position.x} cy={position.y} r={radius} />
                )}
              </g>
            );
          }),
        ),
      )}
      {label && labelOrigin && (
        <g data-path-point-label="true" transform={`translate(${labelOrigin.x} ${labelOrigin.y})`}>
          <rect
            width={labelWidth}
            height={22 * worldPerPixel}
            rx={5 * worldPerPixel}
            fill="var(--popover)"
            stroke="var(--border)"
            strokeWidth={worldPerPixel}
          />
          <text
            x={8 * worldPerPixel}
            y={11 * worldPerPixel}
            dominantBaseline="central"
            fontSize={11 * worldPerPixel}
            fill="var(--popover-foreground)"
          >
            {label}
          </text>
        </g>
      )}
    </g>
  );
}

export function WorldFreehandLasso({ points }: { points: Point[] }) {
  if (points.length < 2) return null;
  return (
    <polyline
      points={points.map((point) => `${point.x},${point.y}`).join(" ")}
      fill="none"
      stroke="var(--primary)"
      strokeWidth={1.2}
      strokeDasharray="3 2"
      opacity={0.9}
      vectorEffect="non-scaling-stroke"
      pointerEvents="none"
    />
  );
}

export function WorldMarqueeOverlay({ start, current }: { start: Point; current: Point }) {
  return (
    <rect
      x={Math.min(start.x, current.x)}
      y={Math.min(start.y, current.y)}
      width={Math.abs(current.x - start.x)}
      height={Math.abs(current.y - start.y)}
      fill="var(--primary)"
      fillOpacity={0.08}
      stroke="var(--primary)"
      strokeWidth={1}
      strokeDasharray="4 3"
      vectorEffect="non-scaling-stroke"
      pointerEvents="none"
    />
  );
}

export function WorldFrameResizeHandles({
  bounds,
  worldPerPixel,
  touch = false,
  onResizeStart,
}: {
  bounds: Rect;
  worldPerPixel: number;
  touch?: boolean;
  onResizeStart: (event: ReactPointerEvent<SVGRectElement>, handle: FrameResizeHandle) => void;
}) {
  const size = worldPerPixel * 3;
  const hitSize = worldPerPixel * (touch ? 22 : 10);
  const handles: Array<{ handle: FrameResizeHandle; x: number; y: number; cursor: string }> = [
    { handle: "nw", x: bounds.x, y: bounds.y, cursor: "nwse-resize" },
    { handle: "n", x: bounds.x + bounds.w / 2, y: bounds.y, cursor: "ns-resize" },
    { handle: "ne", x: bounds.x + bounds.w, y: bounds.y, cursor: "nesw-resize" },
    { handle: "se", x: bounds.x + bounds.w, y: bounds.y + bounds.h, cursor: "nwse-resize" },
    { handle: "e", x: bounds.x + bounds.w, y: bounds.y + bounds.h / 2, cursor: "ew-resize" },
    { handle: "s", x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h, cursor: "ns-resize" },
    { handle: "sw", x: bounds.x, y: bounds.y + bounds.h, cursor: "nesw-resize" },
    { handle: "w", x: bounds.x, y: bounds.y + bounds.h / 2, cursor: "ew-resize" },
  ];
  const edges = [
    {
      handle: "n" as const,
      x: bounds.x,
      y: bounds.y - hitSize / 2,
      w: bounds.w,
      h: hitSize,
      cursor: "ns-resize",
    },
    {
      handle: "s" as const,
      x: bounds.x,
      y: bounds.y + bounds.h - hitSize / 2,
      w: bounds.w,
      h: hitSize,
      cursor: "ns-resize",
    },
    {
      handle: "w" as const,
      x: bounds.x - hitSize / 2,
      y: bounds.y,
      w: hitSize,
      h: bounds.h,
      cursor: "ew-resize",
    },
    {
      handle: "e" as const,
      x: bounds.x + bounds.w - hitSize / 2,
      y: bounds.y,
      w: hitSize,
      h: bounds.h,
      cursor: "ew-resize",
    },
  ];
  return (
    <g className="touch-none">
      {edges.map(({ handle, x, y, w, h, cursor }) => (
        <rect
          key={`edge-${handle}`}
          data-frame-resize-edge={handle}
          x={x}
          y={y}
          width={w}
          height={h}
          fill="transparent"
          style={{ cursor }}
          onPointerDown={(event) => onResizeStart(event, handle)}
        />
      ))}
      {handles.map(({ handle, x, y, cursor }) => (
        <g key={handle}>
          <rect
            data-frame-resize-handle={handle}
            aria-label={`Resize frame ${handle}`}
            x={x - hitSize}
            y={y - hitSize}
            width={hitSize * 2}
            height={hitSize * 2}
            fill="transparent"
            style={{ cursor }}
            onPointerDown={(event) => onResizeStart(event, handle)}
          />
          <rect
            x={x - size}
            y={y - size}
            width={size * 2}
            height={size * 2}
            rx={worldPerPixel}
            fill="#ffffff"
            stroke="var(--primary)"
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        </g>
      ))}
    </g>
  );
}
