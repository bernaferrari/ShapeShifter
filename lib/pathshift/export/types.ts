import type { VectorMetadata } from "../types";

export interface ExportOptions {
  duration?: number; // in seconds
  fps?: number; // frames per second for baked animation
  width?: number;
  height?: number;
  viewBoxWidth?: number; // coordinate-space width (default: 48)
  viewBoxHeight?: number; // coordinate-space height (default: 48)
  loop?: boolean;
  strokeWidth?: number;
  fromColor?: string;
  toColor?: string;
  morphColor?: string;
}

/** Root VectorDrawable properties that can affect a static SVG snapshot. */
export type StaticSvgRootMetadata = Partial<Pick<VectorMetadata, "alpha" | "tint" | "tintMode">>;

/** Options specific to the scene-aware static SVG exporter. */
export interface StaticSvgExportOptions extends ExportOptions {
  /**
   * VectorDrawable root paint properties from the active artboard.
   * `alpha` is composited around the exported scene. A literal tint using the
   * default Android `src_in` mode is represented with an SVG alpha mask.
   */
  rootVector?: StaticSvgRootMetadata;
}

export interface StaticSvgDiagnostic {
  severity: "warning";
  code: "ROOT_TINT_MODE_UNSUPPORTED" | "ROOT_TINT_UNRESOLVED" | "ROOT_TINT_MASK_NOT_REIMPORTABLE";
  message: string;
}

/** The static SVG plus any root-paint semantics that could not be represented. */
export interface StaticSvgExportResult {
  svg: string;
  diagnostics: StaticSvgDiagnostic[];
}
