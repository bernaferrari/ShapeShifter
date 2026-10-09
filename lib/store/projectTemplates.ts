import { DEMO_INFOS } from "../pathshift/demoProjects";
import { workspaceFromDocument } from "../pathshift/documentModel";
import type { EditorDocument } from "../pathshift/types";
import { createDefaultWorkspace, type CanvasFrame } from "./defaultWorkspace";

/** Blank artboard sizes in dp, named for where Android designers use them. */
export interface BlankPreset {
  id: string;
  name: string;
  detail: string;
  width: number;
  height: number;
}

export const BLANK_PRESETS: readonly BlankPreset[] = [
  { id: "icon", name: "Icon", detail: "Toolbar and action icons", width: 24, height: 24 },
  {
    id: "icon-large",
    name: "Large icon",
    detail: "Empty states and badges",
    width: 48,
    height: 48,
  },
  {
    id: "adaptive",
    name: "Adaptive icon",
    detail: "Launcher foreground layer",
    width: 108,
    height: 108,
  },
];

export const MAX_ARTBOARD_SIZE = 4096;

export function createBlankFrames(name: string, width: number, height: number): CanvasFrame[] {
  const id = `frame-${Date.now()}`;
  return [
    {
      id,
      name,
      x: 0,
      y: 0,
      layers: [],
      vector: { id: `vector-${id}`, name, width, height, alpha: 1 },
      animation: { id: `anim-${id}`, name, duration: 1000, blocks: [] },
      hiddenLayerIds: [],
    },
  ];
}

export interface ProjectTemplate {
  id: string;
  title: string;
  description: string;
  /** Fresh frames on every call; the store clones them again on load. */
  frames: () => CanvasFrame[];
}

const DEMO_DESCRIPTIONS: Record<(typeof DEMO_INFOS)[number]["id"], string> = {
  playtopause: "Media control that morphs between states.",
  searchtoclose: "Search glass that folds into a close mark.",
  morphinganimals: "One silhouette reshaping into the next.",
  visibilitystrike: "Eye icon with an animated strike-through.",
  heartbreak: "A like button that cracks apart.",
};

export const PROJECT_TEMPLATES: readonly ProjectTemplate[] = [
  {
    id: "starter",
    title: "Starter icons",
    description: "Play, menu and heart morphs to learn from.",
    frames: () => createDefaultWorkspace().initialFrames,
  },
  ...DEMO_INFOS.map((demo) => ({
    id: demo.id,
    title: demo.title,
    description: DEMO_DESCRIPTIONS[demo.id],
    frames: () => workspaceFromDocument(demo.project.document as unknown as EditorDocument).frames,
  })),
];
