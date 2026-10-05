import {
  computeDetailViewport,
  computeFitViewport,
  fitViewportToAspect,
  type Viewport,
} from "../../shapeshifter/camera";
import { createLayerTreeModel } from "../../shapeshifter/scene/layerHierarchy";
import { PAGE_ROOT_ID } from "../../shapeshifter/scene/owners";
import { getOwnedLayerBounds } from "../../shapeshifter/scene/selection";
import type { VectorMetadata } from "../../shapeshifter/types";
import type { CanvasFrame } from "../defaultWorkspace";
import type { EditorState } from "../editorStore";
import { vectorCoordinateRect } from "../../shapeshifter/vectorSpace";

type CameraActionKey =
  | "setWorldViewport"
  | "setDetailViewport"
  | "fitDetailToVector"
  | "fitWorldToFrames"
  | "bringFrameIntoView"
  | "bringLayerIntoView";

type SetEditorState = (
  update: Partial<EditorState> | ((state: EditorState) => Partial<EditorState> | EditorState),
) => void;

export function getFrameRect(frame: CanvasFrame) {
  return {
    x: frame.x || 0,
    y: frame.y || 0,
    ...vectorCoordinateRect(frame.vector, 48),
  };
}

export function computeFramesViewport(frames: CanvasFrame[]): Viewport {
  return computeFitViewport(frames.map(getFrameRect));
}

export function computeVectorViewport(vector: VectorMetadata, scale = 1): Viewport {
  return computeDetailViewport(vector, scale);
}

function animateViewport(
  from: Viewport,
  to: Viewport,
  onUpdate: (viewport: Viewport) => void,
  animate: boolean,
) {
  let active = true;
  let request: number | undefined;
  const cancel = () => {
    active = false;
    if (request !== undefined) cancelAnimationFrame(request);
  };
  if (!animate || typeof requestAnimationFrame === "undefined") {
    onUpdate(to);
    return cancel;
  }
  const duration = 180;
  const startedAt = performance.now();
  const step = () => {
    if (!active) return;
    const progress = Math.min(1, (performance.now() - startedAt) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    onUpdate({
      x: from.x + (to.x - from.x) * eased,
      y: from.y + (to.y - from.y) * eased,
      w: from.w + (to.w - from.w) * eased,
      h: from.h + (to.h - from.h) * eased,
      scale: from.scale + (to.scale - from.scale) * eased,
    });
    if (progress < 1) request = requestAnimationFrame(step);
  };
  request = requestAnimationFrame(step);
  return cancel;
}

export function createCameraActions(
  set: SetEditorState,
  get: () => EditorState,
): Pick<EditorState, CameraActionKey> {
  let cancelAnimation: (() => void) | undefined;
  const stopAnimation = () => {
    cancelAnimation?.();
    cancelAnimation = undefined;
  };
  const focusViewport = (from: Viewport, to: Viewport, animate: boolean) => {
    stopAnimation();
    const reducedMotion =
      typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    cancelAnimation = animateViewport(
      from,
      to,
      (worldViewport) => set({ worldViewport }),
      animate && !reducedMotion,
    );
  };
  return {
    setWorldViewport: (viewport) => {
      stopAnimation();
      set((state) => ({
        worldViewport: { ...state.worldViewport, ...viewport },
      }));
    },

    setDetailViewport: (viewport) => {
      set((state) => {
        const next = typeof viewport === "function" ? viewport(state.detailViewport) : viewport;
        return { detailViewport: next, zoom: next.scale };
      });
    },

    fitDetailToVector: (scale) => {
      const { vector, detailViewport } = get();
      const next = computeVectorViewport(vector, scale ?? detailViewport.scale);
      set({ detailViewport: next, zoom: next.scale });
    },

    fitWorldToFrames: (frameIds) => {
      const { frames, setWorldViewport } = get();
      const targetFrames = frameIds
        ? frames.filter((frame) => frameIds.includes(frame.id))
        : frames;
      if (targetFrames.length > 0) setWorldViewport(computeFramesViewport(targetFrames));
    },

    bringFrameIntoView: (frameId, options = {}) => {
      stopAnimation();
      const { frames, worldViewport } = get();
      const frame = frames.find((candidate) => candidate.id === frameId);
      if (!frame) return;

      const bounds = getFrameRect(frame);
      const target = {
        ...worldViewport,
        x: bounds.x + bounds.w / 2 - worldViewport.w / 2,
        y: bounds.y + bounds.h / 2 - worldViewport.h / 2,
      };
      const isVisible =
        bounds.x > worldViewport.x &&
        bounds.x + bounds.w < worldViewport.x + worldViewport.w &&
        bounds.y > worldViewport.y &&
        bounds.y + bounds.h < worldViewport.y + worldViewport.h;
      if (isVisible) return;
      focusViewport(worldViewport, target, options.animate !== false);
    },

    bringLayerIntoView: (ownerId, layerId, options = {}) => {
      stopAnimation();
      const state = get();
      const frame = state.frames.find((candidate) => candidate.id === ownerId);
      const ownerLayers =
        ownerId === PAGE_ROOT_ID
          ? state.rootLayers
          : ownerId === state.selectedFrameId
            ? state.layers
            : frame?.layers;
      if (!ownerLayers) return;

      const tree = createLayerTreeModel(ownerLayers);
      const targetIds = new Set(
        tree.allLayers
          .filter(
            (layer) =>
              String(layer.id) === String(layerId) ||
              tree
                .ancestorsOf(layer.id)
                .some((ancestor) => String(ancestor.id) === String(layerId)),
          )
          .map((layer) => String(layer.id)),
      );
      const origin = frame ? { x: frame.x || 0, y: frame.y || 0 } : { x: 0, y: 0 };
      const bounds = getOwnedLayerBounds({
        ownerId,
        origin,
        // Locked layers are still valid focus targets from the Layers panel.
        layers: tree.allLayers.map((layer) => ({ ...layer, locked: false, visible: true })),
      })
        .filter((item) => targetIds.has(String(item.layerId)))
        .reduce<null | { x: number; y: number; w: number; h: number }>((union, item) => {
          if (!union) return { ...item.bounds };
          const right = Math.max(union.x + union.w, item.bounds.x + item.bounds.w);
          const bottom = Math.max(union.y + union.h, item.bounds.y + item.bounds.h);
          const x = Math.min(union.x, item.bounds.x);
          const y = Math.min(union.y, item.bounds.y);
          return { x, y, w: right - x, h: bottom - y };
        }, null);
      if (!bounds) return;

      const current = state.worldViewport;
      const center = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
      let target: Viewport;
      if (options.fit) {
        const fitted = fitViewportToAspect(
          computeFitViewport([bounds], {
            minPadding: Math.max(2, Math.max(bounds.w, bounds.h) * 0.35),
            maxScale: 12,
          }),
          current.w / Math.max(1, current.h),
        );
        const desiredScale = Math.max(
          0.05,
          Math.min(12, current.scale * (current.w / Math.max(1, fitted.w))),
        );
        const w = current.w * (current.scale / desiredScale);
        const h = current.h * (current.scale / desiredScale);
        target = { x: center.x - w / 2, y: center.y - h / 2, w, h, scale: desiredScale };
      } else {
        target = {
          ...current,
          x: center.x - current.w / 2,
          y: center.y - current.h / 2,
        };
      }
      focusViewport(current, target, options.animate !== false);
    },
  };
}
