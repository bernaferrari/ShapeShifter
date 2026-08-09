"use client";

import { useCallback, useRef, useState } from "react";
import { generateId } from "@/lib/shapeshifter/ids";
import type { Command, PathData } from "@/lib/shapeshifter/types";
import { useEditorStore } from "@/lib/store/editorStore";

interface PenDragSession {
  subIdx: number;
  cmdIdx: number;
  anchorLocal: { x: number; y: number };
  isMove: boolean;
  c1: { x: number; y: number };
  pendingOutgoing: { x: number; y: number } | null;
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
  const outgoingRef = useRef<{ x: number; y: number } | null>(null);
  const dragRef = useRef<PenDragSession | null>(null);
  const [preview, setPreview] = useState<{ x: number; y: number } | null>(null);

  const finish = useCallback(() => {
    activeSubpathRef.current = null;
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
          return;
        }

        const lastCommand = subpath.commands[subpath.commands.length - 1];
        const lastAnchor = lastCommand?.points[lastCommand.points.length - 1];
        if (
          lastAnchor &&
          Math.hypot(local.x - lastAnchor.x, local.y - lastAnchor.y) <= closeTolerance
        ) {
          finish();
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
        dragRef.current = {
          subIdx: active,
          cmdIdx: subpath.commands.length - 1,
          anchorLocal: { ...local },
          isMove: false,
          c1,
          pendingOutgoing: null,
        };
        outgoingRef.current = null;
        commit(nextPath, false);
        return;
      }

      useEditorStore.getState().pushHistory();
      nextPath.subPaths.push({
        commands: [{ id: generateId(), type: "M", points: [{ ...local }] } as Command],
      });
      const subIdx = nextPath.subPaths.length - 1;
      activeSubpathRef.current = subIdx;
      dragRef.current = {
        subIdx,
        cmdIdx: 0,
        anchorLocal: { ...local },
        isMove: true,
        c1: { ...local },
        pendingOutgoing: null,
      };
      outgoingRef.current = null;
      commit(nextPath, false);
    },
    [commit, finish, path, snapStep, worldPerPixel],
  );

  const pointerDrag = useCallback(
    (local: { x: number; y: number }) => {
      const session = dragRef.current;
      if (!session || !path) return;
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
    outgoingRef.current = session.pendingOutgoing;
    dragRef.current = null;
  }, []);

  return {
    activeSubpathRef,
    dragRef,
    preview,
    setPreview,
    finish,
    pointerDown,
    pointerDrag,
    pointerUp,
  };
}
