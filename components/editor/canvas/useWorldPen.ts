"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { generateId } from "@/lib/shapeshifter/ids";
import type { Command, PathData } from "@/lib/shapeshifter/types";
import { useEditorStore } from "@/lib/store/editorStore";
import { beginLiveGesture, endLiveGesture, ownsLiveGesture } from "@/lib/store/liveGesture";

interface PenDragSession {
  subIdx: number;
  cmdIdx: number;
  anchorLocal: { x: number; y: number };
  isMove: boolean;
  c1: { x: number; y: number };
  pendingOutgoing: { x: number; y: number } | null;
  marker: ReturnType<typeof beginLiveGesture>;
  ownerId: string;
  layerId: string | number;
  historyEntry: ReturnType<typeof useEditorStore.getState>["history"][number] | undefined;
}
function penDragSession(
  data: Omit<PenDragSession, "marker" | "ownerId" | "layerId" | "historyEntry">,
): PenDragSession {
  const state = useEditorStore.getState();
  return {
    ...data,
    marker: beginLiveGesture("world-pen", data.anchorLocal),
    ownerId: state.selectedFrameId,
    layerId: state.selectedLayerId,
    historyEntry: state.history.at(-1),
  };
}

export function useWorldPen({
  path,
  snapStep,
  worldPerPixel,
  commit,
}: {
  path: PathData | null;
  snapStep: number;
  worldPerPixel: number;
  commit: (path: PathData, recordHistory?: boolean) => void;
}) {
  const activeSubpathRef = useRef<number | null>(null);
  const scopeRef = useRef<{
    ownerId: string;
    layerId: string | number;
    side: "from" | "to";
  } | null>(null);
  const finishedAtRef = useRef(0);
  const outgoingRef = useRef<{ x: number; y: number } | null>(null);
  const dragRef = useRef<PenDragSession | null>(null);
  const [preview, setPreview] = useState<{ x: number; y: number } | null>(null);

  const finish = useCallback(() => {
    if (activeSubpathRef.current != null) finishedAtRef.current = Date.now();
    endLiveGesture(dragRef.current?.marker);
    activeSubpathRef.current = null;
    scopeRef.current = null;
    outgoingRef.current = null;
    dragRef.current = null;
    setPreview(null);
  }, []);

  const pointerDown = useCallback(
    (local: { x: number; y: number }) => {
      if (!path) return;
      const nextPath: PathData = structuredClone(path);
      const active = activeSubpathRef.current;
      const closeTolerance = Math.max(snapStep * 1.5, worldPerPixel * 6);

      if (active != null && nextPath.subPaths[active]) {
        const subpath = nextPath.subPaths[active];
        const first = subpath.commands[0]?.points[0];
        if (
          subpath.commands.length > 1 &&
          first &&
          Math.hypot(local.x - first.x, local.y - first.y) <= closeTolerance
        ) {
          useEditorStore.getState().pushHistory();
          subpath.commands.push({ id: generateId(), type: "Z", points: [] } as Command);
          finish();
          commit(nextPath, false);
          useEditorStore.getState().setToolMode("select");
          return;
        }

        const lastCommand = subpath.commands[subpath.commands.length - 1];
        const lastAnchor = lastCommand?.points[lastCommand.points.length - 1];
        if (
          lastAnchor &&
          Math.hypot(local.x - lastAnchor.x, local.y - lastAnchor.y) <= closeTolerance
        ) {
          finish();
          useEditorStore.getState().setToolMode("select");
          return;
        }

        const previousAnchor = lastAnchor ?? local;
        const outgoing = outgoingRef.current;
        const c1 = outgoing ? { ...outgoing } : { ...previousAnchor };
        const command: Command = outgoing
          ? { id: generateId(), type: "C", points: [c1, { ...local }, { ...local }] }
          : { id: generateId(), type: "L", points: [{ ...local }] };
        useEditorStore.getState().pushHistory();
        subpath.commands.push(command);
        dragRef.current = penDragSession({
          subIdx: active,
          cmdIdx: subpath.commands.length - 1,
          anchorLocal: { ...local },
          isMove: false,
          c1,
          pendingOutgoing: null,
        });
        outgoingRef.current = null;
        commit(nextPath, false);
        return;
      }

      useEditorStore.getState().pushHistory();
      nextPath.subPaths.push({
        commands: [{ id: generateId(), type: "M", points: [{ ...local }] } as Command],
      });
      const subIdx = nextPath.subPaths.length - 1;
      const state = useEditorStore.getState();
      scopeRef.current = {
        ownerId: state.selectedFrameId,
        layerId: state.selectedLayerId,
        side: state.editingSide,
      };
      activeSubpathRef.current = subIdx;
      dragRef.current = penDragSession({
        subIdx,
        cmdIdx: 0,
        anchorLocal: { ...local },
        isMove: true,
        c1: { ...local },
        pendingOutgoing: null,
      });
      outgoingRef.current = null;
      commit(nextPath, false);
    },
    [commit, finish, path, snapStep, worldPerPixel],
  );

  const pointerDrag = useCallback(
    (local: { x: number; y: number }) => {
      const session = dragRef.current;
      if (!session || !path) return;
      const state = useEditorStore.getState();
      if (
        !ownsLiveGesture(session.marker) ||
        state.selectedFrameId !== session.ownerId ||
        String(state.selectedLayerId) !== String(session.layerId) ||
        state.history.at(-1) !== session.historyEntry
      ) {
        endLiveGesture(session.marker);
        dragRef.current = null;
        return;
      }
      const nextPath: PathData = structuredClone(path);
      const command = nextPath.subPaths[session.subIdx]?.commands[session.cmdIdx];
      if (!command) return;
      const anchor = session.anchorLocal;
      const drag = { x: local.x - anchor.x, y: local.y - anchor.y };
      session.pendingOutgoing = { x: anchor.x + drag.x, y: anchor.y + drag.y };
      if (!session.isMove) {
        command.type = "C";
        command.points = [
          { ...session.c1 },
          { x: anchor.x - drag.x, y: anchor.y - drag.y },
          { ...anchor },
        ];
      }
      commit(nextPath, false);
    },
    [commit, path],
  );

  const pointerUp = useCallback(() => {
    const session = dragRef.current;
    if (!session) return;
    outgoingRef.current = ownsLiveGesture(session.marker) ? session.pendingOutgoing : null;
    endLiveGesture(session.marker);
    dragRef.current = null;
  }, []);
  const beginPath = useCallback((anchor: { x: number; y: number }) => {
    const state = useEditorStore.getState();
    scopeRef.current = {
      ownerId: state.selectedFrameId,
      layerId: state.selectedLayerId,
      side: state.editingSide,
    };
    activeSubpathRef.current = 0;
    outgoingRef.current = null;
    dragRef.current = penDragSession({
      subIdx: 0,
      cmdIdx: 0,
      anchorLocal: anchor,
      isMove: true,
      c1: anchor,
      pendingOutgoing: null,
    });
  }, []);
  const cancelPointer = useCallback(() => {
    const session = dragRef.current;
    if (!session) return;
    const state = useEditorStore.getState();
    if (
      ownsLiveGesture(session.marker) &&
      state.selectedFrameId === session.ownerId &&
      state.history.at(-1) === session.historyEntry
    )
      state.cancelLastHistoryTransaction();
    endLiveGesture(session.marker);
    dragRef.current = null;
    activeSubpathRef.current = null;
    scopeRef.current = null;
    outgoingRef.current = null;
    setPreview(null);
  }, []);
  useEffect(() => cancelPointer, [cancelPointer]);
  useEffect(
    () =>
      useEditorStore.subscribe((state, previous) => {
        if (activeSubpathRef.current == null || state.document === previous.document) return;
        // Undo, Redo and transaction cancellation restore the exact saved graph.
        // Ordinary Pen commits create a new graph and keep construction active.
        const restored = [...previous.history, ...previous.future].some(
          (entry) => entry.document === state.document,
        );
        if (restored) finish();
      }),
    [finish],
  );

  return {
    activeSubpathRef,
    scopeRef,
    finishedAtRef,
    dragRef,
    preview,
    setPreview,
    finish,
    pointerDown,
    pointerDrag,
    pointerUp,
    cancelPointer,
    beginPath,
  };
}
