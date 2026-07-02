"use client"
import * as React from "react"
import type { NormalizedColorStop } from "./color-stop-model"
import type { SolidColorEditorProps } from "./color-solid-editor"

export type ColorStopEditorAnchor = "rail" | "row" | null

interface Props {
  stops: NormalizedColorStop[]
  openStopEditor: number | null
  openStopEditorAnchor: ColorStopEditorAnchor
  canRemoveStop: boolean
  stopContentRef: React.RefObject<HTMLDivElement | null>
  stopEditorProps: SolidColorEditorProps
  onActiveStopChange: (stop: number) => void
  onStopEditorOpenIntent: () => void
  onOpenStopEditorChange: (stop: number | null, anchor: ColorStopEditorAnchor) => void
  onCaptureStopOutsidePointer: (e: Event) => void
  onCommitStopPositionInput: (id: string, v: string) => void
  onCommitStopColorInput: (id: string, v: string, input?: HTMLInputElement) => void
  onRemoveStop?: (stop: number) => void
}
export function ColorGradientStopRows(_p: Props) { return null }
