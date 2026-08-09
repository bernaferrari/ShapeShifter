"use client";

import { useCallback, useRef, useState } from "react";
import { collectOwnedLayersInRect, type SceneOwner } from "@/lib/shapeshifter/scene/selection";
import { useEditorStore, type CanvasFrame, type LayerSelectionRef } from "@/lib/store/editorStore";
import { getCanvasFrameBounds } from "./useWorldCamera";

export interface WorldMarquee {
  start: { x: number; y: number };
  current: { x: number; y: number };
  scope: "frames" | "layers";
  frameId?: string;
}

interface WorldMarqueeOptions {
  frames: CanvasFrame[];
  sceneOwners: SceneOwner[];
  selectedFrameId: string;
  selectedFrameIds: string[];
  selectedLayerRefs: LayerSelectionRef[];
  worldPerPixel: number;
  setWorldSelectedIds: (ids: string[]) => void;
}

export function useWorldMarquee({
  frames,
  sceneOwners,
  selectedFrameId,
  selectedFrameIds,
  selectedLayerRefs,
  worldPerPixel,
  setWorldSelectedIds,
}: WorldMarqueeOptions) {
  const [marquee, setMarquee] = useState<WorldMarquee | null>(null);
  const marqueeRef = useRef<WorldMarquee | null>(null);
  const frameBaseRef = useRef<string[]>([]);
  const layerBaseRef = useRef<LayerSelectionRef[]>([]);

  const beginLayers = useCallback(
    (point: { x: number; y: number }, frameId: string, additive: boolean) => {
      if (!additive) setWorldSelectedIds([frameId]);
      frameBaseRef.current = [];
      layerBaseRef.current = additive ? selectedLayerRefs : [];
      const next: WorldMarquee = {
        start: point,
        current: point,
        scope: "layers",
        frameId,
      };
      marqueeRef.current = next;
      setMarquee(next);
    },
    [selectedLayerRefs, setWorldSelectedIds],
  );

  const beginFrames = useCallback(
    (point: { x: number; y: number }, additive: boolean) => {
      frameBaseRef.current = additive ? selectedFrameIds : [];
      layerBaseRef.current = [];
      if (!additive) {
        setWorldSelectedIds([]);
        useEditorStore.getState().deselectAll();
      }
      const next: WorldMarquee = { start: point, current: point, scope: "frames" };
      marqueeRef.current = next;
      setMarquee(next);
    },
    [selectedFrameIds, setWorldSelectedIds],
  );

  const update = useCallback(
    (point: { x: number; y: number }) => {
      const active = marqueeRef.current;
      if (!active) return false;
      const minX = Math.min(active.start.x, point.x);
      const maxX = Math.max(active.start.x, point.x);
      const minY = Math.min(active.start.y, point.y);
      const maxY = Math.max(active.start.y, point.y);
      const distance = Math.hypot(point.x - active.start.x, point.y - active.start.y);
      const next = { ...active, current: point };
      marqueeRef.current = next;
      setMarquee(next);

      if (active.scope === "layers" && active.frameId) {
        if (distance < worldPerPixel * 4) return true;
        const hits = collectOwnedLayersInRect(sceneOwners, {
          x: minX,
          y: minY,
          w: maxX - minX,
          h: maxY - minY,
        });
        const byKey = new Map<string, LayerSelectionRef>();
        for (const reference of [...layerBaseRef.current, ...hits]) {
          byKey.set(`${reference.ownerId}:${String(reference.layerId)}`, reference);
        }
        const selected = [...byKey.values()];
        if (selected.length) useEditorStore.getState().selectLayerRefs(selected);
        else {
          useEditorStore.getState().selectFrame(active.frameId);
          setWorldSelectedIds([active.frameId]);
        }
        return true;
      }

      const hits = frames
        .filter((frame) => {
          const bounds = getCanvasFrameBounds(frame);
          return !(
            bounds.x + bounds.w < minX ||
            bounds.x > maxX ||
            bounds.y + bounds.h < minY ||
            bounds.y > maxY
          );
        })
        .map((frame) => frame.id);
      const selected = Array.from(new Set([...frameBaseRef.current, ...hits]));
      setWorldSelectedIds(selected);
      if (hits.length) {
        const primary = hits.includes(selectedFrameId) ? selectedFrameId : hits.at(-1)!;
        useEditorStore.getState().selectFrames(selected, primary);
      }
      return true;
    },
    [frames, sceneOwners, selectedFrameId, setWorldSelectedIds, worldPerPixel],
  );

  const finish = useCallback(() => {
    const active = marqueeRef.current;
    if (!active) return false;
    const distance = Math.hypot(
      active.current.x - active.start.x,
      active.current.y - active.start.y,
    );
    if (distance < worldPerPixel * 4 && active.scope === "layers" && active.frameId) {
      useEditorStore.getState().selectFrame(active.frameId);
      setWorldSelectedIds([active.frameId]);
    }
    marqueeRef.current = null;
    setMarquee(null);
    return true;
  }, [setWorldSelectedIds, worldPerPixel]);

  const cancel = useCallback(() => {
    marqueeRef.current = null;
    setMarquee(null);
  }, []);

  return { marquee, beginLayers, beginFrames, update, finish, cancel };
}
