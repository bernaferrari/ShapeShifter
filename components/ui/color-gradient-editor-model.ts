import type { EditableColorStop } from "./color-stop-model"
import type { GradientType } from "./color-gradient-mode-toggle"

export function createGradientStopAtPoint() { return { color: "#000000", position: 0.5 } }
export function createGradientStopAtPosition() { return { color: "#000000", position: 0.5 } }
export function findInsertedGradientStopIndex() { return 0 }
export function gradientRailPointFromClient() { return 0.5 }
export function gradientEditorPreviewCss() { return "linear-gradient(90deg, #000, #fff)" }
export function insertGradientStop(stops: EditableColorStop[]) { return stops }
export function normalizedGradientPosition(n: number) { return Math.max(0, Math.min(1, n)) }
export function parseGradientStopPositionInput(v: string) { const n = parseFloat(v); return isFinite(n) ? Math.max(0, Math.min(1, n/100)) : 0 }
export function updateGradientStopColorById(stops: EditableColorStop[], id: string, color: string) {
  return stops.map(s => s.id === id || s.color === color ? { ...s, color } : s)
}
export function updateGradientStopPositionById(stops: EditableColorStop[], id: string, pos: number) {
  return stops.map(s => (s.id === id ? { ...s, position: pos } : s))
}
