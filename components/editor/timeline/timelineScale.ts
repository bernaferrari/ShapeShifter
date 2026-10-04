export type TimelineTimeUnit = "milliseconds" | "frames";

/** Labels stay about 80px apart at every zoom level; grid and ruler share this step. */
export function timelineMajorStep(
  duration: number,
  contentWidth: number,
  unit: TimelineTimeUnit,
  fps: number,
) {
  const conversion = unit === "frames" ? fps / 1000 : 1;
  const target = (duration * conversion * 80) / Math.max(1, contentWidth);
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(0.001, target)));
  const candidates = [1, 2, 5, 10].map((multiple) => multiple * magnitude);
  const step = candidates.find((candidate) => candidate >= target) ?? candidates.at(-1)!;
  return (unit === "frames" ? Math.max(1, step) : step) / conversion;
}

export function anchoredTimelineScroll(
  progress: number,
  width: number,
  zoom: number,
  anchor = 0.5,
) {
  return Math.max(0, Math.min(width * (zoom - 1), progress * width * zoom - width * anchor));
}

export function formatTimelineMark(
  time: number,
  unit: TimelineTimeUnit,
  fps: number,
  majorStep: number,
) {
  if (unit === "frames") return String(Math.round((time * fps) / 1000));
  if (majorStep < 100) return `${Math.round(time)} ms`;
  return `${Number((time / 1000).toFixed(3))} s`;
}
