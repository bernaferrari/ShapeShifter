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
import { Textarea } from "@/components/ui/textarea";
import { AgentCommandError } from "@/lib/agent/commands";
import { editorAgent } from "@/lib/agent/browserTools";

export function AgentToolsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [inspection, setInspection] = React.useState("");
  const [draft, setDraft] = React.useState("");
  const [result, setResult] = React.useState("");
  const refresh = React.useCallback(
    () => setInspection(JSON.stringify(editorAgent.inspect(), null, 2)),
    [],
  );
  React.useEffect(() => {
    if (open) {
      refresh();
      setResult("");
    }
  }, [open, refresh]);
  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const request = JSON.parse(draft);
      const applied = editorAgent.apply(request);
      setResult(
        applied.changed
          ? `Applied as one undo step. Revision ${applied.revision}.`
          : "No changes were needed.",
      );
      refresh();
    } catch (error) {
      setResult(
        `${error instanceof AgentCommandError ? error.code + ": " : ""}${error instanceof Error ? error.message : "Invalid command batch."}`,
      );
    }
  };
  const editorClass =
    "h-64 resize-none rounded-lg border-transparent bg-secondary font-mono text-[11px] leading-relaxed [field-sizing:fixed] focus-visible:border-primary";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="gap-0.5 border-b border-border px-5 pb-3 pt-4">
          <DialogTitle>Agent tools</DialogTitle>
          <DialogDescription className="text-[12px]">
            Inspect the document and apply validated edit batches. Each batch is one undo step;
            browser agents get the same tools through WebMCP.
          </DialogDescription>
        </DialogHeader>
        <form aria-label="Agent command batch" onSubmit={apply}>
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <div className="min-w-0 space-y-2">
              <div className="flex h-6 items-center justify-between">
                <label htmlFor="agent-document" className="text-[12px] font-medium">
                  Snapshot
                </label>
                <Button type="button" variant="ghost" size="xs" onClick={refresh}>
                  Refresh
                </Button>
              </div>
              <Textarea
                id="agent-document"
                aria-label="Agent document snapshot"
                value={inspection}
                readOnly
                className={editorClass}
              />
            </div>
            <div className="min-w-0 space-y-2">
              <div className="flex h-6 items-center">
                <label htmlFor="agent-commands" className="text-[12px] font-medium">
                  Command batch
                </label>
              </div>
              <Textarea
                id="agent-commands"
                aria-describedby="agent-command-help"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={'{ "expectedRevision": 0, "commands": [] }'}
                spellCheck={false}
                className={editorClass}
              />
              <p id="agent-command-help" className="text-[11px] text-muted-foreground">
                Include expectedRevision from the snapshot. Commands are validated before anything
                changes.
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
            <p role="status" className="min-w-0 truncate text-[12px] text-muted-foreground">
              {result || "Edits stay in this browser."}
            </p>
            <Button type="submit" size="sm" disabled={!draft.trim()}>
              Apply batch
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
