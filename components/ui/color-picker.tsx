"use client"

import * as React from "react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { ColorGradientPresetsPanel } from "./color-gradient-presets-panel"
import {
  ColorGradientModeToggle,
  SHOW_EXPERIMENTAL_GRADIENT_TYPES,
  type GradientType,
} from "./color-gradient-mode-toggle"
import type { EditableColorStop } from "./color-stop-model"
import { ColorGradientStopRows } from "./color-gradient-stop-rows"
import { ColorGradientRail } from "./color-gradient-rail"
import { SolidColorEditor } from "./color-solid-editor"
import { useColorPickerDismiss } from "./use-color-picker-dismiss"
import { useColorGradientEditor } from "./use-color-gradient-editor"
import { useSolidColorEditor } from "./use-solid-color-editor"

export { CompactColorInput } from "./compact-color-input"
export type { CompactColorInputProps } from "./compact-color-input"

interface ColorPickerProps {
  value: string
  onChange: (hex: string) => void
  alpha?: number
  onAlphaChange?: (alpha: number) => void
  className?: string
  // Optional gradient support — when onGradientToggle is provided, the popover
  // shows a Solid/Gradient toggle and editable stops.
  gradient?: boolean
  onGradientToggle?: (on: boolean) => void
  gradientType?: GradientType
  onGradientTypeChange?: (type: GradientType) => void
  stops?: EditableColorStop[]
  onStopsChange?: (stops: EditableColorStop[]) => void
  onStopPositionChange?: (stop: number, position: number) => void
  onStopRemove?: (stop: number) => void
  secondaryValue?: string
  onSecondaryChange?: (hex: string) => void
  secondaryAlpha?: number
  onSecondaryAlphaChange?: (alpha: number) => void
}

const ENABLE_ALPHA = false

export function ColorPicker({
  value,
  onChange,
  alpha,
  onAlphaChange,
  className,
  gradient,
  onGradientToggle,
  gradientType = "linear",
  onGradientTypeChange,
  stops,
  onStopsChange,
  onStopPositionChange,
  onStopRemove,
  secondaryValue,
  onSecondaryChange,
  secondaryAlpha,
  onSecondaryAlphaChange,
}: ColorPickerProps) {
  const supportsGradient = !!onGradientToggle
  const isGradient = !!gradient
  const [isOpen, setIsOpen] = React.useState(false)
  const [internalAlpha, setInternalAlpha] = React.useState(1)
  const [internalSecondaryAlpha, setInternalSecondaryAlpha] = React.useState(1)
  const rootTriggerRef = React.useRef<HTMLButtonElement | null>(null)
  const rootContentRef = React.useRef<HTMLDivElement | null>(null)
  const stopContentRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (
      isGradient &&
      !SHOW_EXPERIMENTAL_GRADIENT_TYPES &&
      gradientType !== "mesh"
    ) {
      onGradientTypeChange?.("mesh")
    }
  }, [gradientType, isGradient, onGradientTypeChange])

  const primaryHex = value.startsWith("#") ? value : `#${value}`
  const secondaryHex = (secondaryValue ?? value).startsWith("#")
    ? (secondaryValue ?? value)
    : `#${secondaryValue ?? value}`

  const gradientEditor = useColorGradientEditor({
    value,
    primaryHex,
    secondaryHex,
    isOpen,
    isGradient,
    gradientType,
    stops,
    hasSecondary: Boolean(onSecondaryChange),
    onChange,
    onGradientToggle,
    onGradientTypeChange,
    onSecondaryChange,
    onStopsChange,
    onStopPositionChange,
  })

  const {
    activeStop,
    activeValue,
    addStopAtMiddle,
    addStopAtRailPosition,
    applyGradientPreset,
    canRemoveStop,
    closeStopEditor,
    commitStopColorInput,
    commitStopPositionInput,
    gradientCss,
    gradientRailRef,
    handleStopPointerDown,
    markStopEditorOpenIntent,
    normalizedStops,
    openStopEditor,
    openStopEditorAnchor,
    openingStopEditorRef,
    setActiveStop,
    setOpenStopEditor,
    setOpenStopEditorAnchor,
    setOpenStopEditorState,
    shuffleMeshPoints,
    shuffleMeshStops,
    updateActiveStopColor,
  } = gradientEditor

  const closeRoot = React.useCallback(() => {
    openingStopEditorRef.current = false
    setOpenStopEditor(null)
    setOpenStopEditorAnchor(null)
    setIsOpen(false)
  }, [openingStopEditorRef, setOpenStopEditor, setOpenStopEditorAnchor])

  const { captureRootOutsidePointer, captureStopOutsidePointer } =
    useColorPickerDismiss({
      isOpen,
      hasOpenStopEditor: openStopEditor !== null,
      rootContentRef,
      rootTriggerRef,
      stopContentRef,
      closeRoot,
      closeStopEditor,
    })

  // The stop currently being edited (stop 1 only exists in gradient mode).
  const activeOnChange = updateActiveStopColor
  const editingSecondary = isGradient && activeStop === 1 && !!onSecondaryChange
  const activeAlpha = editingSecondary
    ? (secondaryAlpha ?? internalSecondaryAlpha)
    : (alpha ?? internalAlpha)
  const activeOnAlphaChange = editingSecondary
    ? (onSecondaryAlphaChange ?? setInternalSecondaryAlpha)
    : (onAlphaChange ?? setInternalAlpha)

  const solidEditorProps = useSolidColorEditor({
    value: activeValue,
    alpha: activeAlpha,
    enableAlpha: ENABLE_ALPHA,
    onChange: activeOnChange,
    onAlphaChange: activeOnAlphaChange,
  })
  const stopEditorProps = solidEditorProps

  return (
    <Popover
      open={isOpen}
      onOpenChange={(open, eventDetails) => {
        if (!open && eventDetails.reason === "outside-press") {
          const event = eventDetails.event
          if (
            event.target instanceof Node &&
            stopContentRef.current?.contains(event.target)
          ) {
            eventDetails.cancel()
            return
          }
          if ("clientX" in event && "clientY" in event) {
            captureRootOutsidePointer(event)
            eventDetails.cancel()
            return
          }
        }
        if (
          !open &&
          eventDetails.reason !== "outside-press" &&
          (openingStopEditorRef.current || openStopEditor !== null)
        ) {
          eventDetails.cancel()
          return
        }
        if (!open) {
          openingStopEditorRef.current = false
          setOpenStopEditor(null)
          setOpenStopEditorAnchor(null)
        }
        setIsOpen(open)
      }}
    >
      <PopoverTrigger
        ref={rootTriggerRef}
        className={cn(
          "flex items-center gap-2 rounded-lg border border-border bg-muted/45 px-2.5 py-2 text-left transition-colors hover:border-ring/50 hover:bg-muted/70 focus:ring-2 focus:ring-ring/35 focus:outline-none active:scale-[0.99]",
          className
        )}
      >
        <div
          className="size-3.5 shrink-0 rounded-[4px] border border-foreground/10 shadow-sm"
          style={{ background: isGradient ? gradientCss : primaryHex }}
        />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
          {isGradient ? "Gradient" : primaryHex}
        </span>
      </PopoverTrigger>

      <PopoverContent
        ref={rootContentRef}
        className={cn(
          "z-50 overflow-hidden rounded-xl border border-border bg-popover p-0 text-popover-foreground shadow-2xl backdrop-blur-xl select-none",
          "w-[260px]"
        )}
        align="start"
        sideOffset={6}
      >
        <div className={cn("space-y-3", isGradient ? "py-2 pb-2" : "p-3 pb-2")}>
          {supportsGradient && (
            <ColorGradientModeToggle
              isGradient={isGradient}
              gradientType={gradientType}
              onGradientToggle={onGradientToggle}
              onGradientTypeChange={onGradientTypeChange}
            />
          )}

          {isGradient && (
            <div className="space-y-3">
              <ColorGradientRail
                railRef={gradientRailRef}
                stops={normalizedStops}
                gradientCss={gradientCss}
                openStopEditor={openStopEditor}
                openStopEditorAnchor={openStopEditorAnchor}
                stopContentRef={stopContentRef}
                stopEditorProps={stopEditorProps}
                onAddStopAtRailPosition={addStopAtRailPosition}
                onStopPointerDown={handleStopPointerDown}
                onStopEditorOpenIntent={markStopEditorOpenIntent}
                onActiveStopChange={setActiveStop}
                onOpenStopEditorChange={(stop, anchor) => {
                  setOpenStopEditorState(stop, anchor)
                }}
                onCaptureStopOutsidePointer={captureStopOutsidePointer}
              />

              <div className="grid h-6 grid-cols-[1fr_28px] items-center gap-1 px-2">
                <span className="text-[13px] font-semibold text-foreground">
                  Stops
                </span>
                <button
                  type="button"
                  className="ml-1 flex size-6 items-center justify-center rounded-md text-xl leading-none font-light text-foreground hover:bg-muted"
                  onClick={addStopAtMiddle}
                >
                  +
                </button>
              </div>
              <ColorGradientStopRows
                stops={normalizedStops}
                openStopEditor={openStopEditor}
                openStopEditorAnchor={openStopEditorAnchor}
                canRemoveStop={canRemoveStop}
                stopContentRef={stopContentRef}
                stopEditorProps={stopEditorProps}
                onActiveStopChange={setActiveStop}
                onStopEditorOpenIntent={markStopEditorOpenIntent}
                onOpenStopEditorChange={(stop, anchor) => {
                  setOpenStopEditorState(stop, anchor)
                }}
                onCaptureStopOutsidePointer={captureStopOutsidePointer}
                onCommitStopPositionInput={commitStopPositionInput}
                onCommitStopColorInput={commitStopColorInput}
                onRemoveStop={onStopRemove}
              />

              <ColorGradientPresetsPanel
                gradientType={gradientType}
                onPresetSelect={applyGradientPreset}
                onShuffleMeshColors={shuffleMeshStops}
                onShuffleMeshPoints={shuffleMeshPoints}
              />
            </div>
          )}

          {!isGradient && (
            <SolidColorEditor {...solidEditorProps} framed={false} compact />
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
