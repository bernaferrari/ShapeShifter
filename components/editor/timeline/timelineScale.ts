export type TimelineTimeUnit = "milliseconds" | "seconds" | "frames";

/** Labels stay about 80px apart at every zoom level; grid and ruler share this step. */
export function timelineMajorStep(
  duration: number,
  contentWidth: number,
  unit: TimelineTimeUnit,
  fps: number,
) {
  const conversion = timelineTimeFactor(unit, fps);
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
  _majorStep: number,
) {
  if (unit === "frames") return String(Math.round((time * fps) / 1000));
  return `${formatTimeNumber(time * timelineTimeFactor(unit, fps))} ${timelineUnitSuffix(unit)}`;
}

/** One presentation contract for ruler, transport, inspector and keyframe details. */
export const timelineTimeFactor = (unit: TimelineTimeUnit, fps: number) =>
  unit === "frames" ? fps / 1000 : unit === "seconds" ? 1 / 1000 : 1;
export const timelineUnitSuffix = (unit: TimelineTimeUnit) =>
  unit === "frames" ? "f" : unit === "seconds" ? "s" : "ms";
export const formatTimeNumber = (value: number) => String(Number(value.toFixed(6)));
export const formatTimelineTime = (time: number, unit: TimelineTimeUnit, fps: number) =>
  `${formatTimeNumber(time * timelineTimeFactor(unit, fps))} ${timelineUnitSuffix(unit)}`;
