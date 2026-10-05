// @vitest-environment happy-dom

import React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Viewport } from "@/lib/shapeshifter/camera";
import { useCanvasTouchGestures } from "../useCanvasTouchGestures";

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function mount() {
  const handlers = {
    onPointerDown: vi.fn(),
    onPointerMove: vi.fn(),
    onPointerUp: vi.fn(),
    onPointerCancel: vi.fn(),
  };
  const views: Viewport[] = [];
  function Harness() {
    const svgRef = React.useRef<SVGSVGElement>(null);
    const [view, setView] = React.useState<Viewport>({ x: 0, y: 0, w: 100, h: 100, scale: 1 });
    const touch = useCanvasTouchGestures({
      svgRef,
      view,
      setView: (next) => {
        views.push(next);
        setView(next);
      },
      handlers,
    });
    return <svg ref={svgRef} data-testid="canvas" {...touch} />;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  React.act(() => root.render(<Harness />));
  const svg = container.querySelector("svg")!;
  svg.getBoundingClientRect = () =>
    ({ left: 0, top: 0, x: 0, y: 0, width: 100, height: 100, right: 100, bottom: 100 }) as DOMRect;
  cleanup = () => {
    React.act(() => root.unmount());
    container.remove();
  };
  const pointer = (type: string, pointerId: number, x: number, y: number, pointerType = "touch") =>
    React.act(() => {
      svg.dispatchEvent(
        new PointerEvent(type, {
          pointerId,
          pointerType,
          clientX: x,
          clientY: y,
          isPrimary: pointerId === 1,
          bubbles: true,
        }),
      );
    });
  return { handlers, views, pointer };
}

describe("canvas touch gestures", () => {
  it("passes a single finger through to the editing gesture", () => {
    const { handlers, views, pointer } = mount();
    pointer("pointerdown", 1, 10, 10);
    pointer("pointermove", 1, 20, 20);
    pointer("pointerup", 1, 20, 20);
    expect(handlers.onPointerDown).toHaveBeenCalledTimes(1);
    expect(handlers.onPointerMove).toHaveBeenCalledTimes(1);
    expect(handlers.onPointerUp).toHaveBeenCalledTimes(1);
    expect(views).toHaveLength(0);
  });

  it("cancels the first finger's gesture and pinch-zooms around the fingers", () => {
    const { handlers, views, pointer } = mount();
    pointer("pointerdown", 1, 40, 50);
    pointer("pointerdown", 2, 60, 50);
    expect(handlers.onPointerCancel).toHaveBeenCalledTimes(1);

    pointer("pointermove", 1, 30, 50);
    pointer("pointermove", 2, 70, 50);
    const zoomed = views.at(-1)!;
    expect(zoomed.scale).toBeCloseTo(2);
    // The world point under the fingers' midpoint stays put.
    expect(zoomed.x + zoomed.w / 2).toBeCloseTo(50);

    pointer("pointerup", 1, 30, 50);
    pointer("pointermove", 2, 80, 50);
    pointer("pointerup", 2, 80, 50);
    // Nothing from the two-finger sequence reaches the editing gesture.
    expect(handlers.onPointerMove).not.toHaveBeenCalled();
    expect(handlers.onPointerUp).not.toHaveBeenCalled();
  });

  it("leaves mouse input alone", () => {
    const { handlers, pointer } = mount();
    pointer("pointerdown", 1, 10, 10, "mouse");
    pointer("pointerdown", 2, 30, 10, "mouse");
    expect(handlers.onPointerDown).toHaveBeenCalledTimes(2);
    expect(handlers.onPointerCancel).not.toHaveBeenCalled();
  });
});
