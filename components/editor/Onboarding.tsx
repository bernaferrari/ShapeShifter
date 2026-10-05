"use client";

import React from "react";
import { Command, Hand, MousePointer2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCoarsePointer } from "./hooks/useCompactLayout";

const STORAGE_KEY = "shapeshifter:onboarding:dismissed:v1";

interface Tip {
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
}

const kbd = "rounded border border-border bg-background px-1 py-px text-[10px] font-medium text-foreground";

const TIPS: Tip[] = [
  {
    icon: <MousePointer2 className="size-3.5" />,
    title: "Draw",
    body: (
      <>
        Pick a tool below, or press <kbd className={kbd}>P</kbd> for Pen.
      </>
    ),
  },
  {
    icon: <Sparkles className="size-3.5" />,
    title: "Animate",
    body: <>Click ◇ next to any property, then move the playhead and change it.</>,
  },
  {
    icon: <Command className="size-3.5" />,
    title: "Find anything",
    body: (
      <>
        <kbd className={kbd}>⌘K</kbd> for every command, <kbd className={kbd}>Space</kbd> to play.
      </>
    ),
  },
];

const TOUCH_TIPS: Tip[] = [
  {
    icon: <MousePointer2 className="size-3.5" />,
    title: "Draw",
    body: <>Pick a tool below and drag on the canvas.</>,
  },
  {
    icon: <Sparkles className="size-3.5" />,
    title: "Animate",
    body: <>Tap ◇ next to any property, move the playhead, then change it.</>,
  },
  {
    icon: <Hand className="size-3.5" />,
    title: "Move around",
    body: <>Drag with two fingers to pan, pinch to zoom.</>,
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
  const touch = useCoarsePointer();
  const tips = touch ? TOUCH_TIPS : TIPS;

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
        "pointer-events-auto absolute right-3 bottom-16 z-40 w-64 max-w-[calc(100%-1.5rem)] max-md:left-3 max-md:w-auto rounded-xl bg-card p-3 [box-shadow:var(--elevation-floating)]",
        "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300",
      )}
    >
      <div className="mb-2.5 text-[12px] font-semibold">Welcome to ShapeShifter</div>
      <ul className="space-y-2">
        {tips.map((tip, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
              {tip.icon}
            </span>
            <div className="min-w-0">
              <div className="text-[11px] font-medium leading-tight">{tip.title}</div>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{tip.body}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex justify-end">
        <Button
          size="sm"
          className="h-7 px-3 text-[12px]"
          onClick={dismiss}
          aria-label="Dismiss onboarding"
        >
          Got it
        </Button>
      </div>
    </div>
  );
}
