"use client"
import * as React from "react"
import type { EditableColorStop } from "./color-stop-model"
import type { GradientType } from "./color-gradient-mode-toggle"

type Args = {
  value: string
  primaryHex: string
  secondaryHex: string
  isOpen: boolean
  isGradient: boolean
  gradientType: GradientType
  stops?: EditableColorStop[]
  hasSecondary: boolean
  onChange: (hex: string) => void
  onGradientToggle?: (on: boolean) => void
  onGradientTypeChange?: (type: GradientType) => void
  onSecondaryChange?: (hex: string) => void
  onStopsChange?: (stops: EditableColorStop[]) => void
  onStopPositionChange?: (stop: number, position: number) => void
}

export function useColorGradientEditor(args: Args) {
  const gradientRailRef = React.useRef<HTMLDivElement>(null)
  const normalizedStops = (args.stops || [{ color: args.primaryHex, position: 0 }]).map((s, i) => ({ id: String(i), color: s.color, position: s.position }))
  return {
    activeStop: 0,
    activeValue: args.primaryHex,
    addStopAtMiddle: () => {},
    addStopAtRailPosition: () => {},
    applyGradientPreset: () => {},
    canRemoveStop: false,
    closeStopEditor: () => {},
    commitStopColorInput: () => {},
    commitStopPositionInput: () => {},
    gradientCss: "linear-gradient(90deg, #000, #fff)",
    gradientRailRef,
    handleStopPointerDown: () => {},
    markStopEditorOpenIntent: () => {},
    normalizedStops,
    openStopEditor: null as number | null,
    openStopEditorAnchor: null as any,
    openingStopEditorRef: { current: false },
    setActiveStop: () => {},
    setOpenStopEditor: (_: number | null) => {},
    setOpenStopEditorAnchor: (_: any) => {},
    setOpenStopEditorState: (_stop: number | null, _anchor: any) => {},
    shuffleMeshPoints: () => {},
    shuffleMeshStops: () => {},
    updateActiveStopColor: (hex: string) => args.onChange(hex),
  }
}
