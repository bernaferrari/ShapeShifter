"use client";

import { Check, CircleAlert, HardDrive, LoaderCircle, ShieldCheck } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { useDocumentAutosave } from "./hooks/useDocumentAutosave";

export type DocumentAutosave = ReturnType<typeof useDocumentAutosave>;

export function DocumentSaveStatus({ autosave }: { autosave: DocumentAutosave }) {
  const { status, retry } = autosave;
  const state = {
    restoring: {
      label: "Restoring…",
      detail: "Opening the document saved in this browser.",
      icon: HardDrive,
    },
    saving: {
      label: "Saving…",
      detail: "Saving your latest changes in this browser.",
      icon: LoaderCircle,
    },
    saved: {
      label: "Saved locally",
      detail:
        "Your latest changes are saved in this browser. Export a project file to keep a portable backup.",
      icon: Check,
    },
    error: {
      label: "Save unavailable",
      detail: "Your latest changes could not be saved. Click to retry, or export a project backup.",
      icon: CircleAlert,
    },
    paused: {
      label: "Recovery preserved",
      detail:
        "The previous autosave is preserved. Export your current project, then use File → Earlier autosaves to download or restore a saved copy.",
      icon: ShieldCheck,
    },
    conflict: {
      label: "Newer save found",
      detail:
        "Another tab saved newer changes. Export your edits, then use File → Earlier autosaves to open the latest local copy.",
      icon: CircleAlert,
    },
  }[status];
  const Icon = state.icon;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={state.label}
            aria-disabled={status !== "error"}
            onClick={status === "error" ? retry : undefined}
            className={cn(
              "flex h-8 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[11px] text-muted-foreground aria-disabled:cursor-default",
              status === "error" && "text-destructive hover:bg-destructive/10",
            )}
          />
        }
      >
        <Icon
          aria-hidden="true"
          className={cn("size-3.5", status === "saving" && "motion-safe:animate-spin")}
        />
        <span className="hidden w-[92px] text-left xl:inline">{state.label}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{state.detail}</TooltipContent>
    </Tooltip>
  );
}
