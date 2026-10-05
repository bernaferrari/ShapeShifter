"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useEditorStore } from "@/lib/store/editorStore";
import {
  historySessionFromEditor,
  workspaceFromEditor,
  restoreHistoryEntry,
} from "@/lib/store/documentRuntime";
import { PAGE_ROOT_ID } from "@/lib/shapeshifter/scene/owners";
import {
  primitiveBounds,
  primitivePath,
  type PrimitiveShape,
} from "@/lib/shapeshifter/primitiveShapes";
import { snapValueToStep } from "@/lib/shapeshifter/camera";
import type { Point } from "@/lib/shapeshifter/types";
import { stageAgentCommands } from "@/lib/agent/commands";
import { isEditorShortcutBlocked } from "../hooks/useEditorKeyboardShortcuts";
import { beginLiveGesture, endLiveGesture, ownsLiveGesture } from "@/lib/store/liveGesture";

interface ShapeSession {
  kind: PrimitiveShape;
  ownerId: string;
  origin: Point;
  start: Point;
  bounds: ReturnType<typeof primitiveBounds>;
  marker: ReturnType<typeof beginLiveGesture>;
}
export function useWorldShapeDrawing({
  hitArtboard,
  snapStep,
  worldPerPixel,
}: {
  hitArtboard: (point: Point) => string | null;
  snapStep: number;
  worldPerPixel: number;
}) {
  const sessionRef = useRef<ShapeSession | null>(null);
  const [preview, setPreview] = useState<{
    d: string;
    origin: Point;
    width: number;
    height: number;
  } | null>(null);
  const cancel = useCallback(() => {
    endLiveGesture(sessionRef.current?.marker);
    sessionRef.current = null;
    setPreview(null);
  }, []);
  useEffect(() => cancel, [cancel]);
  const toolMode = useEditorStore((state) => state.toolMode);
  useEffect(() => {
    if (sessionRef.current && sessionRef.current.kind !== toolMode) cancel();
  }, [toolMode, cancel]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && sessionRef.current && !isEditorShortcutBlocked(event)) {
        event.preventDefault();
        cancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancel]);
  const start = useCallback(
    (point: Point, bypassSnap: boolean) => {
      cancel();
      const state = useEditorStore.getState();
      if (state.toolMode !== "rectangle" && state.toolMode !== "ellipse") return false;
      const ownerId = hitArtboard(point) ?? PAGE_ROOT_ID;
      const frame = state.frames.find((candidate) => candidate.id === ownerId);
      const origin = { x: frame?.x ?? 0, y: frame?.y ?? 0 };
      const local = { x: point.x - origin.x, y: point.y - origin.y };
      if (state.snapToGrid && !bypassSnap) {
        local.x = snapValueToStep(local.x, snapStep);
        local.y = snapValueToStep(local.y, snapStep);
      }
      sessionRef.current = {
        kind: state.toolMode,
        ownerId,
        origin,
        start: local,
        bounds: primitiveBounds(local, local),
        marker: beginLiveGesture("world-shape", point),
      };
      useEditorStore.setState({ isPlaying: false });
      return true;
    },
    [cancel, hitArtboard, snapStep],
  );
  const update = useCallback(
    (point: Point, modifiers: { shift: boolean; alt: boolean; bypassSnap: boolean }) => {
      const session = sessionRef.current;
      if (!session) return false;
      if (!ownsLiveGesture(session.marker)) {
        cancel();
        return false;
      }
      const local = { x: point.x - session.origin.x, y: point.y - session.origin.y };
      if (useEditorStore.getState().snapToGrid && !modifiers.bypassSnap) {
        local.x = snapValueToStep(local.x, snapStep);
        local.y = snapValueToStep(local.y, snapStep);
      }
      session.bounds = primitiveBounds(session.start, local, {
        square: modifiers.shift,
        centered: modifiers.alt,
      });
      setPreview({
        d: primitivePath(session.kind, session.bounds),
        origin: session.origin,
        width: session.bounds.w,
        height: session.bounds.h,
      });
      return true;
    },
    [cancel, snapStep],
  );
  const finish = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return false;
    const current = ownsLiveGesture(session.marker);
    cancel();
    if (!current) return true;
    if (session.bounds.w < worldPerPixel * 2 || session.bounds.h < worldPerPixel * 2) return true;
    const state = useEditorStore.getState();
    if (
      session.ownerId !== PAGE_ROOT_ID &&
      !state.frames.some((frame) => frame.id === session.ownerId)
    )
      return true;
    const staged = stageAgentCommands(workspaceFromEditor(state), [
      {
        type: "createPath",
        ownerId: session.ownerId,
        name: session.kind === "rectangle" ? "Rectangle" : "Ellipse",
        d: primitivePath(session.kind, session.bounds),
      },
    ]);
    state.pushHistory();
    useEditorStore.setState(
      restoreHistoryEntry(state, {
        document: staged.document,
        session: historySessionFromEditor(state),
      }),
    );
    useEditorStore.getState().selectLayerRefs(staged.created);
    useEditorStore.getState().setToolMode("select");
    return true;
  }, [cancel, worldPerPixel]);
  return { start, update, finish, cancel, preview };
}
