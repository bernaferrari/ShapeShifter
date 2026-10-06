/**
 * Shared geometry for the timeline's name column and track lanes. Both panes
 * render the same rows side by side, so heights and indents live in one place.
 */
export const ROW_LAYER_HEIGHT = 30;
export const ROW_PROPERTY_HEIGHT = 28;
export const ROW_COMPACT_HEIGHT = 44;

/** Breathing room on both ends of the lanes so keyframes at 0 and at the end stay whole. */
export const timelineTrackGutter = (compact: boolean) => (compact ? 14 : 10);

const ROW_PADDING = 8;
const NEST_STEP = 12;
const DISCLOSURE = 16;
const GAP = 4;
const ICON = 14;

/**
 * Tree columns for a layer at `depth` (1 = owner root). Root layers start at
 * the frame's chevron so their content lines up under the frame name; nested
 * layers step in by `NEST_STEP`. Property rows sit one step inside the layer's
 * content (where a group's name starts), and the guide connecting them hangs
 * from the center of that first glyph slot.
 */
export function timelineTreeColumns(depth: number) {
  const start = ROW_PADDING + Math.max(0, depth - 1) * NEST_STEP;
  const content = start + DISCLOSURE + GAP;
  return { start, guide: content + ICON / 2, label: content + ICON + GAP };
}

export const TIMELINE_ROW_PADDING = ROW_PADDING;
