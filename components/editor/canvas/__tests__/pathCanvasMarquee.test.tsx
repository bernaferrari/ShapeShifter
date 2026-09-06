// @vitest-environment happy-dom

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { useEditorStore, type EditorState } from "@/lib/store/editorStore";
import { parsePath } from "@/lib/shapeshifter/pathUtils";
import { createPathLayer } from "@/lib/store/defaultWorkspace";

import { PathCanvas } from "../../PathCanvas";
import { renderEditorComponent, type RenderedEditorComponent } from "./renderHelpers";

/**
 * happy-dom reports zero-sized rects; PathCanvas maps client -> artboard
 * coordinates through getBoundingClientRect, so pin the svg to a known
 * 100x100 box. With the default detail viewport (24-unit view of a 24-unit
 * artboard) client coords then equal artboard coords.
 */
beforeAll(() => {
  Object.defineProperty(SVGElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value(this: SVGElement) {
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 100,
        bottom: 100,
        width: 100,
        height: 100,
        toJSON: () => ({}),
      } as DOMRect;
    },
  });
});

let baseline: EditorState;
let rendered: RenderedEditorComponent | null = null;

beforeEach(() => {
  baseline = useEditorStore.getState();
});

afterEach(() => {
  rendered?.unmount();
  rendered = null;
  useEditorStore.setState(baseline, true);
});

/**
 * Regression: GestureDispatcher is constructed exactly once per PathCanvas
 * mount, so its commitMarqueeSelection callback captured whatever `side` was
 * current at mount time. CanvasArea legitimately swaps the side prop at
 * runtime (`side={isPlaying ? "preview" : editingSide}`) without remounting,
 * which made a marquee committed after playback stopped still route through
 * the stale preview branch (subpath/layer selection instead of point
 * selection). The dispatcher must read the live side at commit time.
 */
describe("PathCanvas marquee side contract", () => {
  it("commits point selection on the from canvas even after mounting with side=preview", async () => {
    const layer = useEditorStore.getState().layers.find((candidate) => candidate.to);
    expect(layer).toBeDefined();
    const store = useEditorStore.getState();
    store.selectLayer(layer!.id);

    rendered = renderEditorComponent(<PathCanvasHost initialSide="preview" switchTo="from" />);
    // Flush the host's deferred side swap so the dispatcher has seen the new
    // side prop before the gesture fires.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(useEditorStore.getState().editingSide).toBe("from");

    // Simulate a box marquee on the from canvas around the first anchor of
    // the default layer's from path (8,5). Client coords are mapped through
    // detailViewport {x:-6.6, y:-6.6, w:37.2, h:37.2} onto our 100x100 stub,
    // so (8,5) lands at ~(39.2, 31.2).
    dispatchMarquee(rendered.container, 38, 30, 42, 33);

    const state = useEditorStore.getState();
    expect(state.selectedPoints.length).toBeGreaterThan(0);
    expect(state.selectedPoints[0]!.side).toBe("from");
  });

  it("commits preview layer selection when mounted with side=from and playback starts", async () => {
    const firstLayer = useEditorStore.getState().layers[0];
    expect(firstLayer).toBeDefined();
    rendered = renderEditorComponent(<PathCanvasHost initialSide="from" switchTo="preview" />);

    React.act(() => {
      const state = useEditorStore.getState();
      state.setEditingSide("from");
      useEditorStore.setState({ isActionMode: false });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    // Marquee fully around the first layer's geometry on the preview canvas.
    dispatchMarquee(rendered.container, -5, -5, 40, 40);

    const state = useEditorStore.getState();
    expect(String(state.selectedLayerId)).toBe(String(firstLayer.id));
  });
});

/**
 * Regression: action/preview canvas artwork renders through each layer's
 * evaluated worldMatrix (translate/scale/rotate + group parents), but marquee
 * hit testing compared rects against RAW local path bounds. A translated
 * layer therefore selected based on geometry offset from the visible art.
 *
 * Client->artboard mapping (see file top): art = -6.6 + client * 0.372,
 * so client = (art + 6.6) * 2.688.
 */
const clientFor = (artX: number, artY: number) => ({
  x: (artX + 6.6) * 2.688,
  y: (artY + 6.6) * 2.688,
});

describe("PathCanvas marquee world-matrix contract", () => {
  const TRANSLATE_X = 20;
  const SQUARE = "M 0 4 L 10 4 L 10 14 L 0 14 Z";

  function installTranslatedLayer() {
    const layer = createPathLayer({
      id: "layer-shifted",
      name: "Shifted",
      from: parsePath(SQUARE),
      to: parsePath(SQUARE),
      visible: true,
      locked: false,
      translateX: TRANSLATE_X,
    });
    const other = createPathLayer({
      id: "layer-source",
      name: "Source",
      from: parsePath("M 40 40 L 41 40 L 41 41 L 40 41 Z"),
      visible: true,
      locked: false,
    });
    useEditorStore.setState({
      layers: [layer, other],
      selectedLayerId: other.id,
      editingSide: "from",
      isActionMode: false,
      toolMode: "select",
      progress: 0,
      selection: null,
      selectedPoints: [],
      selectedSubPaths: [],
      selectedLayerIds: [],
    });
    return { layer, other };
  }

  function mountPreviewCanvas() {
    rendered = renderEditorComponent(<PathCanvas side="preview" />);
  }

  it("selects a subpath under the RENDERED (world-transformed) location", () => {
    installTranslatedLayer();
    mountPreviewCanvas();

    // Rendered square occupies x 20..30 (local 0..10 + translateX 20);
    // raw local bounds stay at x 0..10. Marquee over the rendered area.
    const a = clientFor(22, 6);
    const b = clientFor(28, 12);
    dispatchMarquee(rendered!.container, a.x, a.y, b.x, b.y);

    const state = useEditorStore.getState();
    expect(state.selectedSubPaths).toEqual([
      { layerId: "layer-shifted", side: "from", subPathIndex: 0 },
    ]);
  });

  it("does NOT select a subpath whose raw local bounds overlap but rendered art does not", () => {
    installTranslatedLayer();
    mountPreviewCanvas();

    // This rect overlaps the RAW local bounds (x 0..10) but sits far from
    // the rendered square (x 20..30); the old raw-bounds test hit here.
    const a = clientFor(2, 6);
    const b = clientFor(8, 12);
    dispatchMarquee(rendered!.container, a.x, a.y, b.x, b.y);

    expect(useEditorStore.getState().selectedSubPaths).toEqual([]);
  });

  it("paint bucket targets a translated layer under its rendered location", () => {
    const { layer } = installTranslatedLayer();
    useEditorStore.setState({ toolMode: "paint" });
    mountPreviewCanvas();

    // Click the center of the rendered square (art ~25, ~9). The pre-fix
    // code tested that point against raw local bounds x 0..10 and missed.
    const c = clientFor(24, 8);
    act(() => {
      firePointer(rendered!.container.querySelector("svg")!, "pointerdown", c.x, c.y);
      firePointer(rendered!.container.querySelector("svg")!, "pointerup", c.x, c.y);
    });

    const state = useEditorStore.getState();
    expect(String(state.selectedLayerId)).toBe(String(layer.id));
    expect(state.layers.find((candidate) => candidate.id === layer.id)?.fillColor).toBe("#000000");
  });
});

/**
 * Regression: the preview/action canvas renders every layer through its
 * evaluated worldMatrix (pathCanvasPreview), so paint hit testing and marquee
 * bounds must map pointer/rect geometry into each layer's local space. With
 * translateX=40 the art visibly sits at x=40..44, and a click at the raw
 * local coordinates (which show empty canvas) must NOT hit the layer.
 */
describe("PathCanvas world-matrix hit testing", () => {
  function mountWithTranslatedLayer() {
    const layer = createPathLayer({
      id: "translated-layer",
      name: "Translated",
      from: parsePath("M 0 0 L 4 0 L 4 4 L 0 4 Z"),
      visible: true,
      locked: false,
      fillColor: "#ff0000",
      fillAlpha: 1,
      translateX: 40,
      translateY: 0,
    });
    act(() => {
      useEditorStore.setState({ layers: [layer], selectedLayerId: layer.id });
    });
    rendered = renderEditorComponent(<PathCanvas side="preview" />);
    return layer;
  }

  it("paint tool does not hit raw local coords when the layer is translated away", () => {
    const layer = mountWithTranslatedLayer();
    useEditorStore.setState({ toolMode: "paint" });
    const svg = rendered!.container.querySelector("svg");
    expect(svg).not.toBeNull();

    // Raw local square occupies (0..4) in art coords; with translateX=40 it
    // renders at (40..44). A click at the untransformed local position must
    // NOT paint: selection stays on the translated layer and fill is intact.
    const miss = clientFor(2, 2);
    act(() => {
      firePointer(svg!, "pointerdown", miss.x, miss.y);
      firePointer(svg!, "pointerup", miss.x, miss.y);
    });
    expect(useEditorStore.getState().selectedLayerId).toBe("translated-layer");
    expect(useEditorStore.getState().layers[0]!.fillColor).toBe("#ff0000");

    // Clicking the rendered position applies the source style to the layer.
    useEditorStore.setState({
      layers: [
        { ...layer, fillColor: "" },
        createPathLayer({
          id: "source-layer",
          name: "Source",
          from: parsePath("M 60 60 L 61 60 L 61 61 L 60 61 Z"),
          visible: true,
          locked: false,
          fillColor: "#00ff00",
          fillAlpha: 1,
        }),
      ],
      selectedLayerId: "source-layer",
    });
    const hit = clientFor(42, 2);
    act(() => {
      firePointer(svg!, "pointerdown", hit.x, hit.y);
      firePointer(svg!, "pointerup", hit.x, hit.y);
    });
    const state = useEditorStore.getState();
    expect(String(state.selectedLayerId)).toBe("translated-layer");
    expect(state.layers[0]!.fillColor).toBe("#00ff00");
  });

  it("marquee selects the layer only via its transformed world bounds", () => {
    mountWithTranslatedLayer();
    useEditorStore.setState({
      toolMode: "select",
      editingSide: "from",
      isActionMode: false,
      selectedLayerIds: [],
      selectedSubPaths: [],
    });
    // Marquee over the raw local area (empty after translation): no hit.
    const a = clientFor(-4, -4);
    const b = clientFor(3, 6);
    dispatchMarquee(rendered!.container, a.x, a.y, b.x, b.y);
    expect(useEditorStore.getState().selectedSubPaths).toEqual([]);

    // Marquee over the translated art at (40..44): hits the subpath in
    // world space and routes to subpath selection (preview-canvas contract).
    const c = clientFor(39, -3);
    const d = clientFor(45, 6);
    dispatchMarquee(rendered!.container, c.x, c.y, d.x, d.y);
    expect(useEditorStore.getState().selectedSubPaths).toEqual([
      { layerId: "translated-layer", side: "from", subPathIndex: 0 },
    ]);
    expect(useEditorStore.getState().selectedLayerId).toBe("translated-layer");
  });

  it("paint preview overlay carries the layer's evaluated world transform", async () => {
    mountWithTranslatedLayer();
    act(() => {
      useEditorStore.setState({ toolMode: "paint" });
    });
    const svg = rendered!.container.querySelector("svg");
    expect(svg).not.toBeNull();

    // Hover the rendered position (art 40..44) so computePaintHit fires and
    // paintHitRef points at the translated layer.
    const hover = clientFor(42, 2);
    await act(async () => {
      firePointer(svg!, "pointermove", hover.x, hover.y);
      // The hover preview re-render is scheduled via requestAnimationFrame.
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    // The overlay path must repeat the same matrix(...) transform the artwork
    // renders with; pre-fix it drew raw local coords untransformed.
    const overlay = Array.from(svg!.querySelectorAll("path")).find(
      (candidate) => candidate.getAttribute("stroke") === "#0d99ff",
    );
    expect(overlay).toBeDefined();
    expect(overlay!.getAttribute("transform")).toBe("matrix(1 0 0 1 40 0)");
  });
});

function dispatchMarquee(container: ParentNode, x1: number, y1: number, x2: number, y2: number) {
  const svg = container.querySelector("svg");
  if (!svg) throw new Error("PathCanvas svg not found");
  act(() => {
    firePointer(svg, "pointerdown", x1, y1);
    firePointer(svg, "pointermove", x2, y2);
    firePointer(svg, "pointerup", x2, y2);
  });
}

function firePointer(element: Element, type: string, clientX: number, clientY: number) {
  element.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      isPrimary: true,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      clientX,
      clientY,
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
    }),
  );
}

/**
 * Mirrors how CanvasArea mounts PathCanvas: the `side` prop changes while the
 * component stays mounted (playback toggles), driven by external state here.
 */
function PathCanvasHost({
  initialSide,
  switchTo,
}: {
  initialSide: "from" | "to" | "preview";
  switchTo: "from" | "to" | "preview";
}) {
  const [side, setSide] = React.useState(initialSide);
  React.useEffect(() => {
    // Give the gesture hook one committed render with the initial side before
    // swapping — this reproduces the stale-closure window.
    const timer = setTimeout(() => act(() => setSide(switchTo)), 0);
    return () => clearTimeout(timer);
  }, [switchTo]);
  return <PathCanvas side={side} />;
}
