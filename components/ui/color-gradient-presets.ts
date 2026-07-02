import type { GradientType } from "./color-gradient-mode-toggle"

export type GradientPreset = {
  id: string
  label: string
  type: GradientType
  stops: Array<{ color: string; position: number }>
}

export const GRADIENT_PRESETS: GradientPreset[] = []

export function shuffledMeshColors() { return [] }
export function shuffledMeshPositions() { return [] }
