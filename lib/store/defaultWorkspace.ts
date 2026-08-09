import { parsePath, pathToString } from "../shapeshifter/pathUtils";
import type { AnimationState, Layer, VectorMetadata } from "../shapeshifter/types";

export interface CanvasFrame {
  id: string;
  name: string;
  x: number;
  y: number;
  layers: Layer[];
  vector: VectorMetadata;
  animation: AnimationState;
  hiddenLayerIds: string[];
}

const PATH_STYLE_DEFAULTS = {
  fillColor: "",
  fillAlpha: 1,
  strokeColor: "",
  strokeAlpha: 1,
  strokeWidth: 0,
  strokeLinecap: "butt" as const,
  strokeLinejoin: "miter" as const,
  strokeMiterLimit: 4,
  trimPathStart: 0,
  trimPathEnd: 1,
  trimPathOffset: 0,
  fillType: "nonZero" as const,
};

export function createPathLayer(
  layer: Omit<Layer, "type"> & Partial<Pick<Layer, "type">>,
): Layer {
  return {
    ...PATH_STYLE_DEFAULTS,
    pathData: layer.from,
    alpha: 1,
    translateX: 0,
    translateY: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    pivotX: 0,
    pivotY: 0,
    timeline: [],
    ...layer,
    type: layer.type ?? "path",
  };
}

const DEFAULT_DURATION_MS = 1000;

interface MorphPart {
  id: string;
  name: string;
  from: string;
  to: string;
}

function makeMorphFrame(options: {
  id: string;
  name: string;
  x: number;
  y: number;
  stroke?: boolean;
  fill?: boolean;
  parts: MorphPart[];
}): CanvasFrame {
  const stroke = options.stroke !== false;
  const fill = !!options.fill;
  const layers = options.parts.map((part) => {
    const from = parsePath(part.from);
    const to = parsePath(part.to);
    return createPathLayer({
      id: part.id,
      name: part.name,
      from,
      to,
      pathData: from,
      visible: true,
      locked: false,
      strokeColor: stroke ? "#000000" : "",
      strokeWidth: stroke ? 2.4 : 0,
      fillColor: fill ? "#000000" : "",
    });
  });
  const animation: AnimationState = {
    id: `anim-${options.id}`,
    name: options.name,
    duration: DEFAULT_DURATION_MS,
    blocks: options.parts.map((part, index) => {
      const layer = layers[index]!;
      return {
        id: `block-${options.id}-${part.id}`,
        layerId: layer.id,
        propertyName: "pathData",
        fromValue: pathToString(layer.from),
        toValue: pathToString(layer.to ?? layer.from),
        startTime: 0,
        endTime: DEFAULT_DURATION_MS,
        interpolator: "FAST_OUT_SLOW_IN" as const,
        type: "path" as const,
      };
    }),
  };
  return {
    id: options.id,
    name: options.name,
    x: options.x,
    y: options.y,
    layers,
    vector: { id: `vector-${options.id}`, name: options.name, width: 24, height: 24, alpha: 1 },
    animation,
    hiddenLayerIds: [],
  };
}

/** Creates a fresh starter document; callers can safely mutate every returned value. */
export function createDefaultWorkspace() {
  const frames: CanvasFrame[] = [
    makeMorphFrame({
      id: "frame-play-pause",
      name: "Play icon",
      x: 0,
      y: 0,
      stroke: false,
      fill: true,
      parts: [
        {
          id: "layer-play-upper",
          name: "Upper",
          from: "M 8 5 L 8 12 L 19 12 L 19 12 L 8 5",
          to: "M 5 6 L 5 10 L 19 10 L 19 6 L 5 6",
        },
        {
          id: "layer-play-lower",
          name: "Lower",
          from: "M 8 12 L 8 19 L 19 12 L 19 12 L 8 12",
          to: "M 5 14 L 5 18 L 19 18 L 19 14 L 5 14",
        },
      ],
    }),
    makeMorphFrame({
      id: "frame-menu-close",
      name: "Menu icon",
      x: 48,
      y: 0,
      stroke: false,
      fill: true,
      parts: [
        {
          id: "layer-menu-top",
          name: "Top bar",
          from: "M 3 5 L 21 5 L 21 7.5 L 3 7.5 Z",
          to: "M 6.45 4.55 L 19.45 17.55 L 17.55 19.45 L 4.55 6.45 Z",
        },
        {
          id: "layer-menu-mid",
          name: "Middle bar",
          from: "M 3 10.75 L 21 10.75 L 21 13.25 L 3 13.25 Z",
          to: "M 12 12 L 12 12 L 12 12 L 12 12 Z",
        },
        {
          id: "layer-menu-bottom",
          name: "Bottom bar",
          from: "M 3 16.5 L 21 16.5 L 21 19 L 3 19 Z",
          to: "M 4.55 17.55 L 17.55 4.55 L 19.45 6.45 L 6.45 19.45 Z",
        },
      ],
    }),
    makeMorphFrame({
      id: "frame-heart-star",
      name: "Heart icon",
      x: 96,
      y: 0,
      stroke: false,
      fill: true,
      parts: [
        {
          id: "layer-heart-star",
          name: "Shape",
          from: "M 12 6.8 L 15.4 4.1 L 19.6 5.3 L 21 9.2 L 19 14 L 12 20.8 L 5 14 L 3 9.2 L 4.4 5.3 L 8.6 4.1 Z",
          to: "M 12 3 L 14.4 9.1 L 20.9 9.4 L 15.9 13.5 L 17.6 20 L 12 16.4 L 6.4 20 L 8.1 13.5 L 3.1 9.4 L 9.6 9.1 Z",
        },
      ],
    }),
  ];
  const firstFrame = frames[0]!;
  const animation = structuredClone(firstFrame.animation);
  return {
    initialFrames: frames,
    initialFrame: firstFrame,
    initialLayers: structuredClone(firstFrame.layers),
    initialVector: structuredClone(firstFrame.vector),
    initialAnimation: animation,
    initialRootAnimation: {
      id: "page-root-animation",
      name: "Page motion",
      duration: animation.duration,
      blocks: [],
    } satisfies AnimationState,
  };
}
