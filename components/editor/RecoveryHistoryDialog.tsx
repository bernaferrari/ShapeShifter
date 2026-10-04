"use client";
import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  readAutosave,
  readRecoveryCheckpoints,
  type RecoveryCheckpoint,
} from "@/lib/store/localRecovery";
type RecoveryEntry = RecoveryCheckpoint & { current?: boolean };

function checkpointDescription(payload: unknown) {
  const value = typeof payload === "string" ? JSON.parse(payload) : payload;
  const project = value as {
    vector?: { name?: string };
    frames?: unknown[];
    layers?: unknown[];
  } | null;
  return {
    name: project?.vector?.name || "ShapeShifter project",
    detail: project?.frames
      ? `${project.frames.length} artboards`
      : `${project?.layers?.length ?? 0} layers`,
  };
}

export function RecoveryHistoryDialog({
  open,
  onOpenChange,
  onRestore,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestore: (payload: unknown) => Promise<void>;
}) {
  const [checkpoints, setCheckpoints] = React.useState<RecoveryEntry[]>([]);
  const [selected, setSelected] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [restoring, setRestoring] = React.useState(false);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setSelected(null);
    Promise.all([readAutosave(), readRecoveryCheckpoints()])
      .then(([current, history]) => {
        if (!cancelled)
          setCheckpoints(
            current == null
              ? history
              : [{ current: true, savedAt: Date.now(), payload: current }, ...history],
          );
      })
      .catch(() => {
        if (!cancelled) setError("Earlier autosaves could not be opened in this browser.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);
  const restore = async () => {
    const checkpoint = selected == null ? null : checkpoints[selected];
    if (!checkpoint) return;
    setRestoring(true);
    setError("");
    try {
      await onRestore(checkpoint.payload);
      onOpenChange(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "This checkpoint could not be restored.");
    } finally {
      setRestoring(false);
    }
  };
  const download = () => {
    const checkpoint = selected == null ? null : checkpoints[selected];
    if (!checkpoint) return;
    const content =
      typeof checkpoint.payload === "string"
        ? checkpoint.payload
        : JSON.stringify(checkpoint.payload, null, 2);
    const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = checkpoint.current
      ? "latest-local-copy.shapeshifter"
      : `recovery-${checkpoint.savedAt}.shapeshifter`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Earlier autosaves</DialogTitle>
          <DialogDescription>
            This browser keeps the latest local copy and up to 20 earlier checkpoints, about 30
            seconds apart. Restoring keeps the replaced copy and is one undo step.
          </DialogDescription>
        </DialogHeader>
        <div
          className="max-h-72 space-y-1 overflow-y-auto"
          role="listbox"
          aria-label="Saved checkpoints"
        >
          {checkpoints.map((checkpoint, index) => {
            let description: ReturnType<typeof checkpointDescription>;
            try {
              description = checkpointDescription(checkpoint.payload);
            } catch {
              description = { name: "Recovery checkpoint", detail: "Saved project" };
            }
            return (
              <button
                key={`${checkpoint.savedAt}:${index}`}
                type="button"
                role="option"
                aria-selected={selected === index}
                tabIndex={(selected ?? 0) === index ? 0 : -1}
                onKeyDown={(event) => {
                  let target: number | null = null;
                  if (event.key === "ArrowDown")
                    target = Math.min(checkpoints.length - 1, index + 1);
                  if (event.key === "ArrowUp") target = Math.max(0, index - 1);
                  if (event.key === "Home") target = 0;
                  if (event.key === "End") target = checkpoints.length - 1;
                  if (target == null) return;
                  event.preventDefault();
                  setSelected(target);
                  event.currentTarget.parentElement
                    ?.querySelectorAll<HTMLButtonElement>("button")
                    [target]?.focus();
                }}
                onClick={() => setSelected(index)}
                className={`flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left text-xs focus-visible:ring-2 focus-visible:ring-ring ${selected === index ? "border-primary bg-primary/8" : "border-transparent hover:bg-muted"}`}
              >
                <span className="min-w-0">
                  {checkpoint.current && (
                    <span className="block text-[10px] font-medium text-primary">
                      Latest local copy
                    </span>
                  )}
                  <span className="block truncate font-medium">{description.name}</span>
                  <span className="text-muted-foreground">{description.detail}</span>
                </span>
                {!checkpoint.current && (
                  <time
                    dateTime={new Date(checkpoint.savedAt).toISOString()}
                    className="shrink-0 text-muted-foreground"
                  >
                    {new Date(checkpoint.savedAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </time>
                )}
              </button>
            );
          })}
          {!checkpoints.length && !loading && !error && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Earlier autosaves will appear as you work.
            </p>
          )}
          {loading && (
            <p className="py-6 text-center text-sm text-muted-foreground">Opening checkpoints…</p>
          )}
        </div>
        <div className="flex items-center justify-between gap-3">
          <p role="status" className="text-xs text-destructive">
            {error}
          </p>
          <Button onClick={restore} disabled={selected == null || loading || restoring}>
            {restoring ? "Restoring…" : "Restore checkpoint"}
          </Button>
        </div>
        <Button
          variant="outline"
          onClick={download}
          disabled={selected == null || loading || restoring}
        >
          Download selected backup
        </Button>
      </DialogContent>
    </Dialog>
  );
}
