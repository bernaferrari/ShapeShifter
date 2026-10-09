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
    document?: { name?: string; frameIds?: string[]; rootNodeIds?: string[] };
  } | null;
  const artboards = project?.document?.frameIds?.length ?? 0;
  const looseLayers = project?.document?.rootNodeIds?.length ?? 0;
  const parts = [`${artboards} ${artboards === 1 ? "artboard" : "artboards"}`];
  if (looseLayers > 0)
    parts.push(`${looseLayers} ${looseLayers === 1 ? "layer" : "layers"} outside artboards`);
  return {
    name: project?.document?.name || "Pathshift project",
    detail: parts.join(" · "),
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
        if (cancelled) return;
        const entries: RecoveryEntry[] =
          current == null
            ? history
            : [{ current: true, savedAt: Date.now(), payload: current }, ...history];
        setCheckpoints(entries);
        // Preselect the newest restorable checkpoint so the primary action is ready.
        const firstPast = entries.findIndex((entry) => !entry.current);
        setSelected(entries.length ? (firstPast >= 0 ? firstPast : 0) : null);
      })
      .catch(() => {
        if (!cancelled) setError("Version history could not be opened in this browser.");
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
    if (!checkpoint || checkpoint.current) return;
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
      ? "latest-local-copy.pathshift"
      : `recovery-${checkpoint.savedAt}.pathshift`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const selectedIsCurrent = selected != null && Boolean(checkpoints[selected]?.current);
  const relativeTime = (savedAt: number) => {
    const seconds = Math.max(0, Math.round((Date.now() - savedAt) / 1000));
    if (seconds < 60) return "Just now";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    return new Date(savedAt).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-[440px]">
        <DialogHeader className="gap-0.5 border-b border-border px-5 pb-3 pt-4">
          <DialogTitle>Version history</DialogTitle>
          <DialogDescription className="text-[12px]">
            Saved automatically in this browser. Restoring can be undone.
          </DialogDescription>
        </DialogHeader>
        <div
          className="max-h-80 space-y-0.5 overflow-y-auto p-2"
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
            const isSelected = selected === index;
            return (
              <button
                key={`${checkpoint.savedAt}:${index}`}
                type="button"
                role="option"
                aria-selected={isSelected}
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
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring ${isSelected ? "bg-primary/10 shadow-[inset_0_0_0_1px_var(--primary)]" : "hover:bg-muted"}`}
              >
                <span
                  className={`size-2 shrink-0 rounded-full ${checkpoint.current ? "bg-primary" : "bg-muted-foreground/40"}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">
                    {checkpoint.current ? "Current version" : description.name}
                  </span>
                  <span className={`block truncate text-[12px] text-muted-foreground`}>
                    {checkpoint.current ? description.name : description.detail}
                  </span>
                </span>
                <time
                  dateTime={new Date(checkpoint.savedAt).toISOString()}
                  className={`shrink-0 text-[12px] tabular-nums text-muted-foreground`}
                >
                  {relativeTime(checkpoint.savedAt)}
                </time>
              </button>
            );
          })}
          {!checkpoints.length && !loading && !error && (
            <p className="py-10 text-center text-[13px] text-muted-foreground">
              Versions will appear here as you work.
            </p>
          )}
          {!loading && checkpoints.length > 0 && checkpoints.every((entry) => entry.current) && (
            <p className="px-3 pt-2 pb-1 text-[12px] text-muted-foreground">
              Earlier versions appear here as you keep working.
            </p>
          )}
          {loading && (
            <p className="py-10 text-center text-[13px] text-muted-foreground">Loading versions…</p>
          )}
        </div>
        {error && (
          <p role="status" className="px-5 pb-2 text-[12px] text-destructive">
            {error}
          </p>
        )}
        <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={download}
            disabled={selected == null || loading || restoring}
          >
            Download copy
          </Button>
          <Button
            size="sm"
            onClick={restore}
            disabled={selected == null || selectedIsCurrent || loading || restoring}
          >
            {restoring ? "Restoring…" : "Restore"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
