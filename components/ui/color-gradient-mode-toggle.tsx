"use client"

import { cn } from "@/lib/utils"

export type GradientType = "linear" | "radial" | "conic" | "mesh"

const GRADIENT_TYPES: Array<{
  id: GradientType
  label: string
}> = [
  { id: "linear", label: "Linear" },
  { id: "radial", label: "Radial" },
  { id: "conic", label: "Conic" },
  { id: "mesh", label: "Mesh" },
]

export const SHOW_EXPERIMENTAL_GRADIENT_TYPES = false
export const VISIBLE_GRADIENT_TYPES = SHOW_EXPERIMENTAL_GRADIENT_TYPES
  ? GRADIENT_TYPES
  : GRADIENT_TYPES.filter((type) => type.id === "mesh")

interface ColorGradientModeToggleProps {
  isGradient: boolean
  gradientType: GradientType
  onGradientToggle?: (enabled: boolean) => void
  onGradientTypeChange?: (type: GradientType) => void
}

export function ColorGradientModeToggle({
  isGradient,
  gradientType,
  onGradientToggle,
  onGradientTypeChange,
}: ColorGradientModeToggleProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-lg border border-border bg-muted/45 p-0.5",
        isGradient && "mx-2"
      )}
    >
      <button
        type="button"
        onClick={() => onGradientToggle?.(false)}
        className={cn(
          "h-7 flex-1 rounded-md text-[10px] font-medium transition-colors",
          !isGradient
            ? "bg-foreground text-background shadow-sm"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
      >
        Solid
      </button>
      {VISIBLE_GRADIENT_TYPES.map((type) => (
        <button
          key={type.id}
          type="button"
          onClick={() => {
            onGradientToggle?.(true)
            onGradientTypeChange?.(type.id)
          }}
          className={cn(
            "h-7 flex-1 rounded-md text-[10px] font-medium transition-colors",
            isGradient && gradientType === type.id
              ? "bg-foreground text-background shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          {type.label}
        </button>
      ))}
    </div>
  )
}
