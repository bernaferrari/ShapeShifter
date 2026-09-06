import type { PageMetadata, VectorMetadata } from "./types";

/**
 * The editable coordinates in an Android vector are its viewport coordinates.
 * Intrinsic width/height describe layout size at runtime and must not crop or
 * rescale raw path data inside the editor.
 */
export function vectorCoordinateSize(
  vector: Pick<Partial<VectorMetadata>, "width" | "height" | "viewportWidth" | "viewportHeight">,
  fallback = 24,
) {
  const finitePositive = (value: number | undefined, alternate: number) =>
    Number.isFinite(value) && (value ?? 0) > 0 ? value! : alternate;
  const width = finitePositive(vector.viewportWidth, finitePositive(vector.width, fallback));
  const height = finitePositive(vector.viewportHeight, finitePositive(vector.height, fallback));
  return { width, height };
}

/** Coordinate-space dimensions shaped for world-frame/camera rectangles. */
export function vectorCoordinateRect(
  vector: Pick<Partial<VectorMetadata>, "width" | "height" | "viewportWidth" | "viewportHeight">,
  fallback = 24,
) {
  const { width, height } = vectorCoordinateSize(vector, fallback);
  return { w: width, h: height };
}

/** Whether a resize should continue mirroring each viewport axis to intrinsic size. */
export interface VectorCoordinateResizePolicy {
  mirrorIntrinsicWidth: boolean;
  mirrorIntrinsicHeight: boolean;
}

/** Capture resize intent once, before the first drag update introduces viewport metadata. */
export function vectorCoordinateResizePolicy(
  vector: Pick<Partial<VectorMetadata>, "viewportWidth" | "viewportHeight">,
): VectorCoordinateResizePolicy {
  return {
    mirrorIntrinsicWidth: vector.viewportWidth == null,
    mirrorIntrinsicHeight: vector.viewportHeight == null,
  };
}

/** Patch a vector from a viewport-space frame resize without changing imported ratios. */
export function vectorCoordinateResizePatch(
  width: number,
  height: number,
  policy: VectorCoordinateResizePolicy,
): Pick<VectorMetadata, "viewportWidth" | "viewportHeight"> &
  Partial<Pick<VectorMetadata, "width" | "height">> {
  return {
    viewportWidth: width,
    viewportHeight: height,
    ...(policy.mirrorIntrinsicWidth ? { width } : {}),
    ...(policy.mirrorIntrinsicHeight ? { height } : {}),
  };
}

/** Project document page metadata into the VectorMetadata shape used by editor tools. */
export function vectorFromPageMetadata(
  page: PageMetadata,
  id: string | number = "page",
): VectorMetadata {
  return {
    id,
    name: page.name,
    width: page.width,
    height: page.height,
    alpha: page.alpha,
    viewportWidth: page.viewportWidth,
    viewportHeight: page.viewportHeight,
    widthUnit: page.widthUnit,
    heightUnit: page.heightUnit,
    tint: page.tint,
    tintMode: page.tintMode,
    autoMirrored: page.autoMirrored,
    minSdk: page.minSdk,
  };
}
