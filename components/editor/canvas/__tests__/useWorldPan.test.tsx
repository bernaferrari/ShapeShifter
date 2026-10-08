// @vitest-environment happy-dom
import React from "react";
import { afterEach, expect, it } from "vitest";
import { useWorldPan } from "../useWorldPan";
import { renderEditorComponent, type RenderedEditorComponent } from "./renderHelpers";
import type { Viewport } from "@/lib/pathshift/camera";
let rendered: RenderedEditorComponent;
afterEach(() => rendered?.unmount());
it("follows consecutive finger movements once each, including movements within one render", () => {
  let camera: Viewport = { x: 0, y: 0, w: 100, h: 100, scale: 1 };
  let pan: ReturnType<typeof useWorldPan>;
  function Harness() {
    const svgRef = React.useRef<SVGSVGElement>(null);
    pan = useWorldPan({
      svgRef,
      view: camera,
      setView: (next) => {
        camera = typeof next === "function" ? next(camera) : next;
      },
    });
    return <svg ref={svgRef} />;
  }
  rendered = renderEditorComponent(<Harness />);
  rendered.container.querySelector("svg")!.getBoundingClientRect = () =>
    ({ width: 100, height: 100 }) as DOMRect;
  React.act(() => pan!.start(10, 20, 1));
  React.act(() => {
    pan!.update(20, 30);
    pan!.update(30, 40);
  });
  expect(camera).toEqual({ x: -20, y: -20, w: 100, h: 100, scale: 1 });
  React.act(() => {
    pan!.finish();
    expect(pan!.update(80, 90)).toBe(false);
  });
  expect(camera.x).toBe(-20);
});
