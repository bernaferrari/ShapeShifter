import {
  computeDetailViewport,
  computeFitViewport,
  type Viewport,
} from "../../shapeshifter/camera";
import type { VectorMetadata } from "../../shapeshifter/types";
import type { CanvasFrame } from "../defaultWorkspace";
import type { EditorState } from "../editorStore";

type CameraActionKey =
  | "setWorldViewport"
  | "setDetailViewport"
  | "fitDetailToVector"
  | "fitWorldToFrames"
  | "bringFrameIntoView";

type SetEditorState = (
  update: Partial<EditorState> | ((state: EditorState) => Partial<EditorState> | EditorState),
) => void;

export function getFrameRect(frame: CanvasFrame) {
  return {
    x: frame.x || 0,
    y: frame.y || 0,
    w: frame.vector?.width || 48,
    h: frame.vector?.height || 48,
  };
}

export function computeFramesViewport(frames: CanvasFrame[]): Viewport {
  return computeFitViewport(frames.map(getFrameRect));
}

export function computeVectorViewport(vector: VectorMetadata, scale = 1): Viewport {
  return computeDetailViewport({ width: vector.width, height: vector.height }, scale);
}

export function createCameraActions(
  set: SetEditorState,
  get: () => EditorState,
): Pick<EditorState, CameraActionKey> {
  return {
    setWorldViewport: (viewport) => {
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
      const { frames, worldViewport, setWorldViewport } = get();
      const frame = frames.find((candidate) => candidate.id === frameId);
      if (!frame) return;

      const bounds = getFrameRect(frame);
      const padding = Math.max(bounds.w, bounds.h) * 0.6;
      const target = {
        x: bounds.x - padding,
        y: bounds.y - padding,
        w: (bounds.w + padding * 2) / worldViewport.scale,
        h: (bounds.h + padding * 2) / worldViewport.scale,
        scale: worldViewport.scale,
      };
      const isVisible =
        bounds.x > worldViewport.x &&
        bounds.x + bounds.w < worldViewport.x + worldViewport.w &&
        bounds.y > worldViewport.y &&
        bounds.y + bounds.h < worldViewport.y + worldViewport.h;
      if (isVisible) return;
      if (options.animate === false || typeof requestAnimationFrame === "undefined") {
        setWorldViewport(target);
        return;
      }

      const start = { ...worldViewport };
      const duration = 220;
      const startedAt = performance.now();
      const step = () => {
        const progress = Math.min(1, (performance.now() - startedAt) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        setWorldViewport({
          x: start.x + (target.x - start.x) * eased,
          y: start.y + (target.y - start.y) * eased,
          w: start.w + (target.w - start.w) * eased,
          h: start.h + (target.h - start.h) * eased,
          scale: target.scale,
        });
        if (progress < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
  };
}
