"use client";

import React from "react";
import { useEditorStore } from "@/lib/store/editorStore";
import { anchoredTimelineScroll } from "./timelineScale";

/** One pixel/time mapping drives ruler, tracks, pointer editing, and playhead. */
export function useTimelineNavigation(
  sectionRef: React.RefObject<HTMLElement | null>,
  tracksRef: React.RefObject<HTMLDivElement | null>,
  layersWidth: number,
) {
  const storedZoom = useEditorStore((state) => state.timelineZoom);
  const scrollLeft = useEditorStore((state) => state.timelineScrollX);
  const zoom = Math.max(1, Math.min(10, storedZoom));
  const [width, setWidth] = React.useState(1);
  const pendingAnchor = React.useRef<{ progress: number; anchor: number } | null>(null);

  React.useLayoutEffect(() => {
    const element = tracksRef.current;
    if (!element) return;
    const measure = () =>
      setWidth(Math.max(1, element.clientWidth || element.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [tracksRef]);

  React.useLayoutEffect(() => {
    const element = tracksRef.current;
    if (!element) return;
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
  }, [zoom, width, tracksRef]);

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
    if (tracksRef.current) tracksRef.current.scrollLeft = desired;
    state.setTimelineScroll(desired, tracksRef.current?.scrollTop ?? 0);
  }, [width, zoom, tracksRef]);

  const fit = React.useCallback(() => {
    const state = useEditorStore.getState();
    pendingAnchor.current = { progress: 0, anchor: 0 };
    state.setTimelineZoom(1);
    state.setTimelineScroll(0, tracksRef.current?.scrollTop ?? 0);
    if (tracksRef.current) tracksRef.current.scrollLeft = 0;
  }, [tracksRef]);

  React.useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const onWheel = (event: WheelEvent) => {
      const x = event.clientX - section.getBoundingClientRect().left - layersWidth;
      if (x < 0) return;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        zoomBy(Math.exp(-event.deltaY * 0.005), Math.min(width, x));
      } else if (event.shiftKey && zoom > 1 && tracksRef.current) {
        event.preventDefault();
        const desired = Math.max(
          0,
          Math.min(width * (zoom - 1), tracksRef.current.scrollLeft + event.deltaY + event.deltaX),
        );
        tracksRef.current.scrollLeft = desired;
        useEditorStore.getState().setTimelineScroll(desired, tracksRef.current.scrollTop);
      }
    };
    section.addEventListener("wheel", onWheel, { passive: false });
    return () => section.removeEventListener("wheel", onWheel);
  }, [sectionRef, tracksRef, layersWidth, zoomBy, width, zoom]);

  React.useEffect(
    () =>
      useEditorStore.subscribe((state, previous) => {
        if (
          !state.isPlaying ||
          state.progress === previous.progress ||
          zoom <= 1 ||
          !tracksRef.current
        )
          return;
        const position = state.progress * width * zoom - tracksRef.current.scrollLeft;
        if (position < 0 || position > width) {
          const desired = anchoredTimelineScroll(state.progress, width, zoom, 0.1);
          tracksRef.current.scrollLeft = desired;
          state.setTimelineScroll(desired, tracksRef.current.scrollTop);
        }
      }),
    [width, zoom, tracksRef],
  );

  return { zoom, width, contentWidth: width * zoom, scrollLeft, zoomBy, focusPlayhead, fit };
}
