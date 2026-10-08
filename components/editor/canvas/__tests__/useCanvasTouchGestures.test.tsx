// @vitest-environment happy-dom

import React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Viewport } from "@/lib/pathshift/camera";
import { useCanvasTouchGestures } from "../useCanvasTouchGestures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function mount(interceptHandle = false) {
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
    return (
      <svg ref={svgRef} data-testid="canvas" {...touch}>
        {interceptHandle && <circle onPointerDown={(event) => event.stopPropagation()} />}
      </svg>
    );
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
      if (type === "lostpointercapture") svg.releasePointerCapture(pointerId);
      const target =
        interceptHandle && type === "pointerdown" && pointerId === 1
          ? svg.querySelector("circle")!
          : svg;
      target.dispatchEvent(
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
  const outside = (type: string, pointerId: number) =>
    React.act(() =>
      window.dispatchEvent(
        new PointerEvent(type, { pointerId, pointerType: "touch", bubbles: true }),
      ),
    );
  return { handlers, views, pointer, outside };
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

  it.each([1, 2])(
    "hands off to panning when pinch finger %s lifts, then resumes pinching",
    (lifted) => {
      const { handlers, views, pointer } = mount();
      pointer("pointerdown", 1, 40, 50);
      pointer("pointerdown", 2, 60, 50);
      pointer("pointermove", 1, 30, 50);
      pointer("pointermove", 2, 70, 50);
      const zoomed = views.at(-1)!;
      const kept = lifted === 1 ? 2 : 1;
      const x = kept === 1 ? 30 : 70;
      pointer("pointerup", lifted, lifted === 1 ? 30 : 70, 50);
      pointer("pointermove", kept, x, 50);
      expect(views.at(-1)).toEqual(zoomed);
      pointer("pointermove", kept, x + 20, 40);
      expect(views.at(-1)).toEqual({ ...zoomed, x: zoomed.x - 10, y: zoomed.y + 5 });
      const panned = views.at(-1)!;
      pointer("pointerdown", 3, x + 60, 40);
      pointer("pointermove", 3, x + 60, 40);
      expect(views.at(-1)).toEqual(panned);
      pointer("pointermove", 3, x + 80, 40);
      expect(views.at(-1)!.scale).toBeCloseTo(3);
      const pinchedAgain = views.at(-1)!;
      pointer("pointerup", 3, x + 80, 40);
      pointer("pointermove", kept, x + 20, 40);
      expect(views.at(-1)).toEqual(pinchedAgain);
      pointer("pointerup", kept, x + 20, 40);
      expect(handlers.onPointerCancel).toHaveBeenCalledTimes(1);
      expect(handlers.onPointerMove).not.toHaveBeenCalled();
      expect(handlers.onPointerUp).not.toHaveBeenCalled();
      pointer("pointerdown", 4, 10, 10);
      pointer("pointermove", 4, 20, 20);
      pointer("pointerup", 4, 20, 20);
      expect(handlers.onPointerMove).toHaveBeenCalledTimes(1);
      expect(handlers.onPointerUp).toHaveBeenCalledTimes(1);
    },
  );

  it("does not turn the next single-finger drag into zoom when the last pinch finger ends outside the canvas", () => {
    const { views, pointer, outside } = mount();
    pointer("pointerdown", 1, 40, 50);
    pointer("pointerdown", 2, 60, 50);
    pointer("pointermove", 2, 80, 50);
    pointer("pointerup", 1, 40, 50);
    outside("pointerup", 2);
    const before = views.length;
    pointer("pointerdown", 3, 50, 50);
    pointer("pointermove", 3, 90, 90);
    pointer("pointerup", 3, 90, 90);
    expect(views).toHaveLength(before);
  });
  it("clears a pinch when capture is lost and ignores orphan touch movement", () => {
    const { views, handlers, pointer } = mount();
    pointer("pointerdown", 1, 40, 50);
    pointer("pointerdown", 2, 60, 50);
    pointer("lostpointercapture", 1, 40, 50);
    pointer("pointerup", 2, 60, 50);
    const before = views.length;
    pointer("pointerdown", 3, 30, 30);
    pointer("pointermove", 3, 60, 60);
    pointer("pointerup", 3, 60, 60);
    expect(views).toHaveLength(before);
    const edits = handlers.onPointerMove.mock.calls.length;
    pointer("pointermove", 99, 80, 80);
    expect(handlers.onPointerMove).toHaveBeenCalledTimes(edits);
  });
  it("cancels a resize handle that stops bubbling before a second finger starts a pinch", () => {
    const { handlers, views, pointer } = mount(true);
    pointer("pointerdown", 1, 30, 50);
    expect(handlers.onPointerDown).not.toHaveBeenCalled();
    pointer("pointerdown", 2, 70, 50);
    expect(handlers.onPointerCancel.mock.calls[0]![0].pointerId).toBe(1);
    pointer("pointermove", 2, 90, 50);
    expect(views.at(-1)!.scale).toBeCloseTo(1.5);
    pointer("pointerup", 1, 30, 50);
    pointer("pointerup", 2, 90, 50);
    expect(handlers.onPointerUp).not.toHaveBeenCalled();
  });
  it("rebases when a third finger replaces a pinch finger without jumping", () => {
    const { views, pointer } = mount();
    pointer("pointerdown", 1, 30, 50);
    pointer("pointerdown", 2, 70, 50);
    pointer("pointermove", 2, 90, 50);
    const before = views.at(-1)!;
    pointer("pointerdown", 3, 20, 80);
    pointer("pointerup", 1, 30, 50);
    pointer("pointermove", 3, 20, 80);
    expect(views.at(-1)).toEqual(before);
    pointer("pointerup", 2, 90, 50);
    pointer("pointerup", 3, 20, 80);
  });
  it("waits for a useful finger spread instead of magnifying nearly coincident touches", () => {
    const { views, pointer } = mount();
    pointer("pointerdown", 1, 50, 50);
    pointer("pointerdown", 2, 51, 50);
    pointer("pointermove", 2, 90, 50);
    expect(views).toHaveLength(0);
    pointer("pointermove", 2, 100, 50);
    expect(views.at(-1)!.scale).toBeCloseTo(1.25);
    pointer("pointerup", 1, 50, 50);
    pointer("pointerup", 2, 100, 50);
  });
  it("finishes a touch release that bypasses the SVG instead of cancelling the drag", () => {
    const { handlers, pointer, outside } = mount(true);
    pointer("pointerdown", 1, 30, 50);
    outside("pointerup", 1);
    expect(handlers.onPointerUp).toHaveBeenCalledTimes(1);
    expect(handlers.onPointerUp.mock.calls[0]![0].pointerId).toBe(1);
    expect(handlers.onPointerCancel).not.toHaveBeenCalled();
  });

  it("cancels editing on an outside release and resets stale touches when focus is lost", () => {
    const { handlers, views, pointer, outside } = mount();
    pointer("pointerdown", 1, 40, 50);
    outside("pointercancel", 1);
    expect(handlers.onPointerCancel).toHaveBeenCalledTimes(1);
    pointer("pointerdown", 2, 40, 50);
    pointer("pointerdown", 3, 60, 50);
    React.act(() => window.dispatchEvent(new Event("blur")));
    pointer("pointerdown", 4, 20, 50);
    pointer("pointermove", 4, 30, 50);
    pointer("pointerup", 4, 30, 50);
    expect(views).toHaveLength(0);
    expect(handlers.onPointerMove).toHaveBeenCalledTimes(1);
  });
  it("leaves mouse input alone", () => {
    const { handlers, pointer } = mount();
    pointer("pointerdown", 1, 10, 10, "mouse");
    pointer("pointerdown", 2, 30, 10, "mouse");
    expect(handlers.onPointerDown).toHaveBeenCalledTimes(2);
    expect(handlers.onPointerCancel).not.toHaveBeenCalled();
  });
});
