import { toast } from "sonner";
import {
  androidPathMorphSignature,
  parsePath,
  pathToString,
  prepareForMorph,
} from "../../shapeshifter/pathUtils";
import type { Layer, MorphMapping, PathData, Selection } from "../../shapeshifter/types";
import type { EditorState } from "../editorStore";
import { structuralLockIssue } from "./structuralLayers";

const pointCounts: Record<string, number> = { M: 1, L: 1, C: 3, Q: 2, S: 2, T: 1, A: 1, Z: 0 };
export function isEditablePath(path: PathData): boolean {
  return path.subPaths.every(
    (sub) =>
      (!sub.commands.length || sub.commands[0].type === "M") &&
      sub.commands.every(
        (cmd) =>
          cmd.points.length === pointCounts[cmd.type] &&
          cmd.points.every(
            (p) =>
              Number.isFinite(p.x) &&
              Number.isFinite(p.y) &&
              Math.abs(p.x) <= 1e7 &&
              Math.abs(p.y) <= 1e7,
          ) &&
          (cmd.type !== "A" || Boolean(cmd.arcParams)),
      ),
  );
}

/** Publish a topology change across every authored pose, with one owned undo step. */
export function commitPathTopology(
  set: (patch: Partial<EditorState>) => void,
  get: () => EditorState,
  layerId: string | number,
  transform: (path: PathData) => PathData,
  options?: { mapping?: MorphMapping; recordHistory?: boolean },
): boolean {
  const state = get();
  const index = state.layers.findIndex((layer) => String(layer.id) === String(layerId));
  if (index < 0) return false;
  const issue = structuralLockIssue(state.layers, [layerId], false);
  if (issue) {
    toast.error(issue);
    return false;
  }
  const layer = state.layers[index];
  const cache = new Map<string, PathData>();
  let changed = false;
  try {
    const apply = (path: PathData) => {
      if (!isEditablePath(path))
        throw new Error(
          "This path contains invalid points. Repair its SVG path data before editing.",
        );
      const source = pathToString(path);
      const cached = cache.get(source);
      if (cached) return cached;
      const next = transform(path);
      if (!isEditablePath(next))
        throw new Error("That edit cannot produce a valid path. The artwork has been preserved.");
      changed ||= source !== pathToString(next);
      cache.set(source, next);
      return next;
    };
    const from = apply(layer.from);
    const to = layer.to ? apply(layer.to) : undefined;
    const blocks = state.animation.blocks.map((block) => {
      if (String(block.layerId) !== String(layerId) || block.propertyName !== "pathData")
        return block;
      const fromValue = pathToString(apply(parsePath(String(block.fromValue))));
      const toValue = pathToString(apply(parsePath(String(block.toValue))));
      return fromValue === block.fromValue && toValue === block.toValue
        ? block
        : { ...block, fromValue, toValue };
    });
    if (!changed && !options?.mapping) return false;
    const signatures = new Set([...cache.values()].map(androidPathMorphSignature));
    if (signatures.size > 1)
      throw new Error(
        "The animation poses need matching points first. Use Match points before changing their structure.",
      );
    const before = state.editingSide === "from" ? layer.from : (layer.to ?? layer.from);
    const after = state.editingSide === "from" ? from : (to ?? from);
    const remap = (selection: Selection | null): Selection | null => {
      if (!selection || String(selection.layerId) !== String(layerId)) return null;
      const original = before.subPaths[selection.subPathIndex]?.commands[selection.commandIndex];
      const commands = after.subPaths[selection.subPathIndex]?.commands;
      const commandIndex = commands?.findIndex((cmd) => cmd.id === original?.id) ?? -1;
      const command = commands?.[commandIndex];
      if (!original || !command?.points.length) return null;
      const wasAnchor = selection.pointIndex === original.points.length - 1;
      return {
        ...selection,
        commandIndex,
        pointIndex: wasAnchor
          ? command.points.length - 1
          : Math.min(selection.pointIndex, command.points.length - 1),
      };
    };
    const layers = [...state.layers];
    layers[index] = { ...layer, from, to, pathData: from, morphMapping: options?.mapping };
    if (options?.recordHistory !== false) state.pushHistory();
    set({
      layers,
      animation: { ...state.animation, blocks },
      morphPreview: null,
      dragState: options?.recordHistory === false ? state.dragState : null,
      selection: remap(state.selection),
      selectedPoints: state.selectedPoints.map(remap).filter((p): p is Selection => p !== null),
      selectedSubPaths: [],
      isPlaying: false,
    });
    return true;
  } catch (cause) {
    toast.error(
      cause instanceof Error
        ? cause.message
        : "The path could not be edited. The artwork has been preserved.",
    );
    return false;
  }
}

export function pathPoseSourceSignature(state: EditorState, layer: Layer): string {
  return JSON.stringify([
    pathToString(layer.from),
    layer.to && pathToString(layer.to),
    state.animation.blocks.filter(
      (block) => String(block.layerId) === String(layer.id) && block.propertyName === "pathData",
    ),
  ]);
}

/** Match every pose against a shared contour template, rather than only the outer pair. */
export function preparePathPoseFamily(state: EditorState, layer: Layer) {
  const values = [
    ...new Set([
      pathToString(layer.from),
      pathToString(layer.to ?? layer.from),
      ...state.animation.blocks
        .filter(
          (block) =>
            String(block.layerId) === String(layer.id) && block.propertyName === "pathData",
        )
        .flatMap((block) => [String(block.fromValue), String(block.toValue)]),
    ]),
  ];
  let paths = values.map(parsePath);
  if (paths.some((path) => !isEditablePath(path)))
    throw new Error("Repair the invalid path data before matching points.");
  let template = paths.reduce((largest, path) =>
    path.subPaths.reduce((n, sub) => n + sub.commands.length, 0) >
    largest.subPaths.reduce((n, sub) => n + sub.commands.length, 0)
      ? path
      : largest,
  );
  for (let pass = 0; pass < 6; pass++) {
    paths = paths.map((path) => {
      const prepared = prepareForMorph(template, path);
      template = prepared.from;
      return prepared.to;
    });
    if (
      paths.every((path) => androidPathMorphSignature(path) === androidPathMorphSignature(template))
    ) {
      const prepared = prepareForMorph(paths[0], paths[1] ?? paths[0]);
      return {
        values,
        paths,
        mapping: {
          ...prepared.mapping,
          alignments: {
            kind: "prepared" as const,
            fromSignature: androidPathMorphSignature(paths[0]),
            toSignature: androidPathMorphSignature(paths[1] ?? paths[0]),
            compatible: true,
          },
        },
      };
    }
  }
  throw new Error(
    "These contours could not be matched automatically. Split or simplify their points and try again.",
  );
}
