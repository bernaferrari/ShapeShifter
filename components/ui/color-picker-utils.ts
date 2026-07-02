export type GradientType = "linear" | "radial" | "conic" | "mesh"
export type ColorFormat = "HEX" | "RGB" | "HSL" | "HSB"

export function hexToHsv(hex: string): { h: number; s: number; v: number } {
  let normalized = hex.replace(/^#/, "")
  if (normalized.length === 3) {
    normalized = normalized
      .split("")
      .map((c) => c + c)
      .join("")
  }
  if (normalized.length !== 6) {
    return { h: 0, s: 0, v: 100 }
  }
  const r = parseInt(normalized.substring(0, 2), 16) / 255
  const g = parseInt(normalized.substring(2, 4), 16) / 255
  const b = parseInt(normalized.substring(4, 6), 16) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  const s = max === 0 ? 0 : d / max
  const v = max

  if (max !== min) {
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0)
        break
      case g:
        h = (b - r) / d + 2
        break
      case b:
        h = (r - g) / d + 4
        break
    }
    h /= 6
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    v: Math.round(v * 100),
  }
}

export function hsvToHex(h: number, s: number, v: number): string {
  const saturation = s / 100
  const value = v / 100
  const hue = h / 360

  let r = 0
  let g = 0
  let b = 0

  const i = Math.floor(hue * 6)
  const f = hue * 6 - i
  const p = value * (1 - saturation)
  const q = value * (1 - f * saturation)
  const t = value * (1 - (1 - f) * saturation)

  switch (i % 6) {
    case 0:
      r = value
      g = t
      b = p
      break
    case 1:
      r = q
      g = value
      b = p
      break
    case 2:
      r = p
      g = value
      b = t
      break
    case 3:
      r = p
      g = q
      b = value
      break
    case 4:
      r = t
      g = p
      b = value
      break
    case 5:
      r = value
      g = p
      b = q
      break
  }

  const toHex = (x: number) => {
    const hex = Math.round(x * 255).toString(16)
    return hex.length === 1 ? "0" + hex : hex
  }

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace(/^#/, "")
  return {
    r: parseInt(normalized.slice(0, 2), 16) || 0,
    g: parseInt(normalized.slice(2, 4), 16) || 0,
    b: parseInt(normalized.slice(4, 6), 16) || 0,
  }
}

export function rgbToHex(r: number, g: number, b: number): string {
  const channel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, "0")
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

export function parseHexColorInput(value: string): string | null {
  const cleaned = value.trim().replace(/^#/, "")
  if (/^[0-9A-Fa-f]{3}$/.test(cleaned)) {
    return `#${cleaned
      .split("")
      .map((char) => char + char)
      .join("")
      .toUpperCase()}`
  }
  if (/^[0-9A-Fa-f]{6}$/.test(cleaned)) {
    return `#${cleaned.toUpperCase()}`
  }
  return null
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const { r, g, b } = hexToRgb(hex)
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  let h = 0
  let s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0)
        break
      case gn:
        h = (bn - rn) / d + 2
        break
      case bn:
        h = (rn - gn) / d + 4
        break
    }
    h /= 6
  }
  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  }
}

export function hslToHex(h: number, s: number, l: number): string {
  const saturation = s / 100
  const lightness = l / 100
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = lightness - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) {
    r = c
    g = x
  } else if (h < 120) {
    r = x
    g = c
  } else if (h < 180) {
    g = c
    b = x
  } else if (h < 240) {
    g = x
    b = c
  } else if (h < 300) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255)
}

export const gradientPreviewCss = (
  type: GradientType,
  stops: Array<{ color: string; position: number }>
) => {
  const stopList = stops
    .map((stop) => `${stop.color} ${Math.round(stop.position * 100)}%`)
    .join(", ")
  if (type === "mesh") {
    const colors = stops.map((stop) => stop.color)
    if (colors.length >= 9) {
      return `radial-gradient(circle at 18% 18%, ${colors[0]} 0 12%, transparent 30%), radial-gradient(circle at 50% 20%, ${colors[1]} 0 13%, transparent 34%), radial-gradient(circle at 82% 20%, ${colors[2]} 0 13%, transparent 34%), radial-gradient(circle at 18% 52%, ${colors[3]} 0 15%, transparent 36%), radial-gradient(circle at 50% 50%, ${colors[4]} 0 18%, transparent 42%), radial-gradient(circle at 82% 52%, ${colors[5]} 0 15%, transparent 36%), radial-gradient(circle at 18% 84%, ${colors[6]} 0 14%, transparent 36%), radial-gradient(circle at 50% 84%, ${colors[7]} 0 15%, transparent 38%), radial-gradient(circle at 82% 84%, ${colors[8]} 0 15%, transparent 38%), linear-gradient(135deg, ${colors[0]}, ${colors[8]})`
    }
    return `linear-gradient(135deg, ${stopList})`
  }
  if (type === "radial")
    return `radial-gradient(circle at 35% 35%, ${stopList})`
  if (type === "conic")
    return `conic-gradient(from 45deg, ${stopList}, ${stops[0]?.color ?? "#fff"})`
  return `linear-gradient(90deg, ${stopList})`
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const x = clamp01((value - edge0) / (edge1 - edge0))
  return x * x * (3 - 2 * x)
}

const mixChannel = (a: number, b: number, t: number) => a + (b - a) * t

const mixHex = (fromColor: string, toColor: string, t: number) => {
  const from = hexToRgb(fromColor)
  const to = hexToRgb(toColor)
  return rgbToHex(
    mixChannel(from.r, to.r, t),
    mixChannel(from.g, to.g, t),
    mixChannel(from.b, to.b, t)
  )
}

const bezierHex = (a: string, b: string, c: string, t: number) =>
  mixHex(mixHex(a, b, t), mixHex(b, c, t), t)

export const colorAtStopPosition = (
  stops: Array<{ color: string; position: number }>,
  position: number,
  fallback: string
) => {
  const sorted = [...stops].sort((a, b) => a.position - b.position)
  const previous =
    [...sorted].reverse().find((stop) => stop.position <= position) ?? sorted[0]
  const next =
    sorted.find((stop) => stop.position >= position) ??
    sorted[sorted.length - 1]
  if (!previous || !next || previous.position === next.position)
    return previous?.color ?? fallback

  return mixHex(
    previous.color,
    next.color,
    (position - previous.position) / (next.position - previous.position)
  )
}

export const colorAtGradientPoint = (
  type: GradientType,
  stops: Array<{ color: string; position: number }>,
  point: { x: number; y: number },
  fallback: string
) => {
  if (type === "radial") {
    const cx = 0.35
    const cy = 0.35
    const farthest = Math.max(
      Math.hypot(cx, cy),
      Math.hypot(1 - cx, cy),
      Math.hypot(1 - cx, 1 - cy)
    )
    return colorAtStopPosition(
      stops,
      clamp01(Math.hypot(point.x - cx, point.y - cy) / farthest),
      fallback
    )
  }

  if (type === "conic") {
    const angle = Math.atan2(point.y - 0.5, point.x - 0.5)
    const turn = (angle + Math.PI * 2 - Math.PI / 4) / (Math.PI * 2)
    return colorAtStopPosition(
      stops,
      clamp01(turn - Math.floor(turn)),
      fallback
    )
  }

  if (type === "mesh") {
    const sortedStops = [...stops].sort((a, b) => a.position - b.position)
    const palette = Array.from({ length: 9 }, (_, index) =>
      stops.length >= 9
        ? (sortedStops[index]?.color ?? fallback)
        : colorAtStopPosition(stops, index / 8, fallback)
    )
    const x = smoothstep(0.02, 0.98, point.x)
    const y = smoothstep(0.02, 0.98, point.y)
    const top = bezierHex(palette[0], palette[1], palette[2], x)
    const middle = bezierHex(palette[3], palette[4], palette[5], x)
    const bottom = bezierHex(palette[6], palette[7], palette[8], x)
    return bezierHex(top, middle, bottom, y)
  }

  return colorAtStopPosition(stops, point.x, fallback)
}
