"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { PathData } from "@/lib/pathshift/types";
import { parsePath, pathToString } from "@/lib/pathshift/pathUtils";
import { validatePathData } from "@/lib/pathshift/path/pathValidation";

export function PathDataEditor({
  path,
  onCommit,
}: {
  path: PathData;
  onCommit: (path: PathData) => void;
}) {
  const source = pathToString(path);
  const [draft, setDraft] = useState(source);
  const [error, setError] = useState<string | null>(null);
  const cancelBlur = useRef(false);
  const lastCommit = useRef(source);
  const descriptionId = useId();
  useEffect(() => {
    setDraft(source);
    setError(null);
    lastCommit.current = source;
  }, [path, source]);

  const commit = () => {
    if (draft === source || draft === lastCommit.current) return true;
    const problem = validatePathData(draft);
    if (problem) {
      setError(problem);
      return false;
    }
    try {
      onCommit(parsePath(draft));
      lastCommit.current = draft;
      setError(null);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The path could not be updated.");
      return false;
    }
  };
  return (
    <div className="space-y-1.5">
      <textarea
        aria-label="SVG path data"
        aria-invalid={Boolean(error)}
        aria-describedby={descriptionId}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        onBlur={() => {
          if (cancelBlur.current) {
            cancelBlur.current = false;
            return;
          }
          commit();
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            cancelBlur.current = true;
            setDraft(source);
            setError(null);
            event.currentTarget.blur();
          } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            event.stopPropagation();
            if (commit()) event.currentTarget.blur();
          }
        }}
        spellCheck={false}
        className="min-h-20 w-full resize-y rounded-md border border-border bg-background p-2 font-mono text-[11px] leading-relaxed text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 aria-invalid:border-destructive"
      />
      {error && (
        <p id={descriptionId} role="alert" className="text-[11px] leading-snug text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
