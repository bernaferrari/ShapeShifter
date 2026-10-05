"use client";

import { Check, CircleAlert, HardDrive, LoaderCircle } from "lucide-react";
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
    conflict: {
      label: "Newer save found",
      detail:
        "Another tab saved newer changes. Export your edits, then use File → Version history to open the latest local copy.",
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
              "flex h-6 shrink-0 items-center gap-1 rounded-md px-1 text-[11px] text-muted-foreground/70 aria-disabled:cursor-default",
              (status === "error" || status === "conflict") &&
                "text-destructive hover:bg-destructive/10 max-sm:size-11 max-sm:justify-center max-sm:p-0",
            )}
          />
        }
      >
        <Icon
          aria-hidden="true"
          className={cn("size-3.5", status === "saving" && "motion-safe:animate-spin")}
        />
        {status !== "saved" && status !== "saving" && (
          <span className="hidden whitespace-nowrap text-left md:inline">{state.label}</span>
        )}
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{state.detail}</TooltipContent>
    </Tooltip>
  );
}
