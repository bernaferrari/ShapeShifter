"use client";

import React from "react";
import { MousePointer2, Sparkles, Command } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "shapeshifter:onboarding:dismissed:v1";

interface Tip {
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
}

const TIPS: Tip[] = [
  {
    icon: <MousePointer2 className="size-3.5" />,
    title: "Pick a tool",
    body: (
      <>
        The palette on the left holds Move, Pen, Lasso &amp; Paint. Press{" "}
        <kbd className="rounded bg-muted px-1 font-mono text-[10px]">V</kbd> /{" "}
        <kbd className="rounded bg-muted px-1 font-mono text-[10px]">P</kbd> to switch fast.
      </>
    ),
  },
  {
    icon: <Sparkles className="size-3.5" />,
    title: "From → To morph",
    body: (
      <>
        Each shape has a <span className="rounded bg-muted px-1 text-[10px] capitalize">from</span>{" "}
        and a <span className="rounded bg-muted px-1 text-[10px] capitalize">to</span>. Edit both,
        then hit Play to morph between them.
      </>
    ),
  },
  {
    icon: <Command className="size-3.5" />,
    title: "Power moves",
    body: (
      <>
        <kbd className="rounded bg-muted px-1 font-mono text-[10px]">⌘K</kbd> opens the command
        palette; <kbd className="rounded bg-muted px-1 font-mono text-[10px]">Space</kbd> plays the
        animation.
      </>
    ),
  },
];

/**
 * First-run onboarding — a quiet, dismissible card that points at the tool
 * palette, the From→To morph concept, and ⌘K / Play. Shows once, then persists
 * dismissal in localStorage. Esc or "Got it" dismisses; respects reduced-motion.
 */
export function Onboarding() {
  // SSR-safe: start hidden, reveal in an effect only when not previously dismissed.
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch {
      // localStorage may be unavailable (private mode) — just skip onboarding.
    }
  }, []);

  const dismiss = React.useCallback(() => {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignore persistence failure
    }
  }, []);

  React.useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, dismiss]);

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Getting started"
      className={cn(
        "pointer-events-auto absolute bottom-4 right-4 z-40 w-72 rounded-xl border border-border bg-card/95 p-3.5 shadow-lg shadow-black/10 backdrop-blur-md",
        "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300 dark:shadow-black/40",
      )}
    >
      <div className="mb-2.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[13px] font-semibold">
          <Sparkles className="size-3.5 text-primary" />
          Welcome to ShapeShifter
        </div>
      </div>
      <ul className="space-y-2.5">
        {TIPS.map((tip, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              {tip.icon}
            </span>
            <div className="min-w-0">
              <div className="text-[12px] font-medium leading-tight">{tip.title}</div>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{tip.body}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex justify-end">
        <Button
          size="sm"
          className="h-7 px-3 text-xs"
          onClick={dismiss}
          aria-label="Dismiss onboarding"
        >
          Got it
        </Button>
      </div>
    </div>
  );
}
