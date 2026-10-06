"use client";

import React from "react";

export const TimelineNavigationCancellation = React.createContext<
  ((cancel: () => void) => () => void) | null
>(null);

/** A pinch cancels the owned retiming transaction before taking over navigation. */
export function useTimelineNavigationCancellation(cancel: () => void) {
  const register = React.useContext(TimelineNavigationCancellation);
  React.useEffect(() => register?.(cancel), [register, cancel]);
}
