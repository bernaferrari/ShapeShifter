"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { collectPointsInLasso, pointInPolygon } from "@/lib/shapeshifter/gestures/HitTests";
import type { PathData, Point } from "@/lib/shapeshifter/types";
import { useEditorStore, type CanvasFrame } from "@/lib/store/editorStore";
import { getCanvasFrameBounds } from "./useWorldCamera";

interface WorldLassoOptions {
  editPath: PathData | null;
  editOrigin: Point | null;
  editLayerTranslation: Point;
  selectedLayerId: string | number;
  editingSide: "from" | "to";
  frames: CanvasFrame[];
  selectedFrameIds: string[];
}

export function useWorldLasso({
  editPath,
  editOrigin,
  editLayerTranslation,
  selectedLayerId,
  editingSide,
  frames,
  selectedFrameIds,
}: WorldLassoOptions) {
  const pointsRef = useRef<Point[]>([]);
  const rafRef = useRef<number | null>(null);
  const [, render] = useState(0);

  const refresh = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      render((value) => (value + 1) % 10_000);
      rafRef.current = null;
    });
  }, []);

  const cancel = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    pointsRef.current = [];
    render(0);
  }, []);

  useEffect(() => cancel, [cancel]);

  const begin = useCallback((point: Point) => {
    pointsRef.current = [point];
    render((value) => (value + 1) % 10_000);
  }, []);

  const update = useCallback(
    (point: Point) => {
      const points = pointsRef.current;
      if (!points.length) return false;
      const previous = points.at(-1)!;
      if (Math.hypot(point.x - previous.x, point.y - previous.y) > 0.5) {
        points.push(point);
        if (points.length > 4 && Math.hypot(point.x - points[0].x, point.y - points[0].y) < 2.5) {
          points[points.length - 1] = { ...points[0] };
        }
      }
      if (points.length > 200) points.shift();
      refresh();
      return true;
    },
    [refresh],
  );

  const finish = useCallback(
    (additive: boolean) => {
      const points = pointsRef.current;
      if (points.length < 3) {
        cancel();
        return false;
      }
      const store = useEditorStore.getState();
      if (editPath && editOrigin) {
        const localPolygon = points.map((point) => ({
          x: point.x - editOrigin.x - editLayerTranslation.x,
          y: point.y - editOrigin.y - editLayerTranslation.y,
        }));
        const hits = collectPointsInLasso(editPath, localPolygon, {
          tolerance: 0.6,
          sampleCurves: true,
        });
        if (hits.length) {
          if (!additive) store.clearSelection();
          store.selectMultiplePoints(
            hits.map((hit) => ({ layerId: selectedLayerId, side: editingSide, ...hit })),
          );
        } else if (!additive) {
          store.clearSelection();
        }
      } else {
        const hitIds = frames
          .filter((frame) => {
            const bounds = getCanvasFrameBounds(frame);
            return pointInPolygon(
              { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 },
              points,
            );
          })
          .map((frame) => frame.id);
        if (hitIds.length) {
          const next = additive ? Array.from(new Set([...selectedFrameIds, ...hitIds])) : hitIds;
          store.selectFrames(next, next.at(-1));
        } else if (!additive) {
          store.deselectAll();
        }
      }
      cancel();
      return true;
    },
    [
      cancel,
      editLayerTranslation.x,
      editLayerTranslation.y,
      editOrigin,
      editPath,
      editingSide,
      frames,
      selectedFrameIds,
      selectedLayerId,
    ],
  );

  return { points: pointsRef.current, begin, update, finish, cancel };
}
