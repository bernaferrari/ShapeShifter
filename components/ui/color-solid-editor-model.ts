import {
  hexToHsl,
  hexToRgb,
  hslToHex,
  hsvToHex,
  rgbToHex,
  type ColorFormat,
} from "./color-picker-utils"

interface SolidColorFormatState {
  format: ColorFormat
  hex: string
  h: number
  s: number
  v: number
}

export function getSolidColorFormatValues({
  format,
  hex,
  h,
  s,
  v,
}: SolidColorFormatState) {
  if (format === "RGB") {
    const rgb = hexToRgb(hex)
    return [rgb.r, rgb.g, rgb.b]
  }

  if (format === "HSL") {
    const hsl = hexToHsl(hex)
    return [hsl.h, hsl.s, hsl.l]
  }

  return [h, s, v]
}

export function formatSolidColorValueEdit({
  format,
  hex,
  h,
  s,
  v,
  index,
  rawValue,
}: SolidColorFormatState & { index: number; rawValue: string }) {
  const parsed = Number.parseFloat(rawValue)
  if (!Number.isFinite(parsed)) return null

  if (format === "RGB") {
    const rgb = hexToRgb(hex)
    const next = [rgb.r, rgb.g, rgb.b]
    next[index] = clamp(parsed, 0, 255)
    return rgbToHex(next[0], next[1], next[2])
  }

  if (format === "HSL") {
    const hsl = hexToHsl(hex)
    const next = [hsl.h, hsl.s, hsl.l]
    next[index] = index === 0 ? clamp(parsed, 0, 360) : clamp(parsed, 0, 100)
    return hslToHex(next[0], next[1], next[2])
  }

  const next = [h, s, v]
  next[index] = index === 0 ? clamp(parsed, 0, 360) : clamp(parsed, 0, 100)
  return hsvToHex(next[0], next[1], next[2])
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}
