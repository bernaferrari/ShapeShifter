"use client";

import React from "react";
import { useEditorStore } from "@/lib/store/editorStore";
import { isTouchClaimed, TOUCH_SLOP_PX } from "@/lib/touchIntent";
import { useTouchViewportGestures } from "../hooks/useTouchViewportGestures";
import type { useTimelineNavigation } from "./useTimelineNavigation";

/** Timeline adapter: zoom time horizontally; scroll rows without changing their height. */
export function useTimelineTouchNavigation({
  sectionRef,
  viewportRef,
  layersWidth,
  headerHeight,
  navigation,
  cancelEditing,
}: {
  sectionRef: React.RefObject<HTMLElement | null>;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  layersWidth: number;
  headerHeight: number;
  navigation: ReturnType<typeof useTimelineNavigation>;
  cancelEditing: () => void;
}) {
  const singlePan = React.useRef<{
    id: number;
    x: number;
    y: number;
    scrollX: number;
    scrollY: number;
    moved: boolean;
  } | null>(null);
  const blockClick = React.useRef(false);
  const bounds = () => {
    const rect = sectionRef.current?.getBoundingClientRect();
    if (!rect) return;
    return new DOMRect(
      rect.left + layersWidth,
      rect.top + headerHeight,
      navigation.width,
      Math.max(1, rect.height - headerHeight),
    );
  };
  const accepts = (event: React.SyntheticEvent<Element>) => {
    const target = event.target as Element;
    return (
      !target.closest("input, textarea, select") &&
      Boolean(
        viewportRef.current?.contains(target) || target.closest('[aria-label="Timeline playhead"]'),
      )
    );
  };
  const touch = useTouchViewportGestures({
    elementRef: sectionRef,
    getBounds: bounds,
    acceptTouch: accepts,
    captureSingle: false,
    minScale: 1,
    maxScale: 10,
    zoomAxes: "horizontal",
    view: () => {
      const state = useEditorStore.getState();
      const scale = Math.max(1, Math.min(10, state.timelineZoom));
      return {
        x: state.timelineScrollX / (navigation.width * scale),
        y: state.timelineScrollY,
        w: 1 / scale,
        h: bounds()?.height ?? 1,
        scale,
      };
    },
    setView: (next) =>
      navigation.setViewport(next.scale, next.x * navigation.width * next.scale, next.y),
    handlers: {
      onPointerDown: (event) => {
        if (
          event.pointerType !== "touch" ||
          !accepts(event) ||
          (event.target as Element).closest('[aria-label="Timeline playhead"]')
        )
          return;
        blockClick.current = false;
        const state = useEditorStore.getState();
        singlePan.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          scrollX: state.timelineScrollX,
          scrollY: state.timelineScrollY,
          moved: false,
        };
      },
      onPointerMove: (event) => {
        const pan = singlePan.current;
        if (!pan || pan.id !== event.pointerId) return;
        // A held keyframe or segment owns this finger now.
        if (isTouchClaimed(event.pointerId)) return void (singlePan.current = null);
        const dx = event.clientX - pan.x,
          dy = event.clientY - pan.y;
        // Same slop as hold-to-drag: the move that cancels a pick-up starts the pan.
        if (!pan.moved && Math.hypot(dx, dy) <= TOUCH_SLOP_PX) return;
        pan.moved = true;
        blockClick.current = true;
        try {
          sectionRef.current?.setPointerCapture(event.pointerId);
        } catch {
          /* Capture can be lost. */
        }
        navigation.setViewport(navigation.zoom, pan.scrollX - dx, pan.scrollY - dy);
      },
      onPointerUp: (event) => {
        if (singlePan.current?.id === event.pointerId) singlePan.current = null;
      },
      onPointerCancel: () => {
        singlePan.current = null;
        cancelEditing();
      },
    },
  });
  return {
    ...touch,
    onPointerDownCapture: (event: React.PointerEvent<Element>) => {
      blockClick.current = false;
      touch.onPointerDownCapture(event);
    },
    onClickCapture: (event: React.MouseEvent<Element>) => {
      touch.onClickCapture(event);
      if (accepts(event) && blockClick.current && event.detail !== 0) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
  };
}
