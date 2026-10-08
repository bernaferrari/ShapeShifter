import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";
import type { CanvasFrame } from "@/lib/store/defaultWorkspace";
import { parsePath } from "@/lib/pathshift/pathUtils";
import { PAGE_ROOT_ID } from "@/lib/pathshift/scene/owners";
import type { AnimationState, Layer, VectorMetadata } from "@/lib/pathshift/types";
import { WorldArtboards } from "../WorldArtboards";
import { WorldSelectionOverlay } from "../WorldSelectionOverlay";

const animation: AnimationState = {
  id: "still",
  name: "Still",
  duration: 1,
  blocks: [],
};

function pathLayer(id: string, parentId: string | null = null): Layer {
  const path = parsePath("M0 0 L12 0 L12 12 L0 12 Z");
  return {
    id,
    name: id,
    type: "path",
    from: path,
    pathData: path,
    visible: true,
    locked: false,
    fillColor: "#e11d48",
    parentId,
  };
}

function clipLayer(id: string, parentId: string | null): Layer {
  const window = parsePath("M2 2 L10 2 L10 10 L2 10 Z");
  return {
    id,
    name: id,
    type: "clipPath",
    from: window,
    pathData: window,
    visible: true,
    locked: false,
    fillColor: "none",
    parentId,
  };
}

function groupLayer(id: string): Layer {
  const empty = { subPaths: [] };
  return {
    id,
    name: id,
    type: "group",
    from: empty,
    pathData: empty,
    visible: true,
    locked: false,
  };
}

function vector(id: string): VectorMetadata {
  return { id, name: id, width: 24, height: 24, alpha: 1, tint: "" };
}

function renderWorld(
  layers: Layer[],
  overrides: Partial<ComponentProps<typeof WorldArtboards>> = {},
): string {
  const frame: CanvasFrame = {
    id: "frame",
    name: "Frame",
    x: 0,
    y: 0,
    layers,
    vector: vector("frame-vector"),
    animation,
    hiddenLayerIds: [],
  };
  return renderToStaticMarkup(
    <svg>
      <WorldArtboards
        frames={[frame]}
        getFrameBounds={() => ({ x: 0, y: 0, w: 24, h: 24 })}
        activeLayers={layers}
        activeAnimation={animation}
        rootLayers={[]}
        rootAnimation={animation}
        rootVector={vector(PAGE_ROOT_ID)}
        selectedFrameId="other-frame"
        selectedFrameIds={[]}
        selectedLayerRefs={[]}
        selectedLayerRefKeys={new Set()}
        selectionKind="none"
        hasCanvasSelection={false}
        editPath={null}
        hoveredFrameId={null}
        hoveredLayerKey={null}
        draggingFrameIds={[]}
        isLayerDragging={false}
        isPointTool={false}
        isPlaying={false}
        progress={0}
        worldPerPx={1}
        gridVisibility={{ minorOpacity: 0, majorOpacity: 0 }}
        {...overrides}
      />
    </svg>,
  );
}

describe("WorldArtboards per-frame clip definitions", () => {
  it("emits the frame's clipPath definition and wraps the clipped sibling draw", () => {
    // Regression: the render-loop isolation rewrite dropped the per-frame
    // <ClipDefinitions> that HEAD emitted. LayerDraw still wraps content in
    // <g clipPath="url(#android-clip-…)">, so without the definition every clipped
    // layer rendered unclipped (css-masking-1 treats an unresolvable url as none).
    // Real Android docs (androidVectorDrawable.ts) flatten <clip-path> as a
    // parentId-linked earlier sibling of the paths it clips.
    const markup = renderWorld([
      groupLayer("grp"),
      clipLayer("window", "grp"),
      pathLayer("clipped-child", "grp"),
    ]);

    expect(markup).toContain('id="android-clip-frame-window"');
    expect(markup).toContain('d="M2 2 L10 2 L10 10 L2 10 Z"');
    expect(markup).toContain('clip-path="url(#android-clip-frame-window)"');
  });

  it("renders no clip definitions for frames without clipPath layers", () => {
    const markup = renderWorld([pathLayer("plain")]);

    expect(markup).not.toContain("android-clip-frame");
  });
});

describe("WorldArtboards trimmed endpoint poses", () => {
  it("keeps the selected filled start pose empty at trimEnd=0 even in Direct editing", () => {
    const layer = { ...pathLayer("empty"), trimPathEnd: 0 };
    const markup = renderWorld([layer], {
      selectedFrameId: "frame",
      editLayer: layer,
      editPath: layer.from,
      isPointTool: true,
    });
    expect(markup).not.toContain('fill="#e11d48"');
    expect(markup).not.toContain("pathLength");
  });
  it("shows the trimmed explicit To in Direct while ordinary viewing uses the evaluated start", () => {
    const layer = {
      ...pathLayer("editable"),
      trimPathEnd: 0.5,
      to: parsePath("M20 0L32 0L32 12L20 12Z"),
    };
    const selected = {
      selectedFrameId: "frame",
      editLayer: layer,
      editPath: layer.to,
    };
    const direct = renderWorld([layer], { ...selected, isPointTool: true });
    expect(direct).toContain('<path d="M20 0 L32 0 L32 12" fill="#e11d48"');
    const ordinary = renderWorld([layer], { ...selected, isPointTool: false });
    expect(ordinary).toContain('<path d="M0 0 L12 0 L12 12" fill="#e11d48"');
    expect(ordinary).not.toContain('<path d="M20 0 L32 0 L32 12" fill="#e11d48"');
  });
  it("keeps authored stroke dashes without adding a second trim", () => {
    const layer = {
      ...pathLayer("dashed"),
      strokeColor: "#000",
      strokeWidth: 1,
      strokeDasharray: "2 3",
      trimPathEnd: 0.25,
    };
    const markup = renderWorld([layer]);
    expect(markup).toContain('<path d="M0 0 L12 0"');
    expect(markup).toContain('stroke-dasharray="2 3"');
    expect(markup).not.toContain("pathLength");
    expect(markup).not.toContain("stroke-dashoffset");
  });
});

describe("WorldSelectionOverlay single-layer bounds", () => {
  it("sizes the resize frame from analytic Bézier extrema, not control points", () => {
    // Regression: the overlay built its session/display bounds from
    // getPathDataBounds (command points), so a curve's control points leaked
    // into the selection box and resize math scaled toward that loose box.
    // The document-level selection already used getAccuratePathBounds.
    const curve = parsePath("M0 0 Q10 -100 20 0");
    const layer: Layer = {
      id: "curved",
      name: "curved",
      type: "path",
      from: curve,
      pathData: curve,
      visible: true,
      locked: false,
      fillColor: "#e11d48",
      parentId: null,
    };
    const markup = renderToStaticMarkup(
      <svg>
        <WorldSelectionOverlay
          visible
          activeOrigin={{ x: 0, y: 0 }}
          activeLayers={[layer]}
          activeLayerIds={["curved"]}
          selectedOwnerCount={1}
          documentBounds={null}
          worldPerPx={1}
          worldPointFromClient={() => null}
          onResizeStart={() => {}}
          onRotateStart={() => {}}
        />
      </svg>,
    );

    // True apex of M0 0 Q10 -100 20 0 is y=-50 at t=0.5; the control point
    // sits at y=-100 and must not inflate the frame.
    const rect = markup.match(/<rect x="[^"]*" y="([^"]*)" width="([^"]*)" height="([^"]*)"/);
    const y = Number(rect![1]);
    const width = Number(rect![2]);
    const height = Number(rect![3]);
    expect(y).toBeCloseTo(-50, 6);
    expect(width).toBeCloseTo(20, 6);
    expect(height).toBeCloseTo(50, 6);
  });
});
