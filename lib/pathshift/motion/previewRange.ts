export interface TimelinePreviewRange {
  ownerId: string;
  start: number;
  end: number;
}

export type PlaybackMode = "forward" | "back-and-forth";
export type PlaybackDirection = 1 | -1;

/** Reflect at both endpoints, including frames that cross several boundaries. */
export function advanceBackAndForthPlaybackTime(
  current: number,
  elapsed: number,
  speed: number,
  duration: number,
  range: { start: number; end: number } | null,
  repeating: boolean,
  direction: PlaybackDirection,
): { time: number; direction: PlaybackDirection; finished: boolean } {
  const { start, end } = range ?? { start: 0, end: duration };
  const span = Math.max(1, end - start);
  const outside = current < start || current > end;
  const position = outside ? start : current;
  const phase =
    (direction === -1 && !outside ? span + end - position : position - start) +
    Math.max(0, elapsed) * Math.max(0, speed);
  if (!repeating && phase >= span * 2) return { time: start, direction: 1, finished: true };
  const wrapped = phase % (span * 2);
  return wrapped < span
    ? { time: start + wrapped, direction: 1, finished: false }
    : { time: end - (wrapped - span), direction: -1, finished: false };
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
