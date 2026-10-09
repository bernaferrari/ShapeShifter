"use client";

import React from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useEditorStore } from "@/lib/store/editorStore";
import type { CanvasFrame } from "@/lib/store/defaultWorkspace";
import { exportStaticSVGWithDiagnostics } from "@/lib/pathshift/exporter";
import {
  BLANK_PRESETS,
  MAX_ARTBOARD_SIZE,
  PROJECT_TEMPLATES,
  createBlankFrames,
  type ProjectTemplate,
} from "@/lib/store/projectTemplates";

type Choice = { kind: "blank"; id: string } | { kind: "template"; id: string };

const CUSTOM_ID = "custom";
const DEFAULT_CHOICE: Choice = { kind: "blank", id: BLANK_PRESETS[0]!.id };

/**
 * Modeled on Adobe's New Document dialog: blank sizes and templates on the left,
 * the chosen preset's details and Create on the right. Double-click creates.
 */
export function NewProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [choice, setChoice] = React.useState<Choice>(DEFAULT_CHOICE);
  const [name, setName] = React.useState("Untitled");
  const [size, setSize] = React.useState({ width: "24", height: "24" });

  React.useEffect(() => {
    if (!open) return;
    setChoice(DEFAULT_CHOICE);
    setName("Untitled");
    setSize({ width: "24", height: "24" });
  }, [open]);

  // Template frames are built once per dialog session; thumbnails and Create share them.
  const templateFrames = React.useMemo(
    () => (open ? new Map(PROJECT_TEMPLATES.map((t) => [t.id, t.frames()])) : null),
    [open],
  );

  const template =
    choice.kind === "template" ? PROJECT_TEMPLATES.find((item) => item.id === choice.id) : null;
  const width = Number(size.width);
  const height = Number(size.height);
  const validSize = (value: number) =>
    Number.isInteger(value) && value >= 1 && value <= MAX_ARTBOARD_SIZE;
  const canCreate = template ? true : validSize(width) && validSize(height) && !!name.trim();

  const pickBlank = (id: string) => {
    setChoice({ kind: "blank", id });
    const preset = BLANK_PRESETS.find((item) => item.id === id);
    if (preset) setSize({ width: String(preset.width), height: String(preset.height) });
  };
  const editSize = (next: { width: string; height: string }) => {
    setSize(next);
    // Like Photoshop: typing a size that no preset matches becomes Custom.
    const match = BLANK_PRESETS.find(
      (item) => String(item.width) === next.width && String(item.height) === next.height,
    );
    setChoice({ kind: "blank", id: match?.id ?? CUSTOM_ID });
  };

  const create = (override?: Choice) => {
    const target = override ?? choice;
    const store = useEditorStore.getState();
    let label: string;
    if (target.kind === "template") {
      const picked = PROJECT_TEMPLATES.find((item) => item.id === target.id)!;
      store.resetProject(templateFrames?.get(picked.id) ?? picked.frames());
      store.setTimelineCollapsed(false);
      label = picked.title;
    } else {
      if (!canCreate) return;
      const artboardName = name.trim() || "Untitled";
      store.resetProject(createBlankFrames(artboardName, width, height));
      label = artboardName;
    }
    onOpenChange(false);
    toast.success(`Created “${label}”`, {
      description: "Your previous project is one undo away.",
      action: { label: "Undo", onClick: () => useEditorStore.getState().undo() },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(680px,calc(100dvh-4rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[860px]">
        <DialogHeader className="gap-0.5 border-b border-border px-5 pt-4 pb-3">
          <DialogTitle className="text-[15px]">New project</DialogTitle>
          <DialogDescription className="text-[12px]">
            Start from a blank artboard or a ready-made animation.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
            <section aria-labelledby="new-project-blank" className="space-y-2">
              <h3 id="new-project-blank" className="text-[12px] font-medium">
                Blank
              </h3>
              <div
                role="radiogroup"
                aria-labelledby="new-project-blank"
                className="grid grid-cols-2 gap-2 sm:grid-cols-4"
              >
                {BLANK_PRESETS.map((preset) => (
                  <PresetCard
                    key={preset.id}
                    selected={choice.kind === "blank" && choice.id === preset.id}
                    onSelect={() => pickBlank(preset.id)}
                    onActivate={() => create({ kind: "blank", id: preset.id })}
                    title={preset.name}
                    meta={`${preset.width} × ${preset.height} dp`}
                    preview={<BlankArtboard size={preset.width} />}
                  />
                ))}
                <PresetCard
                  selected={choice.kind === "blank" && choice.id === CUSTOM_ID}
                  onSelect={() => setChoice({ kind: "blank", id: CUSTOM_ID })}
                  title="Custom"
                  meta="Any size"
                  preview={
                    <span className="grid size-12 place-items-center rounded-md border border-dashed border-muted-foreground/50 text-muted-foreground">
                      <Plus className="size-4" />
                    </span>
                  }
                />
              </div>
            </section>

            <section aria-labelledby="new-project-templates" className="space-y-2">
              <h3 id="new-project-templates" className="text-[12px] font-medium">
                Templates
              </h3>
              <div
                role="radiogroup"
                aria-labelledby="new-project-templates"
                className="grid grid-cols-2 gap-2 sm:grid-cols-3"
              >
                {PROJECT_TEMPLATES.map((item) => {
                  const frames = templateFrames?.get(item.id) ?? [];
                  return (
                    <PresetCard
                      key={item.id}
                      selected={choice.kind === "template" && choice.id === item.id}
                      onSelect={() => setChoice({ kind: "template", id: item.id })}
                      onActivate={() => create({ kind: "template", id: item.id })}
                      title={item.title}
                      meta={templateMeta(frames)}
                      preview={<TemplateThumbnail frames={frames} />}
                    />
                  );
                })}
              </div>
            </section>
          </div>

          <form
            className="flex shrink-0 flex-col gap-4 border-t border-border bg-sidebar p-5 md:w-64 md:border-t-0 md:border-l"
            onSubmit={(event) => {
              event.preventDefault();
              create();
            }}
          >
            <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              Preset details
            </p>
            {template ? (
              <TemplateDetails
                template={template}
                frames={templateFrames?.get(template.id) ?? []}
              />
            ) : (
              <div className="space-y-3">
                <label className="block space-y-1.5">
                  <span className="text-[12px] text-muted-foreground">Artboard name</span>
                  <input
                    value={name}
                    maxLength={80}
                    onChange={(event) => setName(event.target.value)}
                    className="h-8 w-full rounded-md border border-transparent bg-secondary px-2.5 text-[13px] outline-none hover:border-border focus:border-primary"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <SizeInput
                    label="Width"
                    value={size.width}
                    invalid={!validSize(width)}
                    onChange={(value) => editSize({ ...size, width: value })}
                  />
                  <SizeInput
                    label="Height"
                    value={size.height}
                    invalid={!validSize(height)}
                    onChange={(value) => editSize({ ...size, height: value })}
                  />
                </div>
                {(!validSize(width) || !validSize(height)) && (
                  <p role="status" className="text-[12px] text-destructive">
                    Use whole sizes from 1 to {MAX_ARTBOARD_SIZE.toLocaleString()} dp.
                  </p>
                )}
              </div>
            )}
            <div className="mt-auto flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" className="min-w-20" disabled={!canCreate}>
                Create
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function templateMeta(frames: CanvasFrame[]) {
  if (!frames.length) return "";
  const first = frames[0]!.vector;
  const count =
    frames.length === 1 ? `${first.width} × ${first.height} dp` : `${frames.length} artboards`;
  const seconds = Math.max(...frames.map((frame) => frame.animation.duration)) / 1000;
  return `${count} · ${seconds.toLocaleString(undefined, { maximumFractionDigits: 1 })} s`;
}

function PresetCard({
  selected,
  onSelect,
  onActivate,
  title,
  meta,
  preview,
}: {
  selected: boolean;
  onSelect: () => void;
  onActivate?: () => void;
  title: string;
  meta: string;
  preview: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      onDoubleClick={onActivate}
      className={cn(
        "group flex min-w-0 flex-col overflow-hidden rounded-xl text-left transition-[background-color,box-shadow] outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-popover",
        selected
          ? "bg-primary/10 shadow-[inset_0_0_0_1.5px_var(--primary)]"
          : "shadow-[inset_0_0_0_1px_var(--border)] hover:bg-muted/60",
      )}
    >
      <span className="m-1 mb-0 grid h-[88px] place-items-center rounded-lg bg-muted/70">
        {preview}
      </span>
      <span className="px-3 pt-2 pb-2.5">
        <span className="block truncate text-[12px] font-medium">{title}</span>
        <span className="block truncate text-[11px] text-muted-foreground tabular-nums">
          {meta}
        </span>
      </span>
    </button>
  );
}

/** A white artboard whose size hints at the preset's scale. */
function BlankArtboard({ size }: { size: number }) {
  const edge = Math.round(18 + (Math.min(size, 108) / 108) * 38);
  return (
    <span
      className="rounded-[3px] bg-white shadow-[0_1px_2px_rgb(0_0_0/0.25)]"
      style={{ width: edge, height: edge }}
    />
  );
}

/** Up to three of the template's artboards, rendered from their real artwork. */
function TemplateThumbnail({ frames }: { frames: CanvasFrame[] }) {
  const sources = React.useMemo(
    () =>
      frames.slice(0, 3).map((frame) => {
        const vector = frame.vector;
        const { svg } = exportStaticSVGWithDiagnostics(frame.layers, {
          width: 96,
          height: 96,
          viewBoxWidth: vector.viewportWidth ?? vector.width,
          viewBoxHeight: vector.viewportHeight ?? vector.height,
          rootVector: vector,
        });
        return { id: frame.id, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` };
      }),
    [frames],
  );
  return (
    <span className="flex items-center gap-1.5">
      {sources.map((source) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={source.id}
          src={source.src}
          alt=""
          className={cn(
            "rounded-[3px] bg-white object-contain p-1 shadow-[0_1px_2px_rgb(0_0_0/0.25)]",
            sources.length > 1 ? "size-12" : "size-16",
          )}
        />
      ))}
    </span>
  );
}

function TemplateDetails({
  template,
  frames,
}: {
  template: ProjectTemplate;
  frames: CanvasFrame[];
}) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-[13px] font-medium">{template.title}</p>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          {template.description}
        </p>
      </div>
      <dl className="space-y-1.5 text-[12px]">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Artboards</dt>
          <dd className="tabular-nums">{frames.length}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Size</dt>
          <dd className="tabular-nums">
            {frames[0] ? `${frames[0].vector.width} × ${frames[0].vector.height} dp` : "—"}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Layers</dt>
          <dd className="tabular-nums">
            {frames.reduce((total, frame) => total + frame.layers.length, 0)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function SizeInput({
  label,
  value,
  invalid,
  onChange,
}: {
  label: string;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className="relative block">
        <input
          inputMode="numeric"
          aria-label={label}
          aria-invalid={invalid || undefined}
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/[^\d]/g, ""))}
          className="h-8 w-full rounded-md border border-transparent bg-secondary pr-8 pl-2.5 text-[13px] tabular-nums outline-none hover:border-border focus:border-primary aria-invalid:border-destructive"
        />
        <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[11px] text-muted-foreground">
          dp
        </span>
      </span>
    </label>
  );
}
