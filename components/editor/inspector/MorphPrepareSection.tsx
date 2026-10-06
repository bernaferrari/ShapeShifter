"use client";

import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEditorStore } from "@/lib/store/editorStore";
import { androidPathMorphSignature, parsePath } from "@/lib/shapeshifter/pathUtils";

/**
 * Only speaks up when a morph needs attention: the start and end shapes are not
 * compatible yet, or a prepared mapping is waiting to be applied.
 */
export function MorphPrepareSection() {
  const morphPreview = useEditorStore((state) => state.morphPreview);
  const commitMorphPreview = useEditorStore((state) => state.commitMorphPreview);
  const cancelMorphPreview = useEditorStore((state) => state.cancelMorphPreview);
  const previewPrepareForMorph = useEditorStore((state) => state.previewPrepareForMorph);
  const selectedLayerId = useEditorStore((state) => state.selectedLayerId);
  const layer = useEditorStore((state) =>
    state.layers.find((candidate) => String(candidate.id) === String(state.selectedLayerId)),
  );

  const blocks = useEditorStore((state) => state.animation.blocks);
  const previewing = morphPreview && String(morphPreview.layerId) === String(selectedLayerId);
  const signatures = new Set(
    layer
      ? [
          androidPathMorphSignature(layer.from),
          androidPathMorphSignature(layer.to ?? layer.from),
          ...blocks
            .filter(
              (block) =>
                String(block.layerId) === String(layer.id) && block.propertyName === "pathData",
            )
            .flatMap((block) => [
              androidPathMorphSignature(parsePath(String(block.fromValue))),
              androidPathMorphSignature(parsePath(String(block.toValue))),
            ]),
        ]
      : [],
  );
  const needsPrepare = signatures.size > 1;
  if (!previewing && !needsPrepare) return null;

  const mapping = morphPreview?.mapping;
  const compatible =
    mapping?.alignments.kind === "prepared" ? mapping.alignments.compatible : undefined;

  return (
    <div className="border-b border-border bg-amber-500/[0.06] px-3 py-2.5">
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-[11px] leading-snug">
            {previewing
              ? compatible === false
                ? "These points could not be matched. Adjust their contours and try again."
                : "Preview ready. Apply the matched points to every pose."
              : "Animation poses need matching points to morph smoothly."}
          </p>
          <div className="flex gap-1">
            {previewing ? (
              <>
                <Button
                  size="sm"
                  className="h-6 px-2.5 text-[11px]"
                  disabled={compatible === false}
                  onClick={() => commitMorphPreview()}
                >
                  Apply
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2.5 text-[11px]"
                  onClick={() => cancelMorphPreview()}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                className="h-6 px-2.5 text-[11px]"
                onClick={() => previewPrepareForMorph()}
              >
                Match points
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
