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
import { Download, Film, FileCode2, FileJson, FileImage, FileText, Loader2 } from "lucide-react";
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

  // Compact format config for a quick visual scan.
  const formats = [
    {
      key: "avd" as const,
      label: "Android AVD",
      hint: "Vector + motion ZIP",
      icon: <FileCode2 className="h-3.5 w-3.5" />,
    },
    {
      key: "vector" as const,
      label: "Vector XML",
      hint: "Android static",
      icon: <FileText className="h-3.5 w-3.5" />,
    },
    {
      key: "json" as const,
      label: "Project",
      hint: "Project backup",
      icon: <FileJson className="h-3.5 w-3.5" />,
    },
    {
      key: "static" as const,
      label: "Static SVG",
      hint: "Base artwork",
      icon: <FileImage className="h-3.5 w-3.5" />,
    },
    {
      key: "svg" as const,
      label: "Animated SVG",
      hint: "Selected layer morph",
      icon: <FileCode2 className="h-3.5 w-3.5" />,
    },
    {
      key: "css" as const,
      label: "CSS",
      hint: "Selected layer morph",
      icon: <FileCode2 className="h-3.5 w-3.5" />,
    },
    {
      key: "lottie" as const,
      label: "Lottie",
      hint: "Experimental",
      icon: <FileJson className="h-3.5 w-3.5" />,
    },
    {
      key: "spritesheet" as const,
      label: "Spritesheet",
      hint: "Experimental",
      icon: <FileImage className="h-3.5 w-3.5" />,
    },
    {
      key: "pdf" as const,
      label: "PDF",
      hint: "Experimental",
      icon: <FileText className="h-3.5 w-3.5" />,
    },
  ] as const;

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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={children as React.ReactElement} />
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="w-5 h-5" />
            Export
          </DialogTitle>
          <DialogDescription>
            Export the active artboard or back up the whole project. Animated SVG, CSS, and
            spritesheets use the selected layer’s morph endpoints.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Format picker with icons and concise capability hints. */}
          <div>
            <Label className="text-xs font-medium tracking-widest">FORMAT</Label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {formats.map((f) => (
                <Button
                  key={f.key}
                  variant={format === f.key ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setFormat(f.key);
                    setPreferredExportFormat(f.key);
                  }}
                  className="h-auto flex-col items-start gap-0.5 py-2 text-left font-normal"
                  aria-pressed={format === f.key}
                >
                  <div className="flex w-full items-center gap-1.5 text-xs font-mono">
                    {f.icon}
                    <span className="capitalize">{f.label}</span>
                  </div>
                  <div className="text-[10px] opacity-70 font-normal normal-case tracking-tight">
                    {f.hint}
                  </div>
                </Button>
              ))}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1.5 pl-0.5">
              {formats.find((f) => f.key === format)?.hint || "Production-ready export"}
              {capabilitySummary && (
                <details className="mt-2">
                  <summary className="cursor-pointer py-1">Target capabilities</summary>
                  {capabilitySummary.text}
                  {capabilitySummary.notes.map((note) => (
                    <div key={note}>{note}</div>
                  ))}
                </details>
              )}
            </div>
          </div>

          {/* Options */}
          {["vector", "avd", "static", "pdf", "lottie"].includes(format) && (
            <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Artboard
                </div>
                <div className="mt-1 truncate font-medium">
                  {selectedFrame?.name || vector.name}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Viewport
                </div>
                <div className="mt-1 font-mono">
                  {viewportSize.width} × {viewportSize.height}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Motion
                </div>
                <div className="mt-1 font-mono">
                  {["avd", "lottie"].includes(format)
                    ? `${androidTrackCount} tracks`
                    : "Base artwork"}
                </div>
              </div>
            </div>
          )}

          {!["json", "vector", "avd", "lottie"].includes(format) && (
            <div className="space-y-4">
              {["svg", "css", "spritesheet"].includes(format) && (
                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <Label>Duration</Label>
                    <span className="font-mono text-primary">{options.duration}s</span>
                  </div>
                  <Slider
                    value={[options.duration || 1.4]}
                    min={0.4}
                    max={4}
                    step={0.1}
                    aria-label="Export duration in seconds"
                    onValueChange={(v) =>
                      setOptions({ ...options, duration: Array.isArray(v) ? v[0] : v })
                    }
                  />
                </div>
              )}

              {["svg", "spritesheet"].includes(format) && (
                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <Label>Stroke Width</Label>
                    <span className="font-mono text-primary">{options.strokeWidth}px</span>
                  </div>
                  <Slider
                    value={[options.strokeWidth || 2.8]}
                    min={0.5}
                    max={8}
                    step={0.1}
                    aria-label="Export stroke width"
                    onValueChange={(v) =>
                      setOptions({ ...options, strokeWidth: Array.isArray(v) ? v[0] : v })
                    }
                  />
                </div>
              )}

              {format !== "css" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="export-width" className="text-xs">
                      Width
                    </Label>
                    <Input
                      id="export-width"
                      type="number"
                      min={1}
                      max={16384}
                      step={1}
                      value={dimensions.width}
                      aria-invalid={dimensionsTouched && !validDimension(dimensions.width)}
                      onBlur={() => setDimensionsTouched(true)}
                      onChange={(e) => {
                        setDimensions({ ...dimensions, width: e.target.value });
                        if (validDimension(e.target.value))
                          setOptions({ ...options, width: Number(e.target.value) });
                      }}
                      className="h-8 mt-1 font-mono"
                    />
                  </div>
                  <div>
                    <Label htmlFor="export-height" className="text-xs">
                      Height
                    </Label>
                    <Input
                      id="export-height"
                      type="number"
                      min={1}
                      max={16384}
                      step={1}
                      value={dimensions.height}
                      aria-invalid={dimensionsTouched && !validDimension(dimensions.height)}
                      onBlur={() => setDimensionsTouched(true)}
                      onChange={(e) => {
                        setDimensions({ ...dimensions, height: e.target.value });
                        if (validDimension(e.target.value))
                          setOptions({ ...options, height: Number(e.target.value) });
                      }}
                      className="h-8 mt-1 font-mono"
                    />
                  </div>
                </div>
              )}
              {hasDimensions && dimensionsTouched && !dimensionsValid && (
                <p role="status" className="text-xs text-destructive">
                  Use whole dimensions between 1 and 16,384 pixels.
                </p>
              )}
            </div>
          )}
          {preview.messages.length > 0 && (
            <div
              role="status"
              className={`space-y-2 rounded-lg border p-3 text-xs leading-relaxed ${preview.ready ? "border-border bg-muted/40" : "border-destructive/30 text-destructive"}`}
            >
              <p className="font-medium">
                {preview.ready ? "Export fidelity" : "Resolve these issues before exporting"}
              </p>
              <ul className="list-disc space-y-1 pl-4">
                {preview.messages.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleExport}
            className="gap-2"
            disabled={isExporting || !preview.ready || (hasDimensions && !dimensionsValid)}
          >
            {isExporting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Film className="w-4 h-4" />
            )}
            {isExporting
              ? "Exporting..."
              : `Export ${format === "static" ? "STATIC SVG" : format.toUpperCase()}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
