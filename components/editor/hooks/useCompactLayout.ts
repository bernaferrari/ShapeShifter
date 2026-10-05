"use client";

import React from "react";

const PHONE_QUERY = "(max-width: 767px), (pointer: coarse) and (max-height: 500px)";
const TOUCH_QUERY = "(pointer: coarse)";

function useMediaQuery(query: string) {
  return React.useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Phones get the single-column editor: full-screen canvas with bottom sheets. */
export const useCompactLayout = () => useMediaQuery(PHONE_QUERY);

/** Touch-first devices (phones, tablets): bigger targets, touch-worded hints. */
export const useCoarsePointer = () => useMediaQuery(TOUCH_QUERY);

/** iOS keyboards resize the visual viewport even when the layout viewport stays tall. */
export function useVisualViewportHeight() {
  return React.useSyncExternalStore(
    (onChange) => {
      const viewport = window.visualViewport;
      viewport?.addEventListener("resize", onChange);
      viewport?.addEventListener("scroll", onChange);
      window.addEventListener("resize", onChange);
      return () => {
        viewport?.removeEventListener("resize", onChange);
        viewport?.removeEventListener("scroll", onChange);
        window.removeEventListener("resize", onChange);
      };
    },
    () => window.visualViewport?.height ?? window.innerHeight,
    () => null,
  );
}
