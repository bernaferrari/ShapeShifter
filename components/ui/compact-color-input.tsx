"use client"

import * as React from "react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { bindWindowTouchMouseDrag } from "@/lib/drag-events"
import {
  hexToHsv,
  hsvToHex,
  parseHexColorInput,
  type ColorFormat,
} from "./color-picker-utils"
import { SolidColorEditor } from "./color-solid-editor"

export interface CompactColorInputProps {
  value: string
  onChange: (hex: string) => void
  className?: string
  ariaLabel?: string
  side?: "top" | "right" | "bottom" | "left"
  align?: "start" | "center" | "end"
  mixed?: boolean
}

export function CompactColorInput({
  value,
  onChange,
  className,
  ariaLabel = "Color",
  side = "top",
  align = "end",
  mixed = false,
}: CompactColorInputProps) {
  const hex = value.startsWith("#") ? value : `#${value}`
  const [format, setFormat] = React.useState<ColorFormat>("HEX")
  const [inputText, setInputText] = React.useState(hex)
  const canvasRef = React.useRef<HTMLDivElement>(null)
  const hueRef = React.useRef<HTMLDivElement>(null)
  const alphaRef = React.useRef<HTMLDivElement>(null)
  const alpha = 1

  const { h, s, v } = React.useMemo(() => {
    try {
      return hexToHsv(hex)
    } catch {
      return { h: 0, s: 0, v: 100 }
    }
  }, [hex])

  React.useEffect(() => {
    setInputText(mixed ? "" : hex)
  }, [hex, mixed])

  const handleCanvasDrag = React.useCallback(
    (clientX: number, clientY: number) => {
      if (!canvasRef.current) return
      const rect = canvasRef.current.getBoundingClientRect()
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const y = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height))
      onChange(hsvToHex(h, Math.round(x * 100), Math.round(y * 100)))
    },
    [h, onChange]
  )

  const handleCanvasStart = (event: React.MouseEvent | React.TouchEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const clientX =
      "touches" in event ? event.touches[0].clientX : event.clientX
    const clientY =
      "touches" in event ? event.touches[0].clientY : event.clientY
    handleCanvasDrag(clientX, clientY)
    bindWindowTouchMouseDrag({
      onMove: (moveEvent) => {
        const moveX =
          "touches" in moveEvent
            ? moveEvent.touches[0].clientX
            : moveEvent.clientX
        const moveY =
          "touches" in moveEvent
            ? moveEvent.touches[0].clientY
            : moveEvent.clientY
        handleCanvasDrag(moveX, moveY)
      },
    })
  }

  const handleHueDrag = React.useCallback(
    (clientX: number) => {
      if (!hueRef.current) return
      const rect = hueRef.current.getBoundingClientRect()
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      onChange(hsvToHex(Math.round(x * 360), s, v))
    },
    [onChange, s, v]
  )

  const handleHueStart = (event: React.MouseEvent | React.TouchEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const clientX =
      "touches" in event ? event.touches[0].clientX : event.clientX
    handleHueDrag(clientX)

    bindWindowTouchMouseDrag({
      onMove: (moveEvent) => {
        const moveX =
          "touches" in moveEvent
            ? moveEvent.touches[0].clientX
            : moveEvent.clientX
        handleHueDrag(moveX)
      },
    })
  }

  const handleTextChange = (nextValue: string) => {
    setInputText(nextValue)
    const nextColor = parseHexColorInput(nextValue)
    if (nextColor) onChange(nextColor)
  }

  const commitInput = () => {
    const nextColor = parseHexColorInput(inputText)
    if (nextColor) {
      onChange(nextColor)
      setInputText(nextColor)
    } else {
      setInputText(hex)
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      commitInput()
      event.currentTarget.blur()
    }
    if (event.key === "Escape") {
      setInputText(hex)
      event.currentTarget.blur()
    }
  }

  const handleAlphaChange = () => {}
  const handleAlphaStart = (event: React.MouseEvent | React.TouchEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <span
      className={cn(
        "flex h-8 min-w-0 items-center gap-2 rounded-lg bg-muted/45 px-2 font-mono text-foreground uppercase transition-colors focus-within:ring-2 focus-within:ring-ring/35",
        className
      )}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Popover>
        <PopoverTrigger
          aria-label={ariaLabel}
          className="size-4.5 shrink-0 rounded-[4px] border border-border focus:ring-2 focus:ring-ring/35 focus:outline-none"
          style={
            mixed
              ? {
                  backgroundImage:
                    "linear-gradient(135deg, transparent 42%, currentColor 43%, currentColor 57%, transparent 58%)",
                }
              : { backgroundColor: hex }
          }
          onClick={(event) => event.stopPropagation()}
        />
        <PopoverContent
          align={align}
          side={side}
          sideOffset={8}
          className="w-[210px] rounded-xl border border-border bg-popover p-3 pb-2 text-popover-foreground shadow-2xl backdrop-blur-xl"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <SolidColorEditor
            h={h}
            s={s}
            v={v}
            hex={hex}
            alpha={alpha}
            inputText={inputText}
            format={format}
            setFormat={setFormat}
            canvasRef={canvasRef}
            hueRef={hueRef}
            alphaRef={alphaRef}
            handleCanvasStart={handleCanvasStart}
            handleHueStart={handleHueStart}
            handleAlphaStart={handleAlphaStart}
            handleAlphaChange={handleAlphaChange}
            handleTextChange={handleTextChange}
            handleKeyDown={handleKeyDown}
            handleBlur={commitInput}
            framed={false}
            compact
          />
        </PopoverContent>
      </Popover>
      <span className="text-muted-foreground">#</span>
      <input
        type="text"
        spellCheck={false}
        aria-label={`${ariaLabel} hex value`}
        value={inputText.replace(/^#/, "")}
        placeholder={mixed ? "Mixed" : undefined}
        onChange={(event) => handleTextChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commitInput}
        className="h-full min-w-0 flex-1 bg-transparent p-0 font-mono text-[12px] text-foreground uppercase outline-none"
      />
    </span>
  )
}
