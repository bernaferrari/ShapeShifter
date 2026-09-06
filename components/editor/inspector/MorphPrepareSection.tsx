"use client";

import { Button } from "@/components/ui/button";
import { useEditorStore } from "@/lib/store/editorStore";
import { Section } from "./InspectorControls";

export function MorphPrepareSection() {
  const morphPreview = useEditorStore((state) => state.morphPreview);
  const commitMorphPreview = useEditorStore((state) => state.commitMorphPreview);
  const cancelMorphPreview = useEditorStore((state) => state.cancelMorphPreview);
  const previewPrepareForMorph = useEditorStore((state) => state.previewPrepareForMorph);
  const selectedLayerId = useEditorStore((state) => state.selectedLayerId);
  const layer = useEditorStore((state) =>
    state.layers.find((candidate) => String(candidate.id) === String(state.selectedLayerId)),
  );

  const mapping = morphPreview?.mapping ?? layer?.morphMapping;
  if (!layer?.to && !morphPreview) return null;

  const compatible =
    mapping?.alignments.kind === "prepared" ? mapping.alignments.compatible : undefined;

  return (
    <Section title="Prepare for morph" defaultOpen>
      {morphPreview && String(morphPreview.layerId) === String(selectedLayerId) ? (
        <div className="space-y-2">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Source paths are unchanged until you apply. Compatible:{" "}
            {compatible == null ? "unknown" : compatible ? "yes" : "no"}.
          </p>
          {mapping?.alignments.kind === "prepared" && (
            <p className="break-all font-mono text-[10px] text-muted-foreground">
              {mapping.alignments.fromSignature} → {mapping.alignments.toSignature}
            </p>
          )}
          <div className="flex gap-1">
            <Button size="sm" className="h-7 text-[11px]" onClick={() => commitMorphPreview()}>
              Apply
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[11px]"
              onClick={() => cancelMorphPreview()}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {mapping?.alignments.kind === "prepared" && (
            <p className="text-[11px] text-muted-foreground">
              Last mapping{" "}
              {mapping.alignments.compatible ? "is Android-compatible" : "is not compatible"}.
            </p>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px]"
            onClick={() => previewPrepareForMorph()}
          >
            Preview prepare
          </Button>
        </div>
      )}
    </Section>
  );
}
