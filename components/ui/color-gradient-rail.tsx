"use client"
import * as React from "react"
import type { NormalizedColorStop } from "./color-stop-model"
import type { ColorStopEditorAnchor } from "./color-gradient-stop-rows"
import type { SolidColorEditorProps } from "./color-solid-editor"

interface Props {
  railRef: React.RefObject<HTMLDivElement | null>
  stops: NormalizedColorStop[]
  gradientCss: string
  openStopEditor: number | null
  openStopEditorAnchor: ColorStopEditorAnchor
  stopContentRef: React.RefObject<HTMLDivElement | null>
  stopEditorProps: SolidColorEditorProps
  onAddStopAtRailPosition: (x: number, y?: number) => void
  onStopPointerDown: (stop: number, e: React.PointerEvent) => void
  onStopEditorOpenIntent: () => void
  onActiveStopChange: (stop: number) => void
  onOpenStopEditorChange: (stop: number | null, anchor: ColorStopEditorAnchor) => void
  onCaptureStopOutsidePointer: (e: Event) => void
}
export function ColorGradientRail(_p: Props) { return <div className="h-9 rounded bg-muted/30" /> }
