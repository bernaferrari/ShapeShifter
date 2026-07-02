"use client"

import * as React from "react"

type Point = { x: number; y: number }

interface ColorPickerDismissOptions {
  isOpen: boolean
  hasOpenStopEditor: boolean
  rootContentRef: React.RefObject<HTMLElement | null>
  rootTriggerRef: React.RefObject<HTMLElement | null>
  stopContentRef: React.RefObject<HTMLElement | null>
  closeRoot: () => void
  closeStopEditor: () => void
}

const CLICK_DISTANCE_PX = 4

const isInside = (element: HTMLElement | null, target: EventTarget | null) =>
  Boolean(element && target instanceof Node && element.contains(target))

const pointFromPointerLikeEvent = (event: Event) => {
  if (!("clientX" in event) || !("clientY" in event)) return null
  if (typeof event.clientX !== "number" || typeof event.clientY !== "number")
    return null
  return { x: event.clientX, y: event.clientY }
}

const isClickDistance = (start: Point, event: PointerEvent) =>
  Math.hypot(event.clientX - start.x, event.clientY - start.y) <=
  CLICK_DISTANCE_PX

export function useColorPickerDismiss({
  isOpen,
  hasOpenStopEditor,
  rootContentRef,
  rootTriggerRef,
  stopContentRef,
  closeRoot,
  closeStopEditor,
}: ColorPickerDismissOptions) {
  const rootOutsidePointerRef = React.useRef<Point | null>(null)
  const stopOutsidePointerRef = React.useRef<Point | null>(null)

  const captureRootOutsidePointer = React.useCallback((event: Event) => {
    rootOutsidePointerRef.current = pointFromPointerLikeEvent(event)
  }, [])

  const captureStopOutsidePointer = React.useCallback((event: Event) => {
    stopOutsidePointerRef.current = pointFromPointerLikeEvent(event)
  }, [])

  React.useEffect(() => {
    if (!isOpen && !hasOpenStopEditor) return

    const handlePointerDown = (event: PointerEvent) => {
      if (
        hasOpenStopEditor &&
        !isInside(stopContentRef.current, event.target)
      ) {
        stopOutsidePointerRef.current = { x: event.clientX, y: event.clientY }
      }

      if (
        isOpen &&
        !isInside(rootContentRef.current, event.target) &&
        !isInside(rootTriggerRef.current, event.target) &&
        !isInside(stopContentRef.current, event.target)
      ) {
        rootOutsidePointerRef.current = { x: event.clientX, y: event.clientY }
      }
    }

    const handlePointerUp = (event: PointerEvent) => {
      const stopStart = stopOutsidePointerRef.current
      stopOutsidePointerRef.current = null
      if (stopStart && isClickDistance(stopStart, event)) closeStopEditor()

      const rootStart = rootOutsidePointerRef.current
      rootOutsidePointerRef.current = null
      if (rootStart && isClickDistance(rootStart, event)) closeRoot()
    }

    window.addEventListener("pointerdown", handlePointerDown, true)
    window.addEventListener("pointerup", handlePointerUp, true)
    window.addEventListener("pointercancel", handlePointerUp, true)
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true)
      window.removeEventListener("pointerup", handlePointerUp, true)
      window.removeEventListener("pointercancel", handlePointerUp, true)
    }
  }, [
    closeRoot,
    closeStopEditor,
    hasOpenStopEditor,
    isOpen,
    rootContentRef,
    rootTriggerRef,
    stopContentRef,
  ])

  return {
    captureRootOutsidePointer,
    captureStopOutsidePointer,
  }
}
