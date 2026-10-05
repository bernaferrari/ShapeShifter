"use client";

import React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface MobilePanelControls {
  handle: React.ReactNode;
  onClose: () => void;
}
const MobilePanelContext = React.createContext<MobilePanelControls | null>(null);

export function MobilePanelHeaderProvider({
  children,
  ...controls
}: MobilePanelControls & { children: React.ReactNode }) {
  return <MobilePanelContext.Provider value={controls}>{children}</MobilePanelContext.Provider>;
}

export function useMobilePanelHeader() {
  return React.useContext(MobilePanelContext) !== null;
}

/** The panel owns its title and actions; mobile adds resizing and closing to that same row. */
export function PanelHeader({
  children,
  actions,
  className,
  style,
  ...props
}: React.ComponentProps<"div"> & { actions?: React.ReactNode }) {
  const mobile = React.useContext(MobilePanelContext);
  return (
    <div
      {...props}
      data-panel-header
      className={cn(
        className,
        mobile &&
          "relative flex h-11 min-h-11 shrink-0 items-center gap-0 border-b border-r-0 border-border bg-sidebar pl-3 pr-1 py-0 [&_button]:min-h-11 [&_button]:min-w-11 [&_button>svg]:size-5",
      )}
      style={style}
    >
      {mobile ? (
        <>
          <div className="flex min-w-0 flex-1 max-w-[calc(50%-32px)] items-center">{children}</div>
          <div className="absolute left-1/2 top-0 -translate-x-1/2">{mobile.handle}</div>
          <div className="ml-auto flex shrink-0 items-center">
            {actions}
            <button
              type="button"
              aria-label="Close panel"
              onClick={mobile.onClose}
              className="group grid size-11 shrink-0 touch-manipulation place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-ring"
            >
              <span
                className="grid size-8 place-items-center rounded-full bg-muted text-foreground group-hover:bg-accent"
                aria-hidden="true"
              >
                <X className="size-4" />
              </span>
            </button>
          </div>
        </>
      ) : (
        <>
          {children}
          {actions}
        </>
      )}
    </div>
  );
}
