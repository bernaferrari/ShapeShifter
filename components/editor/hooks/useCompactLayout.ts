"use client";

import React from "react";

const PHONE_QUERY = "(max-width: 767px)";
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
