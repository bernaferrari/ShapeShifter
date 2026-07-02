"use client"
import { GRADIENT_PRESETS, type GradientPreset } from "./color-gradient-presets"
import { type GradientType } from "./color-gradient-mode-toggle"

interface Props {
  gradientType: GradientType
  onPresetSelect: (preset: GradientPreset) => void
  onShuffleMeshColors: () => void
  onShuffleMeshPoints: () => void
}
export function ColorGradientPresetsPanel(_p: Props) {
  return null
}
