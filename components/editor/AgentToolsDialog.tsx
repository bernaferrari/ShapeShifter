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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Agent tools</DialogTitle>
          <DialogDescription>
            Inspect the document, apply precise edits, and undo a batch in one step. Browser agents
            can discover the same tools through WebMCP where supported.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between">
          <label htmlFor="agent-document" className="text-xs font-medium">
            Document snapshot
          </label>
          <Button variant="outline" size="sm" onClick={refresh}>
            Refresh snapshot
          </Button>
        </div>
        <Textarea
          id="agent-document"
          aria-label="Agent document snapshot"
          value={inspection}
          readOnly
          className="h-40 resize-none font-mono text-[11px] [field-sizing:fixed]"
        />
        <form aria-label="Agent command batch" onSubmit={apply} className="space-y-3">
          <label htmlFor="agent-commands" className="text-xs font-medium">
            Command batch
          </label>
          <p id="agent-command-help" className="text-xs text-muted-foreground">
            Use expectedRevision from the snapshot and a commands array. Every command is checked
            before the document changes.
          </p>
          <Textarea
            id="agent-commands"
            aria-describedby="agent-command-help"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={'{ "expectedRevision": 0, "commands": [] }'}
            spellCheck={false}
            className="h-32 font-mono text-xs [field-sizing:fixed]"
          />
          <div className="flex items-center justify-between gap-3">
            <p role="status" className="text-xs text-muted-foreground">
              {result || "Edits stay in this browser and use the editor’s undo history."}
            </p>
            <Button type="submit" disabled={!draft.trim()}>
              Apply batch
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
