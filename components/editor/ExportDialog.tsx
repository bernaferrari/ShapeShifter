"use client";

import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useEditorStore } from "@/lib/store/editorStore";
import { type ExportOptions } from "@/lib/shapeshifter/exporter";
import {
  exportLiveDocument,
  LIVE_EXPORT_SCOPE,
  selectedLayerExportIssue,
  summarizeAndroidWarnings,
  type LiveExportKind,
} from "@/lib/store/exportDocument";
import { vectorCoordinateSize } from "@/lib/shapeshifter/vectorSpace";
import { CAPABILITY_MATRIX, type ExportFormatId } from "@/lib/shapeshifter/formatCapabilities";
import { commitDocumentV2 } from "@/lib/store/documentRuntime";
import { exportAgentSnapshot, type AgentExportFormat } from "@/lib/agent/export";

interface ExportDialogProps {
  children: React.ReactNode;
}

export function ExportDialog({ children }: ExportDialogProps) {
  const layers = useEditorStore((state) => state.layers);
  const selectedLayerId = useEditorStore((state) => state.selectedLayerId);
  const vector = useEditorStore((state) => state.vector);
  const animation = useEditorStore((state) => state.animation);
  const frames = useEditorStore((state) => state.frames);
  const selectedFrameId = useEditorStore((state) => state.selectedFrameId);
  const currentLayer = layers.find((l) => String(l.id) === String(selectedLayerId)) || layers[0];
  const selectedFrame = frames.find((frame) => frame.id === selectedFrameId);
  const viewportSize = vectorCoordinateSize(selectedFrame?.vector ?? vector);
  const androidAnimation = animation;
  const androidTrackCount = new Set(
    androidAnimation.blocks.map((block) => `${String(block.layerId)}:${block.propertyName}`),
  ).size;

  const [open, setOpen] = useState(false);
  const storedFormat = useEditorStore((state) => state.preferredExportFormat);
  const setPreferredExportFormat = useEditorStore((state) => state.setPreferredExportFormat);
  const [format, setFormat] = useState(storedFormat);
  const [options, setOptions] = useState<ExportOptions>({
    duration: 1.4,
    fps: 60,
    width: 512,
    height: 512,
    loop: true,
    strokeWidth: 2.8,
  });
  const [dimensions, setDimensions] = useState({ width: "512", height: "512" });
  const [dimensionsTouched, setDimensionsTouched] = useState(false);
  const hasDimensions = ["svg", "static", "pdf", "spritesheet"].includes(format);
  const validDimension = (value: string) =>
    /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 16384;
  const dimensionsValid = validDimension(dimensions.width) && validDimension(dimensions.height);

  // Per-format capability summary: N of M animated-track kinds fully supported.
  const capabilityProfile = CAPABILITY_MATRIX[format as ExportFormatId] ?? null;
  const capabilitySummary = (() => {
    if (!capabilityProfile) return null;
    const capabilities = Object.values(capabilityProfile.capabilities);
    const supportedCount = capabilities.filter((c) => c.supported).length;
    const notes = [
      ...new Set([
        ...capabilities.filter((c) => !c.supported && c.note).map((c) => c.note),
        ...capabilityProfile.notes,
      ]),
    ];
    return {
      text: `${supportedCount} of ${capabilities.length} animated-track kinds fully supported in this format.`,
      notes,
    };
  })();
  const [isExporting, setIsExporting] = useState(false);
  const [preview, setPreview] = useState<{ ready: boolean; messages: string[] }>({
    ready: true,
    messages: [],
  });
  React.useEffect(() => {
    if (!open) return;
    if (!["static", "json", "vector", "avd", "pdf", "lottie"].includes(format)) {
      const issue = selectedLayerExportIssue(currentLayer);
      setPreview({ ready: !issue, messages: issue ? [issue] : [] });
      return;
    }
    try {
      const result = exportAgentSnapshot(commitDocumentV2(useEditorStore.getState()), 0, {
        ownerId: selectedFrameId,
        format: format as AgentExportFormat,
      });
      setPreview({
        ready: result.ready,
        messages: [...new Set(result.diagnostics.map((item) => item.message))],
      });
    } catch (error) {
      setPreview({
        ready: false,
        messages: [error instanceof Error ? error.message : "This document could not be exported."],
      });
    }
  }, [
    open,
    format,
    selectedFrameId,
    selectedLayerId,
    currentLayer,
    layers,
    animation,
    vector,
    frames,
  ]);

  const formatGroups: Array<{
    title: string;
    formats: Array<{ key: typeof format; label: string; hint: string; beta?: boolean }>;
  }> = [
    {
      title: "Android",
      formats: [
        { key: "avd", label: "Animated Vector Drawable", hint: "Shape + motion" },
        { key: "vector", label: "Vector Drawable", hint: "Static shape" },
      ],
    },
    {
      title: "Web",
      formats: [
        { key: "svg", label: "Animated SVG", hint: "Selected layer" },
        { key: "static", label: "SVG", hint: "Static artwork" },
        { key: "css", label: "CSS keyframes", hint: "Selected layer" },
        { key: "lottie", label: "Lottie", hint: "JSON", beta: true },
      ],
    },
    {
      title: "Other",
      formats: [
        { key: "pdf", label: "PDF", hint: "Vector print", beta: true },
        { key: "spritesheet", label: "Spritesheet", hint: "SVG frames", beta: true },
        { key: "json", label: "Project file", hint: "Reopen later" },
      ],
    },
  ];

  const handleExport = async () => {
    if (!currentLayer && LIVE_EXPORT_SCOPE[format as LiveExportKind] === "selected-layer") {
      toast.error("No layer selected");
      return;
    }

    setIsExporting(true);

    try {
      let blob: Blob | null = null;
      let filename = "";
      let androidWarningSummary: ReturnType<typeof summarizeAndroidWarnings> = null;
      let staticWarningDescription: string | null = null;
      const exported = await exportLiveDocument(format as LiveExportKind, options);
      const blockingDiagnostics = exported.androidDiagnostics.filter(
        (diagnostic) => diagnostic.severity === "error",
      );
      if ((format === "avd" || format === "vector") && blockingDiagnostics.length > 0) {
        toast.error("Android export needs attention", {
          description: blockingDiagnostics[0]!.message,
        });
        return;
      }
      androidWarningSummary = summarizeAndroidWarnings(exported.androidDiagnostics);
      staticWarningDescription =
        [...exported.staticDiagnostics, ...exported.formatDiagnostics]
          .map((diagnostic) => diagnostic.message)
          .join(" ") || null;
      const payload =
        exported.content instanceof Uint8Array
          ? (exported.content.buffer.slice(
              exported.content.byteOffset,
              exported.content.byteOffset + exported.content.byteLength,
            ) as ArrayBuffer)
          : exported.content;
      blob = new Blob([payload], { type: exported.mimeType });
      filename = exported.filename;

      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);

        if (androidWarningSummary) {
          const warningLabel = androidWarningSummary.count === 1 ? "warning" : "warnings";
          toast.warning(
            `Exported ${format.toUpperCase()} with ${androidWarningSummary.count} ${warningLabel}`,
            {
              description:
                format === "avd"
                  ? `${androidWarningSummary.description} Full details are in SHAPESHIFTER_EXPORT.txt.`
                  : androidWarningSummary.description,
            },
          );
        } else if (staticWarningDescription) {
          toast.warning(`Exported ${format.toUpperCase()} with warning`, {
            description: staticWarningDescription,
          });
        } else {
          toast.success(`Exported ${format.toUpperCase()}`, { description: filename });
        }
        setOpen(false);
      }
    } catch (error) {
      toast.error("Export failed", {
        description:
          error instanceof Error ? error.message : "Try exporting again or save a project backup.",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const sliderRow = (
    label: string,
    value: number,
    unit: string,
    props: { min: number; max: number; ariaLabel: string; onChange: (value: number) => void },
  ) => (
    <div className="grid grid-cols-[88px_minmax(0,1fr)_44px] items-center gap-3">
      <Label className="text-[12px] font-normal text-muted-foreground">{label}</Label>
      <Slider
        value={[value]}
        min={props.min}
        max={props.max}
        step={0.1}
        aria-label={props.ariaLabel}
        onValueChange={(v) => props.onChange(Array.isArray(v) ? v[0] : v)}
      />
      <span className="text-right text-[12px] tabular-nums">
        {value}
        {unit}
      </span>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={children as React.ReactElement} />
      <DialogContent className="max-h-[90dvh] max-w-[420px] gap-0 overflow-y-auto p-0">
        <DialogHeader className="gap-0.5 border-b border-border px-5 pb-3 pt-4">
          <DialogTitle className="text-[15px]">Export</DialogTitle>
          <DialogDescription className="text-[12px]">
            {selectedFrame?.name || vector.name} · {viewportSize.width} × {viewportSize.height}
            {androidTrackCount > 0 &&
              ` · ${androidTrackCount} animated ${androidTrackCount === 1 ? "track" : "tracks"}`}
          </DialogDescription>
        </DialogHeader>

        <div role="radiogroup" aria-label="Export format" className="space-y-3 px-3 py-3">
          {formatGroups.map((group) => (
            <div key={group.title}>
              <div className="px-2 pb-1 text-[11px] font-medium text-muted-foreground">
                {group.title}
              </div>
              {group.formats.map((item) => {
                const selected = format === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      setFormat(item.key);
                      setPreferredExportFormat(item.key);
                    }}
                    className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors ${
                      selected ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                    }`}
                  >
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.beta && (
                      <span
                        className={`rounded px-1 text-[10px] ${selected ? "bg-white/20" : "bg-secondary text-muted-foreground"}`}
                      >
                        Beta
                      </span>
                    )}
                    <span
                      className={`text-[11px] ${selected ? "text-primary-foreground/80" : "text-muted-foreground"}`}
                    >
                      {item.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {(!["json", "vector", "avd", "lottie"].includes(format) ||
          preview.messages.length > 0 ||
          capabilitySummary) && (
          <div className="space-y-3 border-t border-border px-5 py-4">
            {["svg", "css", "spritesheet"].includes(format) &&
              sliderRow("Duration", options.duration || 1.4, "s", {
                min: 0.4,
                max: 4,
                ariaLabel: "Export duration in seconds",
                onChange: (duration) => setOptions({ ...options, duration }),
              })}
            {["svg", "spritesheet"].includes(format) &&
              sliderRow("Stroke width", options.strokeWidth || 2.8, "px", {
                min: 0.5,
                max: 8,
                ariaLabel: "Export stroke width",
                onChange: (strokeWidth) => setOptions({ ...options, strokeWidth }),
              })}
            {hasDimensions && (
              <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-3">
                <Label
                  htmlFor="export-width"
                  className="text-[12px] font-normal text-muted-foreground"
                >
                  Size
                </Label>
                <div className="flex items-center gap-1.5">
                  <Input
                    id="export-width"
                    type="number"
                    min={1}
                    max={16384}
                    step={1}
                    aria-label="Width"
                    value={dimensions.width}
                    aria-invalid={dimensionsTouched && !validDimension(dimensions.width)}
                    onBlur={() => setDimensionsTouched(true)}
                    onChange={(e) => {
                      setDimensions({ ...dimensions, width: e.target.value });
                      if (validDimension(e.target.value))
                        setOptions({ ...options, width: Number(e.target.value) });
                    }}
                    className="h-7 text-[12px] tabular-nums"
                  />
                  <span className="text-muted-foreground">×</span>
                  <Input
                    id="export-height"
                    type="number"
                    min={1}
                    max={16384}
                    step={1}
                    aria-label="Height"
                    value={dimensions.height}
                    aria-invalid={dimensionsTouched && !validDimension(dimensions.height)}
                    onBlur={() => setDimensionsTouched(true)}
                    onChange={(e) => {
                      setDimensions({ ...dimensions, height: e.target.value });
                      if (validDimension(e.target.value))
                        setOptions({ ...options, height: Number(e.target.value) });
                    }}
                    className="h-7 text-[12px] tabular-nums"
                  />
                </div>
              </div>
            )}
            {hasDimensions && dimensionsTouched && !dimensionsValid && (
              <p role="status" className="text-[12px] text-destructive">
                Use whole sizes between 1 and 16,384 px.
              </p>
            )}
            {preview.messages.length > 0 && (
              <ul
                role="status"
                className={`space-y-1 text-[12px] leading-snug ${preview.ready ? "text-muted-foreground" : "text-destructive"}`}
              >
                {preview.messages.map((message) => (
                  <li key={message} className="flex gap-1.5">
                    <span aria-hidden>•</span>
                    {message}
                  </li>
                ))}
              </ul>
            )}
            {capabilitySummary && capabilitySummary.notes.length > 0 && (
              <details className="text-[12px] text-muted-foreground">
                <summary className="cursor-pointer select-none hover:text-foreground">
                  What this format supports
                </summary>
                <div className="mt-1.5 space-y-1 leading-snug">
                  <p>{capabilitySummary.text}</p>
                  {capabilitySummary.notes.map((note) => (
                    <p key={note}>{note}</p>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleExport}
            className="gap-1.5"
            disabled={isExporting || !preview.ready || (hasDimensions && !dimensionsValid)}
          >
            {isExporting && <Loader2 className="size-3.5 animate-spin" />}
            {isExporting ? "Exporting…" : "Export"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
