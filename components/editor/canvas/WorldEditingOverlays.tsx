import { pathToString } from "@/lib/shapeshifter/pathUtils";
import { numberAtTime, sampleMotionPath } from "@/lib/shapeshifter/playheadResolve";
import { matrixToSvg, transformPointWithMatrix, type AffineMatrix } from "@/lib/shapeshifter/scene/layerTransform";
import type { GuideLine } from "@/lib/shapeshifter/smartGuides";
import type { AnimationState, Layer, PathData, Selection } from "@/lib/shapeshifter/types";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { FrameResizeHandle } from "@/lib/shapeshifter/gestures/select/FrameResizeGesture";

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
    const points = sampleMotionPath(layer, animation.blocks, animation.duration, 40);
    if (points.length < 2) return null;
    const primary = String(id) === String(primaryLayerId);
    const currentTime = progress * animation.duration;
    const current = {
      x:
        origin.x +
        numberAtTime(layer, animation.blocks, "translateX", currentTime, animation.duration),
      y:
        origin.y +
        numberAtTime(layer, animation.blocks, "translateY", currentTime, animation.duration),
    };
    return (
      <g key={`motion-${id}`} pointerEvents="none">
        <polyline
          points={points.map((point) => `${origin.x + point.x},${origin.y + point.y}`).join(" ")}
          fill="none"
          stroke="#0d99ff"
          strokeWidth={primary ? 1.25 : 1}
          strokeDasharray={`${worldPerPixel * 4} ${worldPerPixel * 3}`}
          opacity={primary ? 0.75 : 0.4}
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx={current.x}
          cy={current.y}
          r={worldPerPixel * (primary ? 3.5 : 2.5)}
          fill="#0d99ff"
          opacity={primary ? 0.9 : 0.5}
        />
      </g>
    );
  });
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
        const transformedAnchor = worldMatrix ? transformPointWithMatrix(anchor, worldMatrix) : anchor;
        const transformedControl = worldMatrix ? transformPointWithMatrix(control, worldMatrix) : control;
        return <line
          key={key}
          x1={origin.x + transformedAnchor.x}
          y1={origin.y + transformedAnchor.y}
          x2={origin.x + transformedControl.x}
          y2={origin.y + transformedControl.y}
          stroke="#0d99ff"
          strokeOpacity={0.5}
          strokeWidth={worldPerPixel}
        />;
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
            stroke="#0d99ff"
            strokeOpacity={0.7}
            strokeWidth={worldPerPixel}
            strokeDasharray={`${worldPerPixel * 2} ${worldPerPixel * 2}`}
          />
          <circle
            cx={previewWorld!.x}
            cy={previewWorld!.y}
            r={anchorRadius * 0.9}
            fill={willClose ? "#0d99ff" : "#ffffff"}
            stroke="#0d99ff"
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
          stroke="#0d99ff"
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
      <g transform={`translate(${origin.x} ${origin.y}) ${worldMatrix ? matrixToSvg(worldMatrix) : ""}`} pointerEvents="none">
        <path
          d={pathToString(path)}
          fill={color}
          fillOpacity={Math.max(0.25, Math.min(0.65, fillAlpha * 0.7))}
          stroke="#0d99ff"
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
      stroke="#0d99ff"
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
}: {
  path: PathData;
  origin: Point;
  translation: Point;
  worldMatrix?: AffineMatrix | null;
  selectedPoints: Selection[];
  anchorRadius: number;
}) {
  const transform = worldMatrix
    ? `translate(${origin.x} ${origin.y}) ${matrixToSvg(worldMatrix)}`
    : `translate(${origin.x + translation.x} ${origin.y + translation.y})`;
  return (
    <g pointerEvents="none">
      <path
        d={pathToString(path)}
        transform={transform}
        fill="none"
        stroke="#0d99ff"
        strokeOpacity={0.35}
        strokeWidth={1.25}
        vectorEffect="non-scaling-stroke"
      />
      {path.subPaths.map((subpath, subpathIndex) =>
        subpath.commands.map((command, commandIndex) =>
          command.points.map((point, pointIndex) => {
            const transformed = worldMatrix
              ? transformPointWithMatrix(point, worldMatrix)
              : { x: translation.x + point.x, y: translation.y + point.y };
            const x = origin.x + transformed.x;
            const y = origin.y + transformed.y;
            const selected = selectedPoints.some(
              (selection) =>
                selection.subPathIndex === subpathIndex &&
                selection.commandIndex === commandIndex &&
                selection.pointIndex === pointIndex,
            );
            const anchor = pointIndex === command.points.length - 1;
            const radius = anchor ? anchorRadius : anchorRadius * 0.75;
            return anchor ? (
              <rect
                key={`anchor-${subpathIndex}-${commandIndex}-${pointIndex}`}
                x={x - radius}
                y={y - radius}
                width={radius * 2}
                height={radius * 2}
                rx={radius * 0.15}
                fill={selected ? "#0d99ff" : "#ffffff"}
                stroke="#0d99ff"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                style={{ cursor: "grab", pointerEvents: "auto" }}
              />
            ) : (
              <circle
                key={`handle-${subpathIndex}-${commandIndex}-${pointIndex}`}
                cx={x}
                cy={y}
                r={radius}
                fill={selected ? "#0d99ff" : "#ffffff"}
                stroke="#0d99ff"
                strokeWidth={1.25}
                vectorEffect="non-scaling-stroke"
                style={{ cursor: "grab", pointerEvents: "auto" }}
              />
            );
          }),
        ),
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
      stroke="#0d99ff"
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
      fill="#0d99ff"
      fillOpacity={0.08}
      stroke="#0d99ff"
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
  onResizeStart,
}: {
  bounds: Rect;
  worldPerPixel: number;
  onResizeStart: (event: ReactPointerEvent<SVGRectElement>, handle: FrameResizeHandle) => void;
}) {
  const size = worldPerPixel * 3;
  const handles: Array<{ handle: FrameResizeHandle; x: number; y: number; cursor: string }> = [
    { handle: "se", x: bounds.x + bounds.w, y: bounds.y + bounds.h, cursor: "nwse-resize" },
    { handle: "e", x: bounds.x + bounds.w, y: bounds.y + bounds.h / 2, cursor: "ew-resize" },
    { handle: "s", x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h, cursor: "ns-resize" },
  ];
  return (
    <g>
      {handles.map(({ handle, x, y, cursor }) => (
        <rect
          key={handle}
          x={x - size}
          y={y - size}
          width={size * 2}
          height={size * 2}
          rx={worldPerPixel}
          fill="#ffffff"
          stroke="#0d99ff"
          strokeWidth={1.25}
          vectorEffect="non-scaling-stroke"
          style={{ cursor }}
          onPointerDown={(event) => onResizeStart(event, handle)}
        />
      ))}
    </g>
  );
}
