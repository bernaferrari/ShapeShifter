"use client";

import React from "react";
import type { PathData } from "@/lib/shapeshifter/types";

interface EditPathOverlayProps {
  pathData: PathData;
  selectedPoints?: Array<{ subPathIndex: number; commandIndex: number; pointIndex: number }>;
  showHandles?: boolean; // direct vs select mode
  onPointPointerDown?: (
    subPathIndex: number,
    commandIndex: number,
    pointIndex: number,
    e: React.PointerEvent,
  ) => void;
  onHandlePointerDown?: (
    subPathIndex: number,
    commandIndex: number,
    isIn: boolean,
    e: React.PointerEvent,
  ) => void;
}

/**
 * Renders segment points, bezier handles, and handle lines for direct/edit-path mode.
 * Port of original EditPathRaster + handle rendering in PaperLayer.
 *
 * This is the second major overlay of Phase 2.
 */
export const EditPathOverlay: React.FC<EditPathOverlayProps> = ({
  pathData,
  selectedPoints = [],
  showHandles = true,
  onPointPointerDown,
  onHandlePointerDown,
}) => {
  const isSelected = (si: number, ci: number, pi: number) =>
    selectedPoints.some(
      (s) => s.subPathIndex === si && s.commandIndex === ci && s.pointIndex === pi,
    );

  return (
    <g>
      {pathData.subPaths.map((subPath, subPathIndex) =>
        subPath.commands.map((command, commandIndex) => {
          if (command.type === "Z" || command.points.length === 0) return null;

          return (
            <g key={`${subPathIndex}-${commandIndex}`}>
              {/* Bezier handle lines and handles for cubic curves (C) */}
              {showHandles && command.type === "C" && command.points.length >= 3 && (
                <>
                  {/* In handle */}
                  <line
                    x1={command.points[0].x}
                    y1={command.points[0].y}
                    x2={command.points[1].x}
                    y2={command.points[1].y}
                    stroke="currentColor"
                    strokeOpacity={0.5}
                    strokeWidth={1}
                    strokeDasharray="1 1"
                    pointerEvents="none"
                  />
                  <circle
                    cx={command.points[1].x}
                    cy={command.points[1].y}
                    r={3}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1}
                    onPointerDown={(e) =>
                      onHandlePointerDown?.(subPathIndex, commandIndex, true, e)
                    }
                    style={{ cursor: "move" }}
                  />

                  {/* Out handle */}
                  <line
                    x1={command.points[2].x}
                    y1={command.points[2].y}
                    x2={command.points[1].x}
                    y2={command.points[1].y}
                    stroke="currentColor"
                    strokeOpacity={0.5}
                    strokeWidth={1}
                    strokeDasharray="1 1"
                    pointerEvents="none"
                  />
                  <circle
                    cx={command.points[2].x}
                    cy={command.points[2].y}
                    r={3}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1}
                    onPointerDown={(e) =>
                      onHandlePointerDown?.(subPathIndex, commandIndex, false, e)
                    }
                    style={{ cursor: "move" }}
                  />
                </>
              )}

              {/* Actual segment points — reference-aligned crisp squares (wys / 3o7) */}
              {command.points.map((pt, pointIndex) => {
                const selected = isSelected(subPathIndex, commandIndex, pointIndex);
                const size = selected ? 7 : 5.5;
                const half = size / 2;
                return (
                  <rect
                    key={pointIndex}
                    x={pt.x - half}
                    y={pt.y - half}
                    width={size}
                    height={size}
                    rx={1}
                    fill={selected ? "currentColor" : "white"}
                    stroke="currentColor"
                    strokeWidth={selected ? 2 : 1.5}
                    onPointerDown={(e) =>
                      onPointPointerDown?.(subPathIndex, commandIndex, pointIndex, e)
                    }
                    style={{ cursor: "move" }}
                  />
                );
              })}
            </g>
          );
        }),
      )}
    </g>
  );
};
