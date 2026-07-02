"use client"
import * as React from "react"
import type { ColorStopEditorAnchor } from "./color-gradient-stop-rows"

export function useColorStopEditorState({ isOpen, isGradient, stopCount }: { isOpen: boolean; isGradient: boolean; stopCount: number }) {
  const [activeStop, setActiveStop] = React.useState(0)
  const [openStopEditor, setOpenStopEditor] = React.useState<number | null>(null)
  const [openStopEditorAnchor, setOpenStopEditorAnchor] = React.useState<ColorStopEditorAnchor>(null)
  const openingStopEditorRef = React.useRef(false)
  const closeStopEditor = () => setOpenStopEditor(null)
  const markStopEditorOpenIntent = () => { openingStopEditorRef.current = true }
  const setOpenStopEditorState = (stop: number | null, anchor: ColorStopEditorAnchor) => {
    setOpenStopEditor(stop)
    setOpenStopEditorAnchor(anchor)
  }
  return {
    activeStop, setActiveStop,
    openStopEditor, setOpenStopEditor,
    openStopEditorAnchor, setOpenStopEditorAnchor,
    openingStopEditorRef,
    closeStopEditor,
    markStopEditorOpenIntent,
    setOpenStopEditorState,
  }
}
