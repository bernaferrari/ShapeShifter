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
