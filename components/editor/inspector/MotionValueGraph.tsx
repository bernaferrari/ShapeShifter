"use client";

import React from "react";
import { ChevronRight } from "lucide-react";
import { propertyLabel } from "@/lib/shapeshifter/propertyLabels";
import {
  buildMotionValueGraph,
  canGraphMotionSegment,
  formatMotionGraphNumber,
  type NumericMotionSegment,
} from "@/lib/shapeshifter/motion/motionValueGraph";
import { cn } from "@/lib/utils";

type GraphView = "value" | "velocity";
const plot = { left: 47, right: 258, top: 23, bottom: 113 };
const formatDetail = (value: number) => Number(value.toPrecision(12)).toString();

const MotionGraphPlot = React.memo(function MotionGraphPlot({
  block,
  view,
}: {
  block: NumericMotionSegment;
  view: GraphView;
}) {
  const id = React.useId();
  const data = React.useMemo(
    () => buildMotionValueGraph(block),
    [
      block.propertyName,
      block.fromValue,
      block.toValue,
      block.startTime,
      block.endTime,
      block.interpolator,
      block.type,
    ],
  );
  if (!data)
    return (
      <p role="status" className="text-[10px] text-muted-foreground">
        Graph values exceed the display range.
      </p>
    );
  const label = propertyLabel(block.propertyName);
  const axis = view === "value" ? data.valueAxis : data.velocityAxis;
  const unit = data.unit[view];
  const sampled = data.samples.map((sample) => sample[view]);
  const rangeDescription = `${view === "value" ? "Sampled values" : "Sampled velocities"} range from ${formatMotionGraphNumber(Math.min(...sampled))} to ${formatMotionGraphNumber(Math.max(...sampled))} ${unit}.`;
  const x = (progress: number) => plot.left + progress * (plot.right - plot.left);
  const y = (value: number) =>
    plot.bottom - ((value - axis.min) / (axis.max - axis.min)) * (plot.bottom - plot.top);
  const d = data.samples
    .map((sample, index) => `${index ? "L" : "M"}${x(sample.progress)} ${y(sample[view])}`)
    .join(" ");
  const paintLimit = ["alpha", "fillAlpha", "strokeAlpha"].includes(block.propertyName)
    ? "Property values before opacity limits."
    : block.propertyName.startsWith("trimPath")
      ? "Property values before trim wrapping."
      : data.unit.value === "units"
        ? "Spatial values use viewport units."
        : "Values follow this segment's easing.";
  return (
    <figure className="space-y-1.5">
      <svg
        role="img"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        viewBox="0 0 270 145"
        className="block w-full overflow-visible"
      >
        <title id={`${id}-title`}>{`${label} ${view} graph (${unit})`}</title>
        <desc id={`${id}-description`}>
          {`${label} changes from ${formatDetail(data.from)} to ${formatDetail(data.to)} ${data.unit.value}, between ${formatDetail(block.startTime)} and ${formatDetail(block.endTime)} milliseconds. ${rangeDescription} ${view === "velocity" ? "Sampled velocity measures change per second. " : ""}${paintLimit}`}
        </desc>
        <g aria-hidden="true" className="fill-muted-foreground font-mono text-[9px] tabular-nums">
          <text x={plot.left} y={11}>{`${view === "value" ? "Value" : "Velocity"} (${unit})`}</text>
          {axis.ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={plot.left}
                x2={plot.right}
                y1={y(tick)}
                y2={y(tick)}
                className={tick === 0 ? "stroke-border" : "stroke-border/55"}
                vectorEffect="non-scaling-stroke"
              />
              <text x={plot.left - 6} y={y(tick) + 3} textAnchor="end">
                {formatMotionGraphNumber(tick)}
              </text>
            </g>
          ))}
          {[0, 0.5, 1].map((progress) => (
            <g key={progress}>
              <line
                x1={x(progress)}
                x2={x(progress)}
                y1={plot.top}
                y2={plot.bottom}
                className="stroke-border/40"
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={x(progress)}
                y={plot.bottom + 13}
                textAnchor={progress === 0 ? "start" : progress === 1 ? "end" : "middle"}
              >
                {formatMotionGraphNumber(block.startTime + progress * data.durationMs)}
              </text>
            </g>
          ))}
          <text x={(plot.left + plot.right) / 2} y={141} textAnchor="middle">
            Time (ms)
          </text>
        </g>
        <path
          data-motion-value-curve={view}
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          vectorEffect="non-scaling-stroke"
          className="text-primary"
        />
      </svg>
      <figcaption className="flex flex-wrap justify-between gap-x-2 gap-y-1 text-[9px] text-muted-foreground">
        <span>{`${formatDetail(data.from)} → ${formatDetail(data.to)} ${data.unit.value}`}</span>
        <span>{`${formatDetail(data.durationMs)} ms`}</span>
      </figcaption>
      {(block.propertyName.includes("Alpha") ||
        block.propertyName === "alpha" ||
        block.propertyName.startsWith("trimPath")) && (
        <p className="text-[9px] leading-relaxed text-muted-foreground">{paintLimit}</p>
      )}
    </figure>
  );
});

/** No playhead subscription: these samples change only with authored segment data. */
export const MotionValueGraph = React.memo(function MotionValueGraph({
  block,
}: {
  block: NumericMotionSegment;
}) {
  const [open, setOpen] = React.useState(false);
  const [view, setView] = React.useState<GraphView>("value");
  const id = React.useId();
  if (!canGraphMotionSegment(block)) return null;
  const label = propertyLabel(block.propertyName);
  return (
    <div>
      <button
        type="button"
        aria-label={`${label} value and velocity graphs`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="flex h-7 w-full items-center gap-1 rounded px-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      >
        <ChevronRight aria-hidden="true" className={cn("size-3", open && "rotate-90")} />
        Value &amp; velocity
      </button>
      {open && (
        <div id={id} className="space-y-2 rounded border border-border bg-muted/15 p-2">
          <div role="group" aria-label={`${label} graph view`} className="flex gap-1">
            {(["value", "velocity"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={view === option}
                onClick={() => setView(option)}
                className={cn(
                  "h-7 flex-1 rounded px-2 text-[10px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
                  view === option
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                {option === "value" ? "Value" : "Velocity"}
              </button>
            ))}
          </div>
          <MotionGraphPlot block={block} view={view} />
        </div>
      )}
    </div>
  );
});
