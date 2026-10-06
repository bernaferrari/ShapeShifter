"use client";

import React from "react";
import { useEditorStore } from "@/lib/store/editorStore";
import { anchoredTimelineScroll } from "./timelineScale";

/** One pixel/time mapping drives ruler, tracks, pointer editing, and playhead. */
export function useTimelineNavigation(
  sectionRef: React.RefObject<HTMLElement | null>,
  viewportRef: React.RefObject<HTMLDivElement | null>,
  layersWidth: number,
) {
  const storedZoom = useEditorStore((state) => state.timelineZoom);
  const scrollLeft = useEditorStore((state) => state.timelineScrollX);
  const zoom = Math.max(1, Math.min(10, storedZoom));
  const [measuredWidth, setWidth] = React.useState(0);
  const width = Math.max(1, measuredWidth);
  const pendingAnchor = React.useRef<{ progress: number; anchor: number } | null>(null);

  React.useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const measure = () =>
      setWidth(
        Math.max(1, (element.clientWidth || element.getBoundingClientRect().width) - layersWidth),
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [viewportRef, layersWidth]);

  React.useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element || !measuredWidth) return;
    const state = useEditorStore.getState();
    const desired = pendingAnchor.current
      ? anchoredTimelineScroll(
          pendingAnchor.current.progress,
          width,
          zoom,
          pendingAnchor.current.anchor,
        )
      : Math.max(0, Math.min(width * (zoom - 1), state.timelineScrollX));
    pendingAnchor.current = null;
    element.scrollLeft = desired;
    if (state.timelineScrollX !== desired) state.setTimelineScroll(desired, element.scrollTop);
  }, [zoom, width, measuredWidth, viewportRef]);

  const zoomBy = React.useCallback(
    (factor: number, pixelAnchor?: number) => {
      const state = useEditorStore.getState();
      const currentZoom = Math.max(1, Math.min(10, state.timelineZoom));
      const nextZoom = Math.max(1, Math.min(10, currentZoom * factor));
      if (nextZoom === currentZoom) return;
      const x =
        pixelAnchor ??
        Math.max(0, Math.min(width, state.progress * width * currentZoom - state.timelineScrollX));
      pendingAnchor.current = {
        progress:
          pixelAnchor === undefined
            ? state.progress
            : (state.timelineScrollX + x) / (width * currentZoom),
        anchor: x / width,
      };
      state.setTimelineZoom(nextZoom);
    },
    [width],
  );

  const focusPlayhead = React.useCallback(() => {
    const state = useEditorStore.getState();
    const desired = anchoredTimelineScroll(state.progress, width, zoom);
    if (viewportRef.current) viewportRef.current.scrollLeft = desired;
    state.setTimelineScroll(desired, viewportRef.current?.scrollTop ?? 0);
  }, [width, zoom, viewportRef]);

  const fit = React.useCallback(() => {
    const state = useEditorStore.getState();
    pendingAnchor.current = { progress: 0, anchor: 0 };
    state.setTimelineZoom(1);
    state.setTimelineScroll(0, viewportRef.current?.scrollTop ?? 0);
    if (viewportRef.current) viewportRef.current.scrollLeft = 0;
  }, [viewportRef]);

  const setViewport = React.useCallback(
    (nextZoom: number, x: number, y: number) => {
      const resolvedZoom = Math.max(1, Math.min(10, nextZoom));
      const resolvedX = Math.max(0, Math.min(width * (resolvedZoom - 1), x));
      const element = viewportRef.current;
      if (element) element.scrollTop = Math.max(0, y);
      pendingAnchor.current = null;
      useEditorStore.setState({
        timelineZoom: resolvedZoom,
        timelineScrollX: resolvedX,
        timelineScrollY: element?.scrollTop ?? Math.max(0, y),
      });
      // After a zoom the layout effect applies X against the new content width.
      if (element && resolvedZoom === zoom) element.scrollLeft = resolvedX;
    },
    [viewportRef, width, zoom],
  );

  React.useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const onWheel = (event: WheelEvent) => {
      const x = event.clientX - section.getBoundingClientRect().left - layersWidth;
      if (x < 0) return;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        zoomBy(Math.exp(-event.deltaY * 0.005), Math.min(width, x));
      } else if (event.shiftKey && zoom > 1 && viewportRef.current) {
        event.preventDefault();
        const desired = Math.max(
          0,
          Math.min(
            width * (zoom - 1),
            viewportRef.current.scrollLeft + event.deltaY + event.deltaX,
          ),
        );
        viewportRef.current.scrollLeft = desired;
        useEditorStore.getState().setTimelineScroll(desired, viewportRef.current.scrollTop);
      }
    };
    section.addEventListener("wheel", onWheel, { passive: false });
    return () => section.removeEventListener("wheel", onWheel);
  }, [sectionRef, viewportRef, layersWidth, zoomBy, width, zoom]);

  React.useEffect(
    () =>
      useEditorStore.subscribe((state, previous) => {
        if (
          !state.isPlaying ||
          state.progress === previous.progress ||
          zoom <= 1 ||
          !viewportRef.current
        )
          return;
        const position = state.progress * width * zoom - viewportRef.current.scrollLeft;
        if (position < 0 || position > width) {
          const desired = anchoredTimelineScroll(state.progress, width, zoom, 0.1);
          viewportRef.current.scrollLeft = desired;
          state.setTimelineScroll(desired, viewportRef.current.scrollTop);
        }
      }),
    [width, zoom, viewportRef],
  );

  return {
    zoom,
    width,
    contentWidth: width * zoom,
    scrollLeft,
    zoomBy,
    focusPlayhead,
    fit,
    setViewport,
  };
}
