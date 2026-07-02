type EndEvent = MouseEvent | PointerEvent | TouchEvent | Event

type MouseDragOptions = {
  onMove: (event: MouseEvent) => void
  onEnd?: (event?: EndEvent) => void
}

type PointerDragOptions = {
  onMove: (event: PointerEvent) => void
  onEnd?: (event?: EndEvent) => void
}

type TouchMouseDragOptions = {
  onMove: (event: MouseEvent | TouchEvent) => void
  onEnd?: (event?: EndEvent) => void
}

export const isPrimaryButtonReleased = (event: MouseEvent | PointerEvent) =>
  event.buttons === 0

export const safelySetPointerCapture = (target: Element, pointerId: number) => {
  try {
    target.setPointerCapture?.(pointerId)
  } catch {}
}

export const safelyReleasePointerCapture = (
  target: Element,
  pointerId: number
) => {
  try {
    target.releasePointerCapture?.(pointerId)
  } catch {}
}

export const bindWindowMouseDrag = ({ onMove, onEnd }: MouseDragOptions) => {
  let active = true

  const cleanup = (event?: EndEvent) => {
    if (!active) return
    active = false
    window.removeEventListener("mousemove", move)
    window.removeEventListener("mouseup", cleanup)
    window.removeEventListener("blur", cleanup)
    onEnd?.(event)
  }

  const move = (event: MouseEvent) => {
    if (isPrimaryButtonReleased(event)) {
      cleanup(event)
      return
    }
    onMove(event)
  }

  window.addEventListener("mousemove", move)
  window.addEventListener("mouseup", cleanup)
  window.addEventListener("blur", cleanup)

  return cleanup
}

export const bindWindowPointerDrag = ({
  onMove,
  onEnd,
}: PointerDragOptions) => {
  let active = true

  const cleanup = (event?: EndEvent) => {
    if (!active) return
    active = false
    window.removeEventListener("pointermove", move)
    window.removeEventListener("pointerup", cleanup)
    window.removeEventListener("pointercancel", cleanup)
    window.removeEventListener("blur", cleanup)
    onEnd?.(event)
  }

  const move = (event: PointerEvent) => {
    if (isPrimaryButtonReleased(event)) {
      cleanup(event)
      return
    }
    onMove(event)
  }

  window.addEventListener("pointermove", move)
  window.addEventListener("pointerup", cleanup)
  window.addEventListener("pointercancel", cleanup)
  window.addEventListener("blur", cleanup)

  return cleanup
}

export const bindWindowTouchMouseDrag = ({
  onMove,
  onEnd,
}: TouchMouseDragOptions) => {
  let active = true

  const cleanup = (event?: EndEvent) => {
    if (!active) return
    active = false
    window.removeEventListener("mousemove", move)
    window.removeEventListener("mouseup", cleanup)
    window.removeEventListener("touchmove", move)
    window.removeEventListener("touchend", cleanup)
    window.removeEventListener("touchcancel", cleanup)
    window.removeEventListener("blur", cleanup)
    onEnd?.(event)
  }

  const move = (event: MouseEvent | TouchEvent) => {
    if (!("touches" in event) && isPrimaryButtonReleased(event)) {
      cleanup(event)
      return
    }
    onMove(event)
  }

  window.addEventListener("mousemove", move)
  window.addEventListener("mouseup", cleanup)
  window.addEventListener("touchmove", move, { passive: true })
  window.addEventListener("touchend", cleanup)
  window.addEventListener("touchcancel", cleanup)
  window.addEventListener("blur", cleanup)

  return cleanup
}
