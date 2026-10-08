"use client";
import React from "react";
import { useShallow } from "zustand/react/shallow";
import { toast } from "sonner";
import { useEditorStore } from "@/lib/store/editorStore";
import { booleanSelectionIssue } from "@/lib/store/commands/booleanSelection";
import type { BooleanOp } from "@/lib/pathshift/path/booleanOperations";
import { Section } from "./inspector/InspectorControls";
import { DropdownMenuItem, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
const operations = [
  { operation: "union", label: "Union" },
  { operation: "subtract", label: "Subtract" },
  { operation: "intersect", label: "Intersect" },
  { operation: "exclude", label: "Exclude" },
] as const;
function useBooleanOperations() {
  const selection = useEditorStore(
    useShallow((state) => ({
      layers: state.layers,
      animation: state.animation,
      selectedLayerIds: state.selectedLayerIds,
      selectedLayerRefs: state.selectedLayerRefs,
      selectedFrameId: state.selectedFrameId,
      hiddenLayerIds: state.hiddenLayerIds,
      isPlaying: state.isPlaying,
      historyGestureActive: state.historyGestureActive,
      dragState: state.dragState,
      isActionMode: state.isActionMode,
    })),
  );
  const issue = React.useMemo(() => booleanSelectionIssue(selection), [selection]);
  const [pending, setPending] = React.useState(false);
  const apply = async (operation: BooleanOp) => {
    if (pending) return;
    setPending(true);
    try {
      const result = await useEditorStore.getState().booleanCombine(operation);
      if (!result.ok) toast.error("Paths could not be combined", { description: result.reason });
      else if (result.empty)
        toast.message("No filled area remains", {
          description: "Undo restores the original paths.",
        });
    } finally {
      setPending(false);
    }
  };
  return { issue, pending, apply };
}
export function BooleanOperationsPanel() {
  const { issue, pending, apply } = useBooleanOperations();
  return (
    <Section title="Combine paths">
      <p className="text-[11px] leading-relaxed text-muted-foreground" aria-live="polite">
        {pending
          ? "Combining paths…"
          : (issue ??
            "Subtract removes the front paths from the back path. The result keeps the back path's appearance.")}
      </p>
      <div className="grid grid-cols-2 gap-1">
        {operations.map(({ operation, label }) => (
          <button
            key={operation}
            type="button"
            disabled={Boolean(issue) || pending}
            aria-busy={pending}
            title={
              issue ??
              (operation === "subtract"
                ? "Remove front paths from the back path"
                : `${label} selected paths`)
            }
            onClick={() => void apply(operation)}
            className="flex h-8 items-center justify-center rounded-md border border-border bg-background text-[11px] text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {label}
          </button>
        ))}
      </div>
    </Section>
  );
}
export function BooleanMenuItems() {
  const { issue, pending, apply } = useBooleanOperations();
  return (
    <>
      <DropdownMenuLabel className="max-w-64 whitespace-normal text-[11px] font-normal leading-relaxed text-muted-foreground">
        {issue ?? "Subtract removes front paths from the back path."}
      </DropdownMenuLabel>
      {operations.map(({ operation, label }) => (
        <DropdownMenuItem
          key={operation}
          disabled={Boolean(issue) || pending}
          onClick={() => void apply(operation)}
        >
          {label}
        </DropdownMenuItem>
      ))}
    </>
  );
}
