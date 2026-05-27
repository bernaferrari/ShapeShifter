/**
 * ShapeShifter 2026 - Tool Modes and Cursors
 * Ported from original Angular model/paper/ToolMode.ts and CursorType.ts
 * These drive the gesture dispatcher and UI tool panel.
 */

export type ToolMode =
  | "default"
  | "select"
  | "pen"
  | "direct"
  | "hand"
  | "pencil"
  | "paint"
  | "ellipse"
  | "rectangle"
  | "zoomPan"
  | "rotate"
  | "transform";

export type CursorType =
  | "default"
  | "crosshair"
  | "pointer"
  | "move"
  | "grab"
  | "grabbing"
  | "pen"
  | "pen-add"
  | "pen-close"
  | "pencil"
  | "zoom-in"
  | "zoom-out"
  | "rotate-0"
  | "rotate-45"
  | "rotate-90"
  | "rotate-135"
  | "rotate-180"
  | "rotate-225"
  | "rotate-270"
  | "rotate-315"
  | "resize-0"
  | "resize-45"
  | "resize-90"
  | "resize-135"
  | "resize-180"
  | "resize-225"
  | "resize-270"
  | "resize-315";

export const ALL_TOOL_MODES: ToolMode[] = [
  "default",
  "select",
  "pen",
  "direct",
  "hand",
  "pencil",
  "paint",
  "ellipse",
  "rectangle",
  "zoomPan",
  "rotate",
  "transform",
];

export const ALL_CURSORS: CursorType[] = [
  "default",
  "crosshair",
  "pointer",
  "move",
  "grab",
  "grabbing",
  "pen",
  "pen-add",
  "pen-close",
  "pencil",
  "zoom-in",
  "zoom-out",
  "rotate-0",
  "rotate-45",
  "rotate-90",
  "rotate-135",
  "rotate-180",
  "rotate-225",
  "rotate-270",
  "rotate-315",
  "resize-0",
  "resize-45",
  "resize-90",
  "resize-135",
  "resize-180",
  "resize-225",
  "resize-270",
  "resize-315",
];
