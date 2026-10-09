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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { ChevronRight, Info, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { recordExerciseExport } from "./animationExercise";
import { toast } from "sonner";
import { useEditorStore } from "@/lib/store/editorStore";
import { type ExportOptions } from "@/lib/pathshift/exporter";
import {
  exportLiveDocument,
  resolveExportOptions,
  type LiveExportResult,
  LIVE_EXPORT_SCOPE,
  summarizeAndroidWarnings,
  type LiveExportKind,
} from "@/lib/store/exportDocument";
import { CAPABILITY_MATRIX, type ExportFormatId } from "@/lib/pathshift/formatCapabilities";

interface ExportDialogProps {
  children: React.ReactNode;
}

export function ExportDialog({ children }: ExportDialogProps) {
  const layers = useEditorStore((state) => state.layers);
  const selectedLayerId = useEditorStore((state) => state.selectedLayerId);
  const vector = useEditorStore((state) => state.vector);
  const isRepeating = useEditorStore((state) => state.isRepeating);
  const animation = useEditorStore((state) => state.animation);
  const frames = useEditorStore((state) => state.frames);
  const selectedFrameId = useEditorStore((state) => state.selectedFrameId);
  const currentLayer = layers.find((l) => String(l.id) === String(selectedLayerId)) || layers[0];
  const selectedFrame = frames.find((frame) => frame.id === selectedFrameId);

  const [open, setOpen] = useState(false);
  const storedFormat = useEditorStore((state) => state.preferredExportFormat);
  const setPreferredExportFormat = useEditorStore((state) => state.setPreferredExportFormat);
  const [format, setFormat] = useState(storedFormat);
  const [overrides, setOptions] = useState<ExportOptions>({});
  const options = React.useMemo(
    () =>
      resolveExportOptions(
        { layers, vector, animation, state: useEditorStore.getState() },
        overrides,
      ),
    [layers, vector, animation, selectedLayerId, isRepeating, overrides],
  );
  const [dimensionDrafts, setDimensions] = useState<{ width: string; height: string } | null>(null);
  const dimensions = dimensionDrafts ?? {
    width: String(options.width),
    height: String(options.height),
  };
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
  const [generated, setGenerated] = useState<LiveExportResult | null>(null);
  const [artworkPreview, setArtworkPreview] = useState<string | null>(null);
  const [showDemos, setShowDemos] = useState(false);
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setGenerated(null);
    setPreview({ ready: false, messages: ["Generating output preview…"] });
    exportLiveDocument(format as LiveExportKind, options)
      .then((result) => {
        if (cancelled) return;
        setGenerated(result);
        const diagnostics = [
          ...result.androidDiagnostics,
          ...result.staticDiagnostics,
          ...result.formatDiagnostics,
        ];
        setPreview({
          ready: !result.androidDiagnostics.some((d) => d.severity === "error"),
          messages: [...new Set(diagnostics.map((d) => d.message))],
        });
      })
      .catch((error) => {
        if (!cancelled)
          setPreview({
            ready: false,
            messages: [
              error instanceof Error ? error.message : "This document could not be exported.",
            ],
          });
      });
    return () => {
      cancelled = true;
    };
  }, [open, format, selectedFrameId, selectedLayerId, layers, animation, vector, frames, options]);

  // Every artwork format gets a visual: the artboard's first pose as a static SVG.
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    exportLiveDocument("static", options)
      .then((result) => {
        if (!cancelled && typeof result.content === "string")
          setArtworkPreview(
            `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.content)}`,
          );
      })
      .catch(() => {
        if (!cancelled) setArtworkPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, selectedFrameId, layers, animation, vector, frames, options]);

  const formatOptions: Array<{
    key: typeof format;
    label: string;
    hint: string;
    beta?: boolean;
    experimental?: boolean;
  }> = [
    { key: "avd", label: "Animated Vector", hint: "Android · AVD XML" },
    { key: "vector", label: "Vector Drawable", hint: "Android · Static XML" },
    { key: "svg", label: "Morph SVG", hint: "Restyled endpoints", experimental: true },
    { key: "static", label: "SVG", hint: "Web · Static" },
    { key: "css", label: "Morph CSS", hint: "Endpoint geometry", experimental: true },
    { key: "lottie", label: "Lottie", hint: "JSON", beta: true },
    { key: "pdf", label: "PDF", hint: "Print", beta: true },
    {
      key: "spritesheet",
      label: "Sprite sheet",
      hint: "Endpoint frames",
      experimental: true,
    },
    { key: "json", label: "Pathshift project", hint: "Reopen and keep editing" },
  ];

  const svgOutput =
    generated?.mimeType === "image/svg+xml" && typeof generated.content === "string"
      ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(generated.content)}`
      : null;
  const demo = ["svg", "css", "spritesheet"].includes(format);
  const demosOpen = showDemos || demo;
  const outputSize = generated ? new Blob([generated.content as BlobPart]).size : null;
  const scopeLabel = demo
    ? `Selected path · ${currentLayer?.name ?? "No path selected"}`
    : format === "json"
      ? "Whole document"
      : `${selectedFrameId === "__page_root__" ? "Page" : "Artboard"} · ${selectedFrame?.name || vector.name}`;
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
        recordExerciseExport(exported.live.state.selectedFrameId, format);
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);

        if (androidWarningSummary) {
          const warningLabel = androidWarningSummary.count === 1 ? "warning" : "warnings";
          toast.warning(
            `Exported ${format.toUpperCase()} with ${androidWarningSummary.count} ${warningLabel}`,
            {
              description:
                format === "avd"
                  ? `${androidWarningSummary.description} Full details are in PATHSHIFT_EXPORT.txt.`
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

  const hasOptions = ["svg", "css", "spritesheet", "static", "pdf"].includes(format);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={children as React.ReactElement} />
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[520px]">
        <DialogHeader className="gap-0.5 px-5 pt-4 pb-3">
          <DialogTitle className="text-[15px]">Export</DialogTitle>
          <DialogDescription className="text-[12px]">{scopeLabel}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-4">
          <figure className="overflow-hidden rounded-xl bg-secondary/60 ring-1 ring-border">
            <div className="flex h-40 items-center justify-center bg-white bg-[conic-gradient(#ececec_25%,transparent_0_50%,#ececec_0_75%,transparent_0)] bg-[length:16px_16px] p-4">
              {demo && svgOutput && format === "svg" ? (
                <iframe
                  title="Generated morph demo preview"
                  sandbox="allow-scripts"
                  src={svgOutput}
                  className="size-full rounded-md"
                />
              ) : demo && svgOutput ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={svgOutput}
                  alt="Generated SVG output"
                  className="size-full object-contain"
                />
              ) : demo && generated && typeof generated.content === "string" ? (
                <pre
                  aria-label="Generated export output"
                  className="size-full overflow-auto rounded-md bg-background/80 p-2 text-[11px]"
                >
                  {generated.content.slice(0, 6000)}
                </pre>
              ) : artworkPreview && !demo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={artworkPreview}
                  alt={`Preview of ${selectedFrame?.name || vector.name}`}
                  className="size-full object-contain drop-shadow-sm"
                />
              ) : (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              )}
            </div>
            <figcaption className="flex items-center gap-2 border-t border-border px-3 py-2 text-[12px]">
              <span className="min-w-0 flex-1 truncate font-medium">
                {generated?.filename ?? "Preparing file…"}
              </span>
              {outputSize != null && (
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatBytes(outputSize)}
                </span>
              )}
            </figcaption>
          </figure>
          {demo && (
            <p className="rounded-lg bg-secondary p-3 text-[12px] leading-relaxed text-muted-foreground">
              Experimental morph demo. Uses this path’s From → To geometry, with separate styling
              and timing. It does not export authored fills, transforms, masks, or timeline motion.
              {format === "svg" &&
                " Includes a dark background, ghost endpoints, a colored outline, and demo easing."}
            </p>
          )}

          <div role="radiogroup" aria-label="Export format" className="space-y-2">
            <div className="grid grid-cols-2 gap-1.5">
              {formatOptions
                .filter((item) => !item.experimental)
                .map((item) => (
                  <FormatOption
                    key={item.key}
                    item={item}
                    selected={format === item.key}
                    onSelect={() => {
                      setFormat(item.key);
                      setPreferredExportFormat(item.key);
                    }}
                  />
                ))}
            </div>
            <button
              type="button"
              aria-expanded={demosOpen}
              onClick={() => setShowDemos(!demosOpen)}
              disabled={demo}
              className="flex items-center gap-1 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none"
            >
              <ChevronRight
                className={cn("size-3.5 transition-transform", demosOpen && "rotate-90")}
              />
              Experimental morph demos
            </button>
            {demosOpen && (
              <div className="grid grid-cols-3 gap-1.5">
                {formatOptions
                  .filter((item) => item.experimental)
                  .map((item) => (
                    <FormatOption
                      key={item.key}
                      item={item}
                      selected={format === item.key}
                      onSelect={() => {
                        setFormat(item.key);
                        setPreferredExportFormat(item.key);
                      }}
                    />
                  ))}
              </div>
            )}
          </div>

          {hasOptions && (
            <div className="space-y-3">
              {["svg", "css", "spritesheet"].includes(format) &&
                sliderRow("Duration", options.duration, "s", {
                  min: 0.4,
                  max: 4,
                  ariaLabel: "Export duration in seconds",
                  onChange: (duration) => setOptions({ ...overrides, duration }),
                })}
              {["svg", "spritesheet"].includes(format) &&
                sliderRow("Stroke width", options.strokeWidth, "px", {
                  min: 0.5,
                  max: 8,
                  ariaLabel: "Export stroke width",
                  onChange: (strokeWidth) => setOptions({ ...overrides, strokeWidth }),
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
                    <SizeField
                      id="export-width"
                      label="Width"
                      prefix="W"
                      value={dimensions.width}
                      invalid={dimensionsTouched && !validDimension(dimensions.width)}
                      onBlur={() => setDimensionsTouched(true)}
                      onChange={(value) => {
                        setDimensions({ ...dimensions, width: value });
                        if (validDimension(value))
                          setOptions({ ...overrides, width: Number(value) });
                      }}
                    />
                    <SizeField
                      id="export-height"
                      label="Height"
                      prefix="H"
                      value={dimensions.height}
                      invalid={dimensionsTouched && !validDimension(dimensions.height)}
                      onBlur={() => setDimensionsTouched(true)}
                      onChange={(value) => {
                        setDimensions({ ...dimensions, height: value });
                        if (validDimension(value))
                          setOptions({ ...overrides, height: Number(value) });
                      }}
                    />
                  </div>
                </div>
              )}
              {hasDimensions && dimensionsTouched && !dimensionsValid && (
                <p role="status" className="text-[12px] text-destructive">
                  Use whole sizes between 1 and 16,384 px.
                </p>
              )}
            </div>
          )}

          {preview.messages.length > 0 && (
            <ul
              role="status"
              className={cn(
                "space-y-1 rounded-lg px-3 py-2 text-[12px] leading-snug",
                preview.ready
                  ? "bg-secondary/70 text-muted-foreground"
                  : "bg-destructive/10 text-destructive",
              )}
            >
              {preview.messages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-border px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {capabilitySummary && capabilitySummary.notes.length > 0 ? (
            <Popover>
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
                  />
                }
              >
                <Info className="size-3.5" />
                What’s supported
              </PopoverTrigger>
              <PopoverContent side="top" align="start" className="w-72 space-y-1.5 text-[12px]">
                <p className="font-medium">{capabilitySummary.text}</p>
                {capabilitySummary.notes.map((note) => (
                  <p key={note} className="text-muted-foreground">
                    {note}
                  </p>
                ))}
              </PopoverContent>
            </Popover>
          ) : null}
          <Button
            onClick={handleExport}
            className="ml-auto h-8 min-w-24 gap-1.5 px-4 text-[13px]"
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

function SizeField({
  id,
  label,
  prefix,
  value,
  invalid,
  onBlur,
  onChange,
}: {
  id: string;
  label: string;
  prefix: string;
  value: string;
  invalid: boolean;
  onBlur: () => void;
  onChange: (value: string) => void;
}) {
  return (
    <label className="relative block min-w-0 flex-1">
      <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-[11px] text-muted-foreground">
        {prefix}
      </span>
      <input
        id={id}
        inputMode="numeric"
        aria-label={label}
        aria-invalid={invalid || undefined}
        value={value}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value.replace(/[^\d]/g, ""))}
        className="h-7 w-full rounded-md border border-transparent bg-secondary pr-2 pl-6 text-[12px] tabular-nums outline-none hover:border-border focus:border-primary aria-invalid:border-destructive"
      />
    </label>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FormatOption({
  item,
  selected,
  onSelect,
}: {
  item: { label: string; hint: string; beta?: boolean };
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex min-w-0 flex-col items-start rounded-lg px-3 py-2 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "bg-primary/10 shadow-[inset_0_0_0_1.5px_var(--primary)]"
          : "shadow-[inset_0_0_0_1px_var(--border)] hover:bg-muted",
      )}
    >
      <span className="flex w-full items-center gap-1.5 text-[12px] leading-tight font-medium">
        <span className="truncate">{item.label}</span>
        {item.beta && (
          <span className="rounded bg-muted px-1 py-px text-[10px] font-medium text-muted-foreground">
            Beta
          </span>
        )}
      </span>
      <span className="mt-0.5 w-full truncate text-[11px] leading-tight text-muted-foreground">
        {item.hint}
      </span>
    </button>
  );
}
