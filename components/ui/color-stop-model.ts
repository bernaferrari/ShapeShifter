export type EditableColorStop = {
  id?: string
  color: string
  position: number
}

export type NormalizedColorStop = {
  id: string
  color: string
  position: number
}

const normalizeStopId = (
  id: string | undefined,
  index: number,
  usedIds: Set<string>
) => {
  const baseId = id?.trim() || `stop-${index}`
  if (!usedIds.has(baseId)) {
    usedIds.add(baseId)
    return baseId
  }

  let suffix = 2
  let nextId = `${baseId}-${suffix}`
  while (usedIds.has(nextId)) {
    suffix += 1
    nextId = `${baseId}-${suffix}`
  }
  usedIds.add(nextId)
  return nextId
}

export const normalizeColorStops = (
  stops: EditableColorStop[]
): NormalizedColorStop[] => {
  const usedIds = new Set<string>()
  return stops
    .map((stop, index) => ({
      id: normalizeStopId(stop.id, index, usedIds),
      color: stop.color.startsWith("#") ? stop.color : `#${stop.color}`,
      position: Math.max(0, Math.min(1, stop.position)),
    }))
    .sort((a, b) => a.position - b.position)
}

export const fallbackColorStops = ({
  stops,
  primaryHex,
  secondaryHex,
  hasSecondary,
}: {
  stops?: EditableColorStop[]
  primaryHex: string
  secondaryHex: string
  hasSecondary: boolean
}) => {
  if (stops?.length) return stops
  if (hasSecondary) {
    return [
      { color: primaryHex, position: 0 },
      { color: secondaryHex, position: 1 },
    ]
  }
  return [{ color: primaryHex, position: 0 }]
}
