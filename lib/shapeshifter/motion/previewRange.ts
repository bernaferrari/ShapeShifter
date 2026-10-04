export interface TimelinePreviewRange {
  ownerId: string;
  start: number;
  end: number;
}

export function resolveTimelinePreviewRange(
  range: TimelinePreviewRange | null,
  ownerId: string,
  duration: number,
): { start: number; end: number } | null {
  if (
    !range ||
    range.ownerId !== ownerId ||
    !Number.isFinite(range.start) ||
    !Number.isFinite(range.end)
  )
    return null;
  const start = Math.max(0, Math.min(duration, range.start));
  const end = Math.max(0, Math.min(duration, range.end));
  return end - start >= 1 ? { start, end } : null;
}

/** Preview ranges change playback only; authored keyframe times stay absolute. */
export function advancePlaybackTime(
  current: number,
  elapsed: number,
  speed: number,
  duration: number,
  range: { start: number; end: number } | null,
  repeating: boolean,
): { time: number; finished: boolean } {
  const { start, end } = range ?? { start: 0, end: duration };
  const span = Math.max(1, end - start);
  const next = (current < start || current > end ? start : current) + Math.max(0, elapsed) * speed;
  return next >= end
    ? repeating
      ? { time: start + ((next - start) % span), finished: false }
      : { time: end, finished: true }
    : { time: next, finished: false };
}
