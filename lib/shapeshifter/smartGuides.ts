/**
 * Minimal Figma-style smart guides: snap to sibling edges/centers and frame bounds.
 */
export type GuideLine = {
  orientation: "v" | "h";
  /** World position of the guide line */
  pos: number;
  /** Segment extent for drawing (other axis) */
  from: number;
  to: number;
};

export type SnapRect = { x: number; y: number; w: number; h: number; id?: string };

const THRESHOLD = 6; // world units — caller scales with zoom if needed

export function snapRectToGuides(
  moving: SnapRect,
  targets: SnapRect[],
  threshold = THRESHOLD,
): { x: number; y: number; guides: GuideLine[] } {
  const mx = [moving.x, moving.x + moving.w / 2, moving.x + moving.w];
  const my = [moving.y, moving.y + moving.h / 2, moving.y + moving.h];

  let bestDx = 0;
  let bestDy = 0;
  let bestAbsX = threshold + 1;
  let bestAbsY = threshold + 1;
  const guides: GuideLine[] = [];

  for (const t of targets) {
    const tx = [t.x, t.x + t.w / 2, t.x + t.w];
    const ty = [t.y, t.y + t.h / 2, t.y + t.h];
    for (const a of mx) {
      for (const b of tx) {
        const d = b - a;
        const ad = Math.abs(d);
        if (ad < bestAbsX) {
          bestAbsX = ad;
          bestDx = d;
        }
      }
    }
    for (const a of my) {
      for (const b of ty) {
        const d = b - a;
        const ad = Math.abs(d);
        if (ad < bestAbsY) {
          bestAbsY = ad;
          bestDy = d;
        }
      }
    }
  }

  const dx = bestAbsX <= threshold ? bestDx : 0;
  const dy = bestAbsY <= threshold ? bestDy : 0;
  const nx = moving.x + dx;
  const ny = moving.y + dy;

  if (dx !== 0) {
    const snapX = nx; // left edge after snap — recompute which line
    // Find a target x that aligns with any of the moved rect's x lines
    const movedXs = [nx, nx + moving.w / 2, nx + moving.w];
    for (const t of targets) {
      const txs = [t.x, t.x + t.w / 2, t.x + t.w];
      for (const vx of movedXs) {
        for (const tx of txs) {
          if (Math.abs(vx - tx) < 0.5) {
            guides.push({
              orientation: "v",
              pos: tx,
              from: Math.min(ny, t.y),
              to: Math.max(ny + moving.h, t.y + t.h),
            });
          }
        }
      }
    }
  }
  if (dy !== 0) {
    const movedYs = [ny, ny + moving.h / 2, ny + moving.h];
    for (const t of targets) {
      const tys = [t.y, t.y + t.h / 2, t.y + t.h];
      for (const vy of movedYs) {
        for (const ty of tys) {
          if (Math.abs(vy - ty) < 0.5) {
            guides.push({
              orientation: "h",
              pos: ty,
              from: Math.min(nx, t.x),
              to: Math.max(nx + moving.w, t.x + t.w),
            });
          }
        }
      }
    }
  }

  // Dedupe guides
  const seen = new Set<string>();
  const unique = guides.filter((g) => {
    const k = `${g.orientation}:${g.pos.toFixed(2)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return { x: nx, y: ny, guides: unique };
}
