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
import { Download, Film } from "lucide-react";
import { toast } from "sonner";
import { useEditorStore } from "@/lib/store/editorStore";
import {
  exportAnimatedSVG,
  exportAnimatedVectorDrawable,
  exportCSSKeyframes,
  exportLottie,
  exportPDF,
  exportProjectJSON,
  exportStaticSVG,
  exportSvgSpritesheet,
  exportVectorDrawable,
  type ExportOptions,
} from "@/lib/shapeshifter/exporter";

interface ExportDialogProps {
  children: React.ReactNode;
}

export function ExportDialog({ children }: ExportDialogProps) {
  const { layers, selectedLayerId, vector, animation, hiddenLayerIds } = useEditorStore();
  const currentLayer = layers.find((l) => l.id === selectedLayerId) || layers[0];

  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<
    "svg" | "css" | "lottie" | "vector" | "avd" | "spritesheet" | "json" | "pdf" | "static"
  >("svg");
  const [options, setOptions] = useState<ExportOptions>({
    duration: 1.4,
    fps: 60,
    width: 512,
    height: 512,
    loop: true,
    strokeWidth: 2.8,
  });

  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    if (!currentLayer && format !== "json" && format !== "static" && format !== "pdf") {
      toast.error("No layer selected");
      return;
    }

    setIsExporting(true);
    // Pro UX: tiny simulated progress for perceived quality on longer bakes (sprites/lottie/pdf)
    await new Promise((r) => setTimeout(r, 60));

    try {
      let blob: Blob | null = null;
      let filename = "";

      const baseName = (currentLayer?.name || vector.name || "export")
        .replace(/\s+/g, "-")
        .toLowerCase();
      const allVisibleLayers = layers.filter((l) => l.visible !== false);

      switch (format) {
        case "svg":
          const svgContent = exportAnimatedSVG(
            currentLayer!.from,
            currentLayer!.to,
            currentLayer!.name,
            options,
          );
          blob = new Blob([svgContent], { type: "image/svg+xml" });
          filename = `${baseName}-morph.svg`;
          break;

        case "css":
          const cssContent = exportCSSKeyframes(
            currentLayer!.from,
            currentLayer!.to,
            currentLayer!.name,
            options.duration,
          );
          blob = new Blob([cssContent], { type: "text/css" });
          filename = `${baseName}-morph.css`;
          break;

        case "lottie":
          const lottieContent = exportLottie(
            currentLayer!.from,
            currentLayer!.to,
            currentLayer!.name,
            options.duration,
          );
          blob = new Blob([JSON.stringify(lottieContent, null, 2)], { type: "application/json" });
          filename = `${baseName}.lottie.json`;
          break;

        case "vector":
          blob = new Blob([exportVectorDrawable(currentLayer!, options)], {
            type: "application/xml",
          });
          filename = `${baseName}-vector.xml`;
          break;

        case "avd":
          blob = new Blob([exportAnimatedVectorDrawable(currentLayer!, options)], {
            type: "application/xml",
          });
          filename = `${baseName}-animated-vector.xml`;
          break;

        case "spritesheet":
          blob = new Blob([exportSvgSpritesheet(currentLayer!, options)], {
            type: "image/svg+xml",
          });
          filename = `${baseName}-spritesheet.svg`;
          break;

        case "json":
          const project = exportProjectJSON(
            layers,
            vector,
            animation,
            hiddenLayerIds,
            (useEditorStore.getState() as any).frames,
          );
          blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
          filename = `${vector.name || "shapeshifter"}.shapeshifter`;
          break;

        case "pdf":
          // Full doc PDF for professional fidelity (all visible + edits + groups)
          const pdfContent = exportPDF(
            allVisibleLayers.length ? allVisibleLayers : layers,
            options,
          );
          blob = new Blob([pdfContent], { type: "application/pdf" });
          filename = `${baseName}.pdf`;
          break;

        case "static":
          // High-fidelity static SVG export (groups, transforms, clips, pathData post-tool edits)
          const staticContent = exportStaticSVG(
            allVisibleLayers.length ? allVisibleLayers : layers,
            options,
          );
          blob = new Blob([staticContent], { type: "image/svg+xml" });
          filename = `${baseName}-static.svg`;
          break;
      }

      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        toast.success(`Exported ${format.toUpperCase()}`, {
          description: filename,
        });
        setOpen(false);
      }
    } catch (error) {
      // Outstanding error recovery + partial UX (kus): never hard crash, always toast actionable
      toast.error("Export failed", {
        description: String(error) || "Partial export may have succeeded; check downloads.",
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={children as React.ReactElement} />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="w-5 h-5" />
            Export Animation
          </DialogTitle>
          <DialogDescription>
            Export your morph as production-ready assets. Real interpolation powered by the same
            engine as the preview.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Format Selection */}
          <div>
            <Label className="text-xs font-medium tracking-widest">FORMAT</Label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(
                [
                  "svg",
                  "css",
                  "lottie",
                  "vector",
                  "avd",
                  "spritesheet",
                  "json",
                  "pdf",
                  "static",
                ] as const
              ).map((f) => (
                <Button
                  key={f}
                  variant={format === f ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFormat(f)}
                  className="font-mono text-xs capitalize"
                >
                  {f === "static" ? "static svg" : f}
                </Button>
              ))}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1.5">
              {format === "svg" && "Self-contained animated SVG with JS • Best quality"}
              {format === "css" && "Pure CSS keyframes • Zero JS"}
              {format === "lottie" && "Lottie JSON for apps and motion pipelines"}
              {format === "vector" && "Android Vector Drawable XML"}
              {format === "avd" && "Animated Vector Drawable XML bundle"}
              {format === "spritesheet" && "Frame-by-frame SVG spritesheet"}
              {format === "json" && "Full project backup (all layers + frames for freeform)"}
              {format === "pdf" && "Vector PDF (professional print/roundtrip fidelity)"}
              {format === "static" &&
                "High-fidelity static SVG (groups, transforms, clips, current edits)"}
            </div>
          </div>

          {/* Options */}
          {format !== "json" && (
            <div className="space-y-4">
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
                  onValueChange={(v) =>
                    setOptions({ ...options, duration: Array.isArray(v) ? v[0] : v })
                  }
                />
              </div>

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
                  onValueChange={(v) =>
                    setOptions({ ...options, strokeWidth: Array.isArray(v) ? v[0] : v })
                  }
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Width</Label>
                  <Input
                    type="number"
                    value={options.width}
                    onChange={(e) =>
                      setOptions({ ...options, width: parseInt(e.target.value) || 512 })
                    }
                    className="h-8 mt-1 font-mono"
                  />
                </div>
                <div>
                  <Label className="text-xs">Height</Label>
                  <Input
                    type="number"
                    value={options.height}
                    onChange={(e) =>
                      setOptions({ ...options, height: parseInt(e.target.value) || 512 })
                    }
                    className="h-8 mt-1 font-mono"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleExport} className="gap-2" disabled={isExporting}>
            <Film className="w-4 h-4" />
            {isExporting
              ? "Exporting..."
              : `Export ${format === "static" ? "STATIC SVG" : format.toUpperCase()}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
